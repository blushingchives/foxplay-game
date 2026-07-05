package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	appPort     = 3000
	vsockPort   = 8080
	afVsock     = 40
	vmaddrCIDAny = 0xFFFFFFFF
)

// sockaddrVM mirrors struct sockaddr_vm from <linux/vm_sockets.h>
type sockaddrVM struct {
	Family    uint16
	Reserved1 uint16
	Port      uint32
	CID       uint32
	Zero      [4]byte
}

type InvocationEvent struct {
	Method  string              `json:"method"`
	Path    string              `json:"path"`
	Query   string              `json:"query"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body"`
}

type InvocationResponse struct {
	Status  int                 `json:"status"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body"`
}

func main() {
	log.SetPrefix("[bootstrap] ")
	log.SetFlags(log.Ltime)

	// 1. Mount essential filesystems
	mustMount("proc", "/proc", "proc")
	mustMount("sysfs", "/sys", "sysfs")
	mustMount("devtmpfs", "/dev", "devtmpfs")
	mustMount("tmpfs", "/tmp", "tmpfs")

	// 2. Loopback up (required for localhost)
	if err := bringUpLoopback(); err != nil {
		log.Printf("loopback: %v (continuing)", err)
	}

	// 3. Mount code drive (/dev/vdb) at /var/task
	os.MkdirAll("/var/task", 0755)
	if err := syscall.Mount("/dev/vdb", "/var/task", "ext4", syscall.MS_RDONLY, "noload"); err != nil {
		log.Fatalf("mount code drive: %v", err)
	}
	log.Println("code drive mounted at /var/task")

	// 4. Start user's app
	app := exec.Command("/usr/local/bin/node", "/var/task/index.js")
	app.Env = append(os.Environ(),
		fmt.Sprintf("PORT=%d", appPort),
		"PATH=/usr/local/bin:/usr/bin:/bin",
	)
	app.Stdout = os.Stdout
	app.Stderr = os.Stderr
	if err := app.Start(); err != nil {
		log.Fatalf("start app: %v", err)
	}
	log.Printf("app started (pid %d), waiting for ready...", app.Process.Pid)

	// 5. Wait until Express is accepting connections
	if err := waitForApp(appPort, 30*time.Second); err != nil {
		log.Fatalf("app not ready: %v", err)
	}
	log.Println("app ready")

	// 6. Listen on vsock for invocations from the host pool manager
	fd, err := listenVsock(vsockPort)
	if err != nil {
		log.Fatalf("listen vsock port %d: %v", vsockPort, err)
	}
	log.Printf("listening for invocations on vsock port %d", vsockPort)

	// Monitor app — if it dies, close the vsock listener so the accept loop exits
	// and the pool manager gets an error instead of a dead VM being reused.
	go func() {
		app.Wait()
		log.Printf("app process died — closing vsock listener")
		syscall.Close(fd)
	}()

	for {
		connFd, _, errno := syscall.Syscall(syscall.SYS_ACCEPT, uintptr(fd), 0, 0)
		if errno != 0 {
			log.Printf("accept: %v", errno)
			continue
		}
		log.Printf("accepted connection fd=%d", connFd)
		go handleInvocation(int(connFd))
	}
}

func handleInvocation(fd int) {
	conn := fdToConn(fd)
	defer conn.Close()

	log.Printf("handleInvocation: reading event")
	var event InvocationEvent
	if err := json.NewDecoder(conn).Decode(&event); err != nil {
		log.Printf("decode event: %v", err)
		return
	}
	log.Printf("handleInvocation: %s %s", event.Method, event.Path)

	url := fmt.Sprintf("http://127.0.0.1:%d%s", appPort, event.Path)
	if event.Query != "" {
		url += "?" + event.Query
	}

	var bodyReader io.Reader
	if event.Body != "" {
		bodyReader = strings.NewReader(event.Body)
	}

	req, err := http.NewRequest(event.Method, url, bodyReader)
	if err != nil {
		sendError(conn, 500, err.Error())
		return
	}
	for k, vals := range event.Headers {
		for _, v := range vals {
			req.Header.Add(k, v)
		}
	}

	log.Printf("handleInvocation: sending to Express")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("express error: %v", err)
		sendError(conn, 502, err.Error())
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	log.Printf("handleInvocation: got response %d, sending back", resp.StatusCode)

	json.NewEncoder(conn).Encode(InvocationResponse{
		Status:  resp.StatusCode,
		Headers: map[string][]string(resp.Header),
		Body:    string(body),
	})
}

