package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func spawnFirecracker(bin, socketPath string) (int, error) {
	cmd := exec.Command(bin, "--api-sock", socketPath)
	// Discard VM output — change to os.Stdout/Stderr for debugging
	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("exec firecracker: %w", err)
	}

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

func killVM(vm *VM) {
	if vm.pid > 0 {
		p, err := os.FindProcess(vm.pid)
		if err == nil {
			p.Signal(syscall.SIGTERM)
		}
	}
	os.Remove(vm.socketPath)
	os.Remove(vm.vsockPath)
}

// fcPut sends a PUT request to the Firecracker API via its Unix socket.
func fcPut(socketPath, path string, body any) error {
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

	req, err := http.NewRequest(http.MethodPut, "http://localhost"+path, bytes.NewReader(data))
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

func startVM(socketPath string) error {
	return fcPut(socketPath, "/actions", map[string]any{
		"action_type": "InstanceStart",
	})
}
