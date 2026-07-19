package main

// Instance lifecycle orchestration. State of record lives in Postgres, owned
// by the frontend; this service is a stateless executor keyed by instance id
// that tracks only the VMs it is currently running in memory. A restart of
// this service therefore stops running instances (Phase 2: re-adopt on
// startup) — the frontend reconciles state via GET /status.

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

// InstanceSpec is the request payload from the frontend. The frontend (DB
// owner) allocates guest_ip and ssh_host_port and passes them in.
type InstanceSpec struct {
	ID           string `json:"id"`
	BaseImage    string `json:"base_image"`
	VCPU         int    `json:"vcpu"`
	MemMiB       int    `json:"mem_mib"`
	GuestIP      string `json:"guest_ip"`
	SSHHostPort  int    `json:"ssh_host_port"`
	SSHPublicKey string `json:"ssh_public_key"`
}

// instanceBoot is what configureInstance needs, spec plus host config.
type instanceBoot struct {
	KernelPath string
	DiskPath   string
	TapName    string
	GuestMAC   string
	GuestIP    string
	GatewayIP  string
	Netmask    string
	Hostname   string
	VCPU       int
	MemMiB     int
}

type runningVM struct {
	id          string
	pid         int
	socketPath  string
	tapName     string
	guestIP     string
	sshHostPort int
	// sampler bookkeeping for CPU-percent deltas
	lastTicks  uint64
	lastSample time.Time
}

// runState is the on-disk record of a running VM, so the manager can re-adopt
// VMs that outlived a manager restart (the systemd unit uses KillMode=process
// to keep them alive). Written on start, removed on stop/delete.
type runState struct {
	ID          string `json:"id"`
	PID         int    `json:"pid"`
	SocketPath  string `json:"socket_path"`
	TapName     string `json:"tap_name"`
	GuestIP     string `json:"guest_ip"`
	SSHHostPort int    `json:"ssh_host_port"`
}

type Manager struct {
	cfg     *Config
	mu      sync.Mutex
	running map[string]*runningVM
}

func NewManager(cfg *Config) (*Manager, error) {
	if err := setupBridge(cfg); err != nil {
		return nil, fmt.Errorf("setup bridge: %w", err)
	}
	m := &Manager{cfg: cfg, running: map[string]*runningVM{}}
	m.adopt()
	return m, nil
}

func (m *Manager) runStatePath(id string) string {
	return filepath.Join(m.cfg.InstancesDir, id+".run.json")
}

func (m *Manager) writeRunState(vm *runningVM) {
	data, err := json.Marshal(runState{
		ID: vm.id, PID: vm.pid, SocketPath: vm.socketPath,
		TapName: vm.tapName, GuestIP: vm.guestIP, SSHHostPort: vm.sshHostPort,
	})
	if err != nil {
		return
	}
	os.WriteFile(m.runStatePath(vm.id), data, 0644)
}

func (m *Manager) removeRunState(id string) {
	os.Remove(m.runStatePath(id))
}

// adopt re-attaches VMs still running from before a manager restart, and
// cleans up state + host networking for any that died while it was down.
func (m *Manager) adopt() {
	matches, _ := filepath.Glob(filepath.Join(m.cfg.InstancesDir, "*.run.json"))
	adopted, cleaned := 0, 0
	for _, f := range matches {
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var rs runState
		if json.Unmarshal(data, &rs) != nil {
			os.Remove(f)
			continue
		}
		if processAlive(rs.PID) {
			m.running[rs.ID] = &runningVM{
				id: rs.ID, pid: rs.PID, socketPath: rs.SocketPath,
				tapName: rs.TapName, guestIP: rs.GuestIP, sshHostPort: rs.SSHHostPort,
			}
			adopted++
		} else {
			// died while we were down — clean up leftover host state
			m.teardownNet(rs.TapName, rs.SSHHostPort, rs.GuestIP)
			os.Remove(rs.SocketPath)
			os.Remove(f)
			cleaned++
		}
	}
	if adopted > 0 || cleaned > 0 {
		log.Printf("adopt: re-attached %d running, cleaned %d dead", adopted, cleaned)
	}
}

