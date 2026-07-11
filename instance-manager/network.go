package main

// Host networking for instances: a shared bridge for guest connectivity,
// a tap device per running VM, NAT for egress, and a DNAT port-forward so
// the droplet's public port reaches the guest's SSH. Shells out to the
// standard `ip` and `iptables` tools (present on the Ubuntu host).

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

// runOK ignores failures — used for idempotent deletes where "not found" is
// success.
func runOK(name string, args ...string) {
	exec.Command(name, args...).Run()
}

// setupBridge creates the shared bridge and NAT masquerade once at startup.
// Idempotent: safe to call on every boot.
func setupBridge(cfg *Config) error {
	// bridge with the gateway IP the guests use as their default route
	if err := exec.Command("ip", "link", "show", cfg.Bridge).Run(); err != nil {
		if err := run("ip", "link", "add", cfg.Bridge, "type", "bridge"); err != nil {
			return err
		}
	}
	runOK("ip", "addr", "add", cfg.GatewayIP+"/"+cfg.PrefixLen, "dev", cfg.Bridge)
	if err := run("ip", "link", "set", cfg.Bridge, "up"); err != nil {
		return err
	}

	// enable forwarding + masquerade guest egress out the host uplink
	runOK("sysctl", "-w", "net.ipv4.ip_forward=1")
	if !iptablesHas("nat", "POSTROUTING", cfg.Subnet) {
		if err := run("iptables", "-t", "nat", "-A", "POSTROUTING",
			"-s", cfg.Subnet, "!", "-o", cfg.Bridge, "-j", "MASQUERADE"); err != nil {
			return err
		}
	}
	// allow bridged traffic to be forwarded
	runOK("iptables", "-A", "FORWARD", "-i", cfg.Bridge, "-j", "ACCEPT")
	runOK("iptables", "-A", "FORWARD", "-o", cfg.Bridge, "-j", "ACCEPT")
	log.Printf("bridge %s ready (%s)", cfg.Bridge, cfg.Subnet)
	return nil
}

func iptablesHas(table, chain, needle string) bool {
	out, _ := exec.Command("iptables", "-t", table, "-S", chain).CombinedOutput()
	return strings.Contains(string(out), needle)
}

// createTap makes a tap device and attaches it to the bridge, ready to be
// handed to firecracker as a NIC.
func createTap(cfg *Config, tapName string) error {
	deleteTap(tapName) // clear any stale device first
	if err := run("ip", "tuntap", "add", "dev", tapName, "mode", "tap"); err != nil {
		return err
	}
	if err := run("ip", "link", "set", tapName, "master", cfg.Bridge); err != nil {
		return err
	}
	return run("ip", "link", "set", tapName, "up")
}

func deleteTap(tapName string) {
	runOK("ip", "link", "del", tapName)
}

// addPortForward DNATs hostPort on the droplet to the guest's SSH port.
// Rules are also removed on stop; see removePortForward.
func addPortForward(hostPort int, guestIP string) error {
	dest := fmt.Sprintf("%s:22", guestIP)
	hp := fmt.Sprintf("%d", hostPort)
	// external traffic
	if err := run("iptables", "-t", "nat", "-A", "PREROUTING",
		"-p", "tcp", "--dport", hp, "-j", "DNAT", "--to-destination", dest); err != nil {
		return err
	}
	// host-local traffic (ssh from the droplet itself)
	return run("iptables", "-t", "nat", "-A", "OUTPUT",
		"-p", "tcp", "-o", "lo", "--dport", hp, "-j", "DNAT", "--to-destination", dest)
}

func removePortForward(hostPort int, guestIP string) {
	dest := fmt.Sprintf("%s:22", guestIP)
	hp := fmt.Sprintf("%d", hostPort)
	runOK("iptables", "-t", "nat", "-D", "PREROUTING",
		"-p", "tcp", "--dport", hp, "-j", "DNAT", "--to-destination", dest)
	runOK("iptables", "-t", "nat", "-D", "OUTPUT",
		"-p", "tcp", "-o", "lo", "--dport", hp, "-j", "DNAT", "--to-destination", dest)
}

// macFromIP derives a stable locally-administered MAC from the guest IP, so
// a given instance keeps the same MAC across reboots.
func macFromIP(ip string) string {
	var a, b, c, d int
	fmt.Sscanf(ip, "%d.%d.%d.%d", &a, &b, &c, &d)
	return fmt.Sprintf("02:fc:%02x:%02x:%02x:%02x", a, b, c, d)
}
