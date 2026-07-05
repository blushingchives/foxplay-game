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
	run("ip", "link", "set", "lo", "up")

	// 3. Mount code drive (/dev/vdb) at /var/task
	os.MkdirAll("/var/task", 0755)
	if err := syscall.Mount("/dev/vdb", "/var/task", "ext4", syscall.MS_RDONLY, ""); err != nil {
		log.Fatalf("mount code drive: %v", err)
	}
	log.Println("code drive mounted at /var/task")

	// 4. Start user's app
	app := exec.Command("node", "/var/task/index.js")
	app.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", appPort))
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

	for {
		connFd, _, err := syscall.Accept(fd)
		if err != nil {
			log.Printf("accept: %v", err)
			continue
		}
		go handleInvocation(connFd)
	}
}

func handleInvocation(fd int) {
	conn := fdToConn(fd)
	defer conn.Close()

	var event InvocationEvent
	if err := json.NewDecoder(conn).Decode(&event); err != nil {
		log.Printf("decode event: %v", err)
		return
	}

	url := fmt.Sprintf("http://localhost:%d%s", appPort, event.Path)
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

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		sendError(conn, 502, err.Error())
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

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

// fdToConn wraps a raw file descriptor as a net.Conn via os.File.
func fdToConn(fd int) net.Conn {
	f := os.NewFile(uintptr(fd), "vsock-conn")
	conn, _ := net.FileConn(f)
	f.Close() // FileConn duplicates the fd, safe to close the file
	return conn
}

func waitForApp(port int, timeout time.Duration) error {
	url := fmt.Sprintf("http://localhost:%d/", port)
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

func mustMount(source, target, fstype string) {
	if err := syscall.Mount(source, target, fstype, 0, ""); err != nil {
		log.Printf("mount %s → %s: %v (continuing)", source, target, err)
	}
}

func run(name string, args ...string) {
	if out, err := exec.Command(name, args...).CombinedOutput(); err != nil {
		log.Printf("run %s: %v: %s (continuing)", name, err, out)
	}
}