func tapNameFor(id string) string {
	// interface names cap at 15 chars; use the short hash after the prefix
	h := id
	if i := len(id) - 8; i > 0 {
		h = id[i:]
	}
	return "fctap" + h
}

func (m *Manager) socketPath(id string) string {
	return fmt.Sprintf("/tmp/fc-inst-%s.sock", id)
}

// Create provisions the disk (copying the base image, injecting the key) and
// then boots the instance.
func (m *Manager) Create(spec InstanceSpec) error {
	if err := m.provisionDisk(spec.ID, spec.BaseImage, spec.SSHPublicKey); err != nil {
		return err
	}
	return m.Start(spec)
}

// Start boots an already-provisioned instance: tap, port-forward, firecracker.
func (m *Manager) Start(spec InstanceSpec) error {
	m.mu.Lock()
	if _, ok := m.running[spec.ID]; ok {
		m.mu.Unlock()
		return nil // already running
	}
	m.mu.Unlock()

	if !m.diskExists(spec.ID) {
		return fmt.Errorf("instance disk missing — create it first")
	}

	tap := tapNameFor(spec.ID)
	if err := createTap(m.cfg, tap); err != nil {
		return fmt.Errorf("create tap: %w", err)
	}
	if err := addPortForward(spec.SSHHostPort, spec.GuestIP); err != nil {
		deleteTap(tap)
		return fmt.Errorf("port forward: %w", err)
	}

	socketPath := m.socketPath(spec.ID)
	os.Remove(socketPath)
	pid, err := spawnFirecracker(m.cfg.FirecrackerBin, socketPath)
	if err != nil {
		m.teardownNet(tap, spec.SSHHostPort, spec.GuestIP)
		return fmt.Errorf("spawn firecracker: %w", err)
	}
	fail := func(format string, e error) error {
		m.killPID(pid)
		m.teardownNet(tap, spec.SSHHostPort, spec.GuestIP)
		os.Remove(socketPath)
		return fmt.Errorf(format+": %w", e)
	}

	boot := instanceBoot{
		KernelPath: m.cfg.KernelPath,
		DiskPath:   m.diskPath(spec.ID),
		TapName:    tap,
		GuestMAC:   macFromIP(spec.GuestIP),
		GuestIP:    spec.GuestIP,
		GatewayIP:  m.cfg.GatewayIP,
		Netmask:    m.cfg.Netmask,
		Hostname:   spec.ID,
		VCPU:       spec.VCPU,
		MemMiB:     spec.MemMiB,
	}
	if err := configureInstance(socketPath, boot); err != nil {
		return fail("configure instance", err)
	}
	if err := startVM(socketPath); err != nil {
		return fail("start VM", err)
	}

	vm := &runningVM{
		id: spec.ID, pid: pid, socketPath: socketPath,
		tapName: tap, guestIP: spec.GuestIP, sshHostPort: spec.SSHHostPort,
	}
	m.mu.Lock()
	m.running[spec.ID] = vm
	m.mu.Unlock()
	m.writeRunState(vm)
	log.Printf("[%s] started (pid %d, ip %s, ssh :%d)", spec.ID, pid, spec.GuestIP, spec.SSHHostPort)
	return nil
}

// Stop gracefully shuts the guest down and tears down its host networking,
// keeping the disk. A later Start cold-boots.
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	vm, ok := m.running[id]
	if ok {
		delete(m.running, id)
	}
	m.mu.Unlock()
	if !ok {
		return nil // not running
	}

	// Ask the guest to power down; fall back to SIGKILL after a grace period.
	sendCtrlAltDel(vm.socketPath)
	if !m.waitExit(vm.pid, 15*time.Second) {
		log.Printf("[%s] did not shut down in time, killing", id)
		m.killPID(vm.pid)
	}
	m.teardownNet(vm.tapName, vm.sshHostPort, vm.guestIP)
	os.Remove(vm.socketPath)
	m.removeRunState(id)
	log.Printf("[%s] stopped", id)
	return nil
}