func sendError(conn net.Conn, status int, msg string) {
	log.Printf("error %d: %s", status, msg)
	json.NewEncoder(conn).Encode(InvocationResponse{Status: status, Body: msg})
}

// listenVsock creates an AF_VSOCK listener using raw syscalls.
// Go's net package does not support AF_VSOCK natively.
func listenVsock(port uint32) (int, error) {
	fd, _, errno := syscall.RawSyscall(syscall.SYS_SOCKET, afVsock, syscall.SOCK_STREAM, 0)
	if errno != 0 {
		return 0, fmt.Errorf("socket: %w", errno)
	}

	sa := sockaddrVM{
		Family: afVsock,
		Port:   port,
		CID:    vmaddrCIDAny,
	}

	_, _, errno = syscall.RawSyscall(syscall.SYS_BIND, fd,
		uintptr(unsafe.Pointer(&sa)), unsafe.Sizeof(sa))
	if errno != 0 {
		syscall.Close(int(fd))
		return 0, fmt.Errorf("bind: %w", errno)
	}

	_, _, errno = syscall.RawSyscall(syscall.SYS_LISTEN, fd, 128, 0)
	if errno != 0 {
		syscall.Close(int(fd))
		return 0, fmt.Errorf("listen: %w", errno)
	}

	return int(fd), nil
}

// fdToConn wraps a raw fd as a net.Conn using direct syscalls.
// net.FileConn does not support AF_VSOCK so we bypass it entirely.
func fdToConn(fd int) net.Conn {
	return &rawConn{fd: fd}
}

type rawConn struct{ fd int }

func (c *rawConn) Read(b []byte) (int, error) {
	n, err := syscall.Read(c.fd, b)
	if n == 0 && err == nil {
		return 0, io.EOF
	}
	return n, err
}

func (c *rawConn) Write(b []byte) (int, error) {
	return syscall.Write(c.fd, b)
}

func (c *rawConn) Close() error                       { return syscall.Close(c.fd) }
func (c *rawConn) LocalAddr() net.Addr                { return &net.UnixAddr{} }
func (c *rawConn) RemoteAddr() net.Addr               { return &net.UnixAddr{} }
func (c *rawConn) SetDeadline(t time.Time) error      { return nil }
func (c *rawConn) SetReadDeadline(t time.Time) error  { return nil }
func (c *rawConn) SetWriteDeadline(t time.Time) error { return nil }

func waitForApp(port int, timeout time.Duration) error {
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := http.Get(url)
		if err == nil {
			resp.Body.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("app did not respond within %s", timeout)
}

func bringUpLoopback() error {
	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_DGRAM, syscall.IPPROTO_IP)
	if err != nil {
		return fmt.Errorf("socket: %w", err)
	}
	defer syscall.Close(fd)

	const (
		SIOCGIFFLAGS = 0x8913
		SIOCSIFFLAGS = 0x8914
		SIOCSIFADDR  = 0x8916
	)

	type ifreqFlags struct {
		Name  [syscall.IFNAMSIZ]byte
		Flags uint16
		_     [22]byte
	}
	type ifreqAddr struct {
		Name [syscall.IFNAMSIZ]byte
		Addr syscall.RawSockaddrInet4
		_    [8]byte
	}

	// Bring up the interface
	flags := ifreqFlags{}
	copy(flags.Name[:], "lo")
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), SIOCGIFFLAGS, uintptr(unsafe.Pointer(&flags))); errno != 0 {
		return fmt.Errorf("SIOCGIFFLAGS: %w", errno)
	}
	flags.Flags |= syscall.IFF_UP | syscall.IFF_RUNNING
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), SIOCSIFFLAGS, uintptr(unsafe.Pointer(&flags))); errno != 0 {
		return fmt.Errorf("SIOCSIFFLAGS: %w", errno)
	}

	// Assign 127.0.0.1 to lo
	addr := ifreqAddr{}
	copy(addr.Name[:], "lo")
	addr.Addr.Family = syscall.AF_INET
	addr.Addr.Addr = [4]byte{127, 0, 0, 1}
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), SIOCSIFADDR, uintptr(unsafe.Pointer(&addr))); errno != 0 {
		return fmt.Errorf("SIOCSIFADDR: %w", errno)
	}

	log.Println("loopback configured (127.0.0.1)")
	return nil
}

func mustMount(source, target, fstype string) {
	if err := syscall.Mount(source, target, fstype, 0, ""); err != nil {
		log.Printf("mount %s → %s: %v (continuing)", source, target, err)
	}
}

