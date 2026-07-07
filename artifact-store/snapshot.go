package main

// Deploy-time snapshotting: after a function image is built, boot it once in
// firecracker, snapshot the ready VM, and store the snapshot next to the
// image. The pool manager restores from the snapshot instead of cold booting.
//
// Contract with the pool manager (must stay in sync):
//   - snapshot files: {FUNCTIONS_DIR}/{name}.snap + {name}.mem
//   - vsock UDS path: /tmp/fc-fn-{name}-vsock.sock (baked into the snapshot)
//   - machine config: 1 vCPU / 256 MiB
//   - both services must run the same firecracker binary

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const bootstrapVsockPort = 8080

func (s *ArtifactStore) snapshotFunction(functionName string) error {
	codeRootfs := filepath.Join(s.functionsDir, functionName+".ext4")
	snapPath := filepath.Join(s.functionsDir, functionName+".snap")
	memPath := filepath.Join(s.functionsDir, functionName+".mem")
	tmpSnap, tmpMem := snapPath+".tmp", memPath+".tmp"

	socketPath := fmt.Sprintf("/tmp/fc-snap-%s.sock", functionName)
	// The pool manager restores snapshots expecting this exact vsock path.
	vsockPath := fmt.Sprintf("/tmp/fc-fn-%s-vsock.sock", functionName)

	for _, f := range []string{socketPath, vsockPath, tmpSnap, tmpMem} {
		os.Remove(f)
	}

	pid, err := spawnFirecracker(s.firecrackerBin, socketPath)
	if err != nil {
		return fmt.Errorf("spawn firecracker: %w", err)
	}
	defer func() {
		if p, err := os.FindProcess(pid); err == nil {
			p.Signal(syscall.SIGTERM)
		}
		os.Remove(socketPath)
		os.Remove(vsockPath)
	}()

	if err := configureVM(socketPath, s.kernelPath, s.baseRootfs, codeRootfs, vsockPath); err != nil {
		return fmt.Errorf("configure VM: %w", err)
	}
	if err := fcPut(socketPath, "/actions", map[string]any{"action_type": "InstanceStart"}); err != nil {
		return fmt.Errorf("start VM: %w", err)
	}
	if err := waitForVsock(vsockPath, 30*time.Second); err != nil {
		return fmt.Errorf("VM not ready: %w", err)
	}
	if err := fcPatch(socketPath, "/vm", map[string]any{"state": "Paused"}); err != nil {
		return fmt.Errorf("pause VM: %w", err)
	}
	if err := fcPut(socketPath, "/snapshot/create", map[string]any{
		"snapshot_type": "Full",
		"snapshot_path": tmpSnap,
		"mem_file_path": tmpMem,
	}); err != nil {
		os.Remove(tmpSnap)
		os.Remove(tmpMem)
		return fmt.Errorf("create snapshot: %w", err)
	}

	// Rename only after both files are fully written, and after the .ext4 —
	// the pool manager treats a snapshot older than the image as stale.
	if err := os.Rename(tmpSnap, snapPath); err != nil {
		return err
	}
	return os.Rename(tmpMem, memPath)
}

func spawnFirecracker(bin, socketPath string) (int, error) {
	cmd := exec.Command(bin, "--api-sock", socketPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("exec firecracker: %w", err)
	}
	go cmd.Wait() // reap the process when it exits so it doesn't become a zombie

	// Wait for the API socket to appear
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(socketPath); err == nil {
			return cmd.Process.Pid, nil
		}
		time.Sleep(50 * time.Millisecond)
	}

	cmd.Process.Kill()
	return 0, fmt.Errorf("timeout waiting for firecracker socket at %s", socketPath)
}

func configureVM(socketPath, kernelPath, baseRootfs, codeRootfs, vsockPath string) error {
	// Kernel
	if err := fcPut(socketPath, "/boot-source", map[string]any{
		"kernel_image_path": kernelPath,
		"boot_args":         "console=ttyS0 reboot=k panic=1 pci=off init=/var/runtime/bootstrap",
	}); err != nil {
		return fmt.Errorf("boot-source: %w", err)
	}

	// Base rootfs (OS + Node.js runtime) — read-only
	if err := fcPut(socketPath, "/drives/rootfs", map[string]any{
		"drive_id":       "rootfs",
		"path_on_host":   baseRootfs,
		"is_root_device": true,
		"is_read_only":   true,
	}); err != nil {
		return fmt.Errorf("base rootfs: %w", err)
	}

	// Code drive (user's app) — mounted by bootstrap at /var/task
	if err := fcPut(socketPath, "/drives/code", map[string]any{
		"drive_id":       "code",
		"path_on_host":   codeRootfs,
		"is_root_device": false,
		"is_read_only":   true,
	}); err != nil {
		return fmt.Errorf("code drive: %w", err)
	}

	// Machine resources
	if err := fcPut(socketPath, "/machine-config", map[string]any{
		"vcpu_count":   1,
		"mem_size_mib": 256,
	}); err != nil {
		return fmt.Errorf("machine-config: %w", err)
	}

	// Vsock device — bootstrap listens on port 8080 inside the VM
	if err := fcPut(socketPath, "/vsock", map[string]any{
		"guest_cid": 3,
		"uds_path":  vsockPath,
	}); err != nil {
		return fmt.Errorf("vsock: %w", err)
	}

	return nil
}

// fcRequest sends a request to the Firecracker API via its Unix socket.
func fcRequest(method, socketPath, path string, body any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	req, err := http.NewRequest(method, "http://localhost"+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		var msg map[string]any
		json.NewDecoder(resp.Body).Decode(&msg)
		return fmt.Errorf("firecracker %s → %d: %v", path, resp.StatusCode, msg)
	}

	return nil
}

func fcPut(socketPath, path string, body any) error {
	return fcRequest(http.MethodPut, socketPath, path, body)
}

func fcPatch(socketPath, path string, body any) error {
	return fcRequest(http.MethodPatch, socketPath, path, body)
}

// connectVsock opens a connection to the bootstrap inside a Firecracker VM.
// Firecracker exposes vsock as a Unix socket using the proxy protocol:
//   host → guest: connect to UDS, send "CONNECT <port>\n", read "OK <port>\n"
func connectVsock(vsockPath string) (net.Conn, error) {
	conn, err := net.Dial("unix", vsockPath)
	if err != nil {
		return nil, err
	}

	fmt.Fprintf(conn, "CONNECT %d\n", bootstrapVsockPort)

	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("vsock handshake read: %w", err)
	}
	if !strings.HasPrefix(line, "OK") {
		conn.Close()
		return nil, fmt.Errorf("vsock handshake failed: %q", line)
	}

	return conn, nil
}

// waitForVsock polls until the bootstrap is listening on vsock or timeout.
func waitForVsock(vsockPath string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := connectVsock(vsockPath)
		if err == nil {
			conn.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("timeout waiting for bootstrap on %s", vsockPath)
}
