package main

// Firecracker API helpers, adapted from the pool-manager for long-lived,
// networked instances: a single writable root disk (no code drive, no
// vsock) plus a tap network interface. Shared by copy, matching how these
// helpers are already duplicated across the Go services.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"time"
)

func spawnFirecracker(bin, socketPath string) (int, error) {
	cmd := exec.Command(bin, "--api-sock", socketPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("exec firecracker: %w", err)
	}
	go cmd.Wait() // reap on exit so it doesn't zombie

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

// configureInstance sets up a long-lived VM: writable root disk, a tap NIC,
// and a static guest IP handed to the kernel via the ip= boot arg (so no
// userspace network config is needed inside the guest).
func configureInstance(socketPath string, cfg instanceBoot) error {
	// ip=<client>::<gw>:<netmask>:<hostname>:<device>:<autoconf> — the
	// hostname field carries the instance id so the guest names itself after
	// it (foxinit re-asserts it in case the kernel value doesn't stick).
	bootArgs := fmt.Sprintf(
		"console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw "+
			"ip=%s::%s:%s:%s:eth0:off init=/sbin/foxinit",
		cfg.GuestIP, cfg.GatewayIP, cfg.Netmask, cfg.Hostname,
	)
	if err := fcPut(socketPath, "/boot-source", map[string]any{
		"kernel_image_path": cfg.KernelPath,
		"boot_args":         bootArgs,
	}); err != nil {
		return fmt.Errorf("boot-source: %w", err)
	}

	// Per-instance writable root disk (a copy of the base image).
	if err := fcPut(socketPath, "/drives/rootfs", map[string]any{
		"drive_id":       "rootfs",
		"path_on_host":   cfg.DiskPath,
		"is_root_device": true,
		"is_read_only":   false,
	}); err != nil {
		return fmt.Errorf("rootfs drive: %w", err)
	}

	if err := fcPut(socketPath, "/machine-config", map[string]any{
		"vcpu_count":   cfg.VCPU,
		"mem_size_mib": cfg.MemMiB,
	}); err != nil {
		return fmt.Errorf("machine-config: %w", err)
	}

	// Tap NIC. The guest MAC is derived from the IP so it's stable across
	// reboots of the same instance.
	if err := fcPut(socketPath, "/network-interfaces/eth0", map[string]any{
		"iface_id":      "eth0",
		"host_dev_name": cfg.TapName,
		"guest_mac":     cfg.GuestMAC,
	}); err != nil {
		return fmt.Errorf("network interface: %w", err)
	}

	return nil
}

func startVM(socketPath string) error {
	return fcPut(socketPath, "/actions", map[string]any{"action_type": "InstanceStart"})
}

// sendCtrlAltDel asks the guest to shut down cleanly (init handles the
// signal), the graceful counterpart to killing the process.
func sendCtrlAltDel(socketPath string) error {
	return fcPut(socketPath, "/actions", map[string]any{"action_type": "SendCtrlAltDel"})
}
