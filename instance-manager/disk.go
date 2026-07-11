package main

// Per-instance persistent disk. Provisioning copies the base image to a
// writable per-instance ext4 and injects the user's SSH key by loop-mounting
// it on the host (the guest disk is offline at this point). The disk then
// persists across stop/start until the instance is deleted.

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func (m *Manager) diskPath(id string) string {
	return filepath.Join(m.cfg.InstancesDir, id+".ext4")
}

func (m *Manager) baseImagePath(image string) string {
	return filepath.Join(m.cfg.BaseImagesDir, image+".ext4")
}

func (m *Manager) diskExists(id string) bool {
	_, err := os.Stat(m.diskPath(id))
	return err == nil
}

// provisionDisk copies the base image to the instance's writable disk and
// injects the SSH public key. No-op if the disk already exists.
func (m *Manager) provisionDisk(id, image, sshKey string) error {
	dst := m.diskPath(id)
	if _, err := os.Stat(dst); err == nil {
		return nil // already provisioned
	}
	src := m.baseImagePath(image)
	if _, err := os.Stat(src); err != nil {
		return fmt.Errorf("base image %q not found: %w", image, err)
	}
	if err := os.MkdirAll(m.cfg.InstancesDir, 0755); err != nil {
		return err
	}

	tmp := dst + ".tmp"
	os.Remove(tmp)
	if err := run("cp", "--reflink=auto", src, tmp); err != nil {
		return fmt.Errorf("copy base image: %w", err)
	}
	if sshKey != "" {
		if err := injectSSHKey(tmp, sshKey); err != nil {
			os.Remove(tmp)
			return fmt.Errorf("inject ssh key: %w", err)
		}
	}
	return os.Rename(tmp, dst)
}

func (m *Manager) removeDisk(id string) {
	os.Remove(m.diskPath(id))
}

// injectSSHKey loop-mounts the disk and writes the key to root's
// authorized_keys. Requires root + the loop kernel module (present on the
// Ubuntu host).
func injectSSHKey(diskPath, sshKey string) error {
	mnt, err := os.MkdirTemp("", "fc-inject-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(mnt)

	if err := run("mount", "-o", "loop", diskPath, mnt); err != nil {
		return err
	}
	defer exec.Command("umount", mnt).Run()

	sshDir := filepath.Join(mnt, "root", ".ssh")
	if err := os.MkdirAll(sshDir, 0700); err != nil {
		return err
	}
	authKeys := filepath.Join(sshDir, "authorized_keys")
	if err := os.WriteFile(authKeys, []byte(strings.TrimSpace(sshKey)+"\n"), 0600); err != nil {
		return err
	}
	return nil
}