// Delete hard-kills the instance (the disk is going away, no clean shutdown
// needed), then removes its disk and any lingering host state.
func (m *Manager) Delete(spec InstanceSpec) error {
	m.mu.Lock()
	vm, ok := m.running[spec.ID]
	if ok {
		delete(m.running, spec.ID)
	}
	m.mu.Unlock()
	if ok {
		m.killPID(vm.pid)
		m.teardownNet(vm.tapName, vm.sshHostPort, vm.guestIP)
		os.Remove(vm.socketPath)
	}
	// tap/forward may linger if it was never running under this process
	m.teardownNet(tapNameFor(spec.ID), spec.SSHHostPort, spec.GuestIP)
	m.removeRunState(spec.ID)
	m.removeDisk(spec.ID)
	log.Printf("[%s] deleted", spec.ID)
	return nil
}

func (m *Manager) IsRunning(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.running[id]
	return ok
}

// RunningIDs is the set of instances the manager currently has running, used
// by the frontend to reconcile DB state (e.g. after a host reboot).
func (m *Manager) RunningIDs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	ids := make([]string, 0, len(m.running))
	for id := range m.running {
		ids = append(ids, id)
	}
	return ids
}

// ListImages returns the base image names available on the host (one per
// {name}.ext4 under BaseImagesDir).
func (m *Manager) ListImages() []string {
	matches, _ := filepath.Glob(filepath.Join(m.cfg.BaseImagesDir, "*.ext4"))
	names := make([]string, 0, len(matches))
	for _, f := range matches {
		names = append(names, strings.TrimSuffix(filepath.Base(f), ".ext4"))
	}
	sort.Strings(names)
	return names
}

// StartSampler periodically samples CPU/memory of every running instance and
// emits it to the metrics service.
func (m *Manager) StartSampler(interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for range t.C {
			m.sampleOnce()
		}
	}()
}

func (m *Manager) sampleOnce() {
	m.mu.Lock()
	vms := make([]*runningVM, 0, len(m.running))
	for _, vm := range m.running {
		vms = append(vms, vm)
	}
	m.mu.Unlock()

	now := time.Now()
	for _, vm := range vms {
		ticks, ok := readCPUTicks(vm.pid)
		rss := readRSSKB(vm.pid)

		cpuPct := 0
		m.mu.Lock()
		if ok && !vm.lastSample.IsZero() && ticks >= vm.lastTicks {
			// USER_HZ=100, so pct-of-one-core = deltaTicks / deltaSeconds.
			if dt := now.Sub(vm.lastSample).Seconds(); dt > 0 {
				cpuPct = int(float64(ticks-vm.lastTicks) / dt)
			}
		}
		if ok {
			vm.lastTicks = ticks
			vm.lastSample = now
		}
		m.mu.Unlock()

		emitMetric("/events/instance", InstanceMetric{
			InstanceID: vm.id, CPUPct: cpuPct, MemRSSKB: rss,
		})
	}
}

func (m *Manager) teardownNet(tap string, hostPort int, guestIP string) {
	if hostPort > 0 && guestIP != "" {
		removePortForward(hostPort, guestIP)
	}
	deleteTap(tap)
}

func (m *Manager) killPID(pid int) {
	if pid > 0 {
		if p, err := os.FindProcess(pid); err == nil {
			p.Signal(syscall.SIGKILL)
		}
	}
}

// waitExit polls until the process is gone or the timeout elapses.
func (m *Manager) waitExit(pid int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return !processAlive(pid)
}

// processAlive reports whether the pid is still running (signal 0 probe).
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return p.Signal(syscall.Signal(0)) == nil
}
