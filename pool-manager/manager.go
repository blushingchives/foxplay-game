package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ErrCodeMissing means the function has no deployed image on disk — e.g.
// it was wiped or never deployed. Surfaced to callers as a 404.
var ErrCodeMissing = errors.New("function code not deployed")

type Config struct {
	KernelPath     string
	BaseRootfs     string
	FunctionsDir   string
	FirecrackerBin string
	WarmPoolSize   int
	MaxVMs         int // max concurrent VMs per function; 0 = unlimited
}

type VMState int

const (
	StateBooting VMState = iota
	StateWarm
	StateBusy
	StateDead
)

type VM struct {
	id         string
	pid        int
	socketPath string
	vsockPath  string
	state      VMState
	function   string
	lastUsed   time.Time
	bootKind   string // "cold" or "restored" — how this VM was created
	bootMs     int64  // wall-clock ms of the boot that created it
	fresh      bool   // true until its first invocation completes
}

type waiter struct {
	ch  chan *VM
	ctx context.Context
}

type Pool struct {
	warm    chan *VM
	waiting []*waiter
	mu      sync.Mutex
	booted  int // total VMs alive (warm + busy)
}

// popWaiter returns the first waiter whose client hasn't disconnected,
// discarding any cancelled ones. Must be called with pool.mu held.
func (pool *Pool) popWaiter() *waiter {
	for len(pool.waiting) > 0 {
		w := pool.waiting[0]
		pool.waiting = pool.waiting[1:]
		select {
		case <-w.ctx.Done():
			// client disconnected, skip
		default:
			return w
		}
	}
	return nil
}

type PoolManager struct {
	mu     sync.Mutex
	pools  map[string]*Pool
	config Config
}

const idleTimeout = 120 * time.Second

func NewPoolManager(cfg Config) *PoolManager {
	m := &PoolManager{
		pools:  make(map[string]*Pool),
		config: cfg,
	}
	go m.idleSweeper()
	return m
}

func (m *PoolManager) getPool(functionName string) *Pool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if pool, ok := m.pools[functionName]; ok {
		return pool
	}
	pool := &Pool{
		warm: make(chan *VM, m.config.WarmPoolSize),
	}
	m.pools[functionName] = pool
	return pool
}

func (m *PoolManager) Invoke(ctx context.Context, functionName string, event InvocationEvent) (*InvocationResponse, error) {
	pool := m.getPool(functionName)
	maxVMs := m.config.MaxVMs

	var vm *VM
	var startType string
	var queueWaitMs, bootMs int64

	// Fast path: try warm pool without locking
	select {
	case vm = <-pool.warm:
		startType = "warm"
		log.Printf("[%s] reusing warm VM %s", functionName, vm.id)
	default:
		// Slow path: decide whether to boot or queue
		pool.mu.Lock()

		// Re-check warm pool under lock — prevents the race where a VM was
		// returned between the select above and acquiring this lock.
		select {
		case vm = <-pool.warm:
			pool.mu.Unlock()
			startType = "warm"
			log.Printf("[%s] reusing warm VM %s", functionName, vm.id)
		default:
			if maxVMs <= 0 || pool.booted < maxVMs {
				pool.booted++
				pool.mu.Unlock()
				log.Printf("[%s] cold start (booted=%d)", functionName, pool.booted)
				var err error
				vm, err = m.bootVM(functionName)
				if err != nil {
					pool.mu.Lock()
					pool.booted--
					pool.mu.Unlock()
					m.failWaiters(pool)
					return nil, fmt.Errorf("boot VM: %w", err)
				}
				startType, bootMs = vm.bootKind, vm.bootMs
			} else {
				// At max capacity — queue this request
				w := &waiter{ch: make(chan *VM, 1), ctx: ctx}
				pool.waiting = append(pool.waiting, w)
				pool.mu.Unlock()
				log.Printf("[%s] at max VMs (%d), request queued", functionName, maxVMs)

				queueStart := time.Now()
				select {
				case vm = <-w.ch:
					if vm == nil {
						return nil, fmt.Errorf("[%s] queued request failed: VM boot error", functionName)
					}
					queueWaitMs = time.Since(queueStart).Milliseconds()
					// The VM is either a recycled warm one handed over by
					// returnVM, or a fresh replacement booted by discardVM.
					if vm.fresh {
						startType, bootMs = vm.bootKind, vm.bootMs
					} else {
						startType = "warm"
					}
					log.Printf("[%s] dequeued, got VM %s", functionName, vm.id)
				case <-ctx.Done():
					return nil, fmt.Errorf("[%s] request cancelled by client", functionName)
				}
			}
		}
	}

	vm.state = StateBusy
	vm.fresh = false
	// The full invocation envelope (method, path, query, headers, body) as
	// received from the caller — recorded per invocation for the metrics.
	requestJSON, _ := json.Marshal(event)
	cpuBefore, cpuOK := readCPUTicks(vm.pid)
	invokeStart := time.Now()
	resp, err := invokeViaVsock(vm.vsockPath, event)

	// Sample /proc and emit now, before discardVM can SIGTERM the process.
	rec := InvocationMetric{
		Function:    functionName,
		StartType:   startType,
		QueueWaitMs: queueWaitMs,
		BootMs:      bootMs,
		InvokeMs:    time.Since(invokeStart).Milliseconds(),
		MemPeakKB:   readPeakRSSKB(vm.pid),
		RequestBody: truncateBody(string(requestJSON)),
	}
	if cpuAfter, ok := readCPUTicks(vm.pid); ok && cpuOK && cpuAfter >= cpuBefore {
		rec.CPUMs = cpuTicksToMs(cpuAfter - cpuBefore)
	}
	switch {
	case err != nil:
		rec.InfraError = true // vsock/transport failure — no HTTP status
	case resp.InfraError:
		rec.Status, rec.InfraError = resp.Status, true
	default:
		rec.Status = resp.Status
	}
	emitMetric("/events/invocation", rec)

	if err != nil {
		log.Printf("[%s] VM %s unhealthy (vsock error), killing", functionName, vm.id)
		m.discardVM(pool, functionName, vm)
		return nil, err
	}

	if resp.InfraError {
		log.Printf("[%s] VM %s infra error (status %d), killing", functionName, vm.id, resp.Status)
		m.discardVM(pool, functionName, vm)
		return resp, nil
	}

	vm.state = StateWarm
	vm.lastUsed = time.Now()
	m.returnVM(pool, functionName, vm)

	return resp, nil
}

// returnVM gives a healthy VM to the next queued request, or puts it in the warm pool.
func (m *PoolManager) returnVM(pool *Pool, functionName string, vm *VM) {
	pool.mu.Lock()
	w := pool.popWaiter()
	pool.mu.Unlock()

	if w != nil {
		log.Printf("[%s] handing VM %s to queued request", functionName, vm.id)
		w.ch <- vm
		return
	}

	select {
	case pool.warm <- vm:
		log.Printf("[%s] VM %s returned to warm pool", functionName, vm.id)
	default:
		log.Printf("[%s] warm pool full, discarding VM %s", functionName, vm.id)
		killVM(vm)
		pool.mu.Lock()
		pool.booted--
		pool.mu.Unlock()
	}
}

// discardVM kills an unhealthy VM. If requests are queued and we now have
// capacity, it boots a replacement VM for the first waiter in a goroutine.
func (m *PoolManager) discardVM(pool *Pool, functionName string, vm *VM) {
	killVM(vm)

	pool.mu.Lock()
	pool.booted--
	maxVMs := m.config.MaxVMs

	var w *waiter
	if maxVMs <= 0 || pool.booted < maxVMs {
		w = pool.popWaiter()
		if w != nil {
			pool.booted++ // reserve the slot for the replacement
		}
	}
	pool.mu.Unlock()

	if w == nil {
		return
	}

	go func() {
		newVM, err := m.bootVM(functionName)
		if err != nil {
			log.Printf("[%s] replacement VM boot failed: %v", functionName, err)
			close(w.ch) // sends nil; Invoke treats nil as failure
			pool.mu.Lock()
			pool.booted--
			pool.mu.Unlock()
			m.failWaiters(pool)
			return
		}
		w.ch <- newVM
	}()
}

// failWaiters drains the waiting queue and closes each channel, causing
// blocked callers to receive nil and return an error.
func (m *PoolManager) failWaiters(pool *Pool) {
	pool.mu.Lock()
	waiters := pool.waiting
	pool.waiting = nil
	pool.mu.Unlock()

	for _, w := range waiters {
		close(w.ch)
	}
}

func (m *PoolManager) bootVM(functionName string) (*VM, error) {
	// Fail fast with a clear error when there is no image to boot —
	// otherwise this surfaces as an opaque firecracker drive-config failure.
	codeRootfs := fmt.Sprintf("%s/%s.ext4", m.config.FunctionsDir, functionName)
	if _, err := os.Stat(codeRootfs); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrCodeMissing, codeRootfs)
	}

	start := time.Now()

	// Snapshots are created by the artifact-store at deploy time. Restore
	// reuses the vsock UDS path baked into the snapshot, so it is only safe
	// while at most one VM per function can exist (MaxVMs == 1) — concurrent
	// VMs of one function would fight over the same socket.
	if m.config.MaxVMs == 1 && m.snapshotUsable(functionName) {
		vm, err := m.restoreVM(functionName)
		if err == nil {
			vm.bootKind, vm.bootMs, vm.fresh = "restored", time.Since(start).Milliseconds(), true
			return vm, nil
		}
		log.Printf("[%s] snapshot restore failed: %v — falling back to cold boot", functionName, err)
		m.removeSnapshot(functionName)
	}

	vm, err := m.coldBootVM(functionName)
	if err != nil {
		return nil, err
	}
	// A failed restore attempt counts into the cold bootMs — it's the
	// latency the caller actually experienced.
	vm.bootKind, vm.bootMs, vm.fresh = "cold", time.Since(start).Milliseconds(), true
	return vm, nil
}

func (m *PoolManager) newVMHandle(functionName string, canonicalVsock bool) *VM {
	id := newID()
	vsockPath := fmt.Sprintf("/tmp/fc-%s-vsock.sock", id)
	if canonicalVsock {
		// must match the path recorded in the function's snapshot
		vsockPath = fmt.Sprintf("/tmp/fc-fn-%s-vsock.sock", functionName)
	}
	return &VM{
		id:         id,
		socketPath: fmt.Sprintf("/tmp/fc-%s.sock", id),
		vsockPath:  vsockPath,
		state:      StateBooting,
		function:   functionName,
	}
}

// restoreVM spawns a firecracker process and resumes it from the function's
// snapshot, skipping the kernel boot and app startup entirely.
func (m *PoolManager) restoreVM(functionName string) (*VM, error) {
	vm := m.newVMHandle(functionName, true)
	snapPath, memPath := m.snapshotPaths(functionName)

	// a stale UDS file from a previous VM would break the vsock bind
	os.Remove(vm.vsockPath)

	pid, err := spawnFirecracker(m.config.FirecrackerBin, vm.socketPath)
	if err != nil {
		return nil, fmt.Errorf("spawn firecracker: %w", err)
	}
	vm.pid = pid

	if err := loadSnapshot(vm.socketPath, snapPath, memPath); err != nil {
		killVM(vm)
		return nil, fmt.Errorf("load snapshot: %w", err)
	}

	if err := waitForVsock(vm.vsockPath, 10*time.Second); err != nil {
		killVM(vm)
		return nil, fmt.Errorf("restored VM not ready: %w", err)
	}

	vm.state = StateWarm
	vm.lastUsed = time.Now()
	log.Printf("[%s] VM %s restored from snapshot", functionName, vm.id)
	return vm, nil
}

func (m *PoolManager) coldBootVM(functionName string) (*VM, error) {
	vm := m.newVMHandle(functionName, false)
	codeRootfs := fmt.Sprintf("%s/%s.ext4", m.config.FunctionsDir, functionName)

	pid, err := spawnFirecracker(m.config.FirecrackerBin, vm.socketPath)
	if err != nil {
		return nil, fmt.Errorf("spawn firecracker: %w", err)
	}
	vm.pid = pid

	if err := configureVM(vm.socketPath, m.config.KernelPath, m.config.BaseRootfs, codeRootfs, vm.vsockPath); err != nil {
		killVM(vm)
		return nil, fmt.Errorf("configure VM: %w", err)
	}

	if err := startVM(vm.socketPath); err != nil {
		killVM(vm)
		return nil, fmt.Errorf("start VM: %w", err)
	}

	log.Printf("[%s] VM %s booting, waiting for bootstrap...", functionName, vm.id)

	if err := waitForVsock(vm.vsockPath, 30*time.Second); err != nil {
		killVM(vm)
		return nil, fmt.Errorf("VM not ready: %w", err)
	}

	vm.state = StateWarm
	vm.lastUsed = time.Now()
	log.Printf("[%s] VM %s ready", functionName, vm.id)
	return vm, nil
}

func (m *PoolManager) snapshotPaths(functionName string) (snapPath, memPath string) {
	base := filepath.Join(m.config.FunctionsDir, functionName)
	return base + ".snap", base + ".mem"
}

func (m *PoolManager) removeSnapshot(functionName string) {
	snapPath, memPath := m.snapshotPaths(functionName)
	os.Remove(snapPath)
	os.Remove(memPath)
}

// snapshotUsable reports whether a deploy-time snapshot from the
// artifact-store exists and is newer than both rootfs images it references —
// a redeploy of the function or a rebuild of the base image silently
// invalidates the old snapshot.
func (m *PoolManager) snapshotUsable(functionName string) bool {
	snapPath, memPath := m.snapshotPaths(functionName)
	snapInfo, err := os.Stat(snapPath)
	if err != nil {
		return false
	}
	if _, err := os.Stat(memPath); err != nil {
		return false
	}
	code, err := os.Stat(fmt.Sprintf("%s/%s.ext4", m.config.FunctionsDir, functionName))
	if err != nil || !snapInfo.ModTime().After(code.ModTime()) {
		return false
	}
	base, err := os.Stat(m.config.BaseRootfs)
	if err != nil || !snapInfo.ModTime().After(base.ModTime()) {
		return false
	}
	return true
}

// idleSweeper kills warm VMs that have been idle longer than idleTimeout.
func (m *PoolManager) idleSweeper() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		m.mu.Lock()
		pools := make(map[string]*Pool, len(m.pools))
		for k, v := range m.pools {
			pools[k] = v
		}
		m.mu.Unlock()

		now := time.Now()
		for functionName, pool := range pools {
			var live []*VM
			for {
				select {
				case vm := <-pool.warm:
					if now.Sub(vm.lastUsed) > idleTimeout {
						log.Printf("[%s] VM %s idle for %s, killing", functionName, vm.id, now.Sub(vm.lastUsed).Round(time.Second))
						killVM(vm)
						pool.mu.Lock()
						pool.booted--
						pool.mu.Unlock()
					} else {
						live = append(live, vm)
					}
				default:
					goto done
				}
			}
		done:
			for _, vm := range live {
				select {
				case pool.warm <- vm:
				default:
					killVM(vm)
					pool.mu.Lock()
					pool.booted--
					pool.mu.Unlock()
				}
			}
		}
	}
}

type PoolStats struct {
	VMs    int `json:"vms"`
	Queued int `json:"queued"`
}

type ManagerStats struct {
	VMs   int                    `json:"vms"`
	Queued int                   `json:"queued"`
	Pools  map[string]PoolStats  `json:"pools"`
}

func (m *PoolManager) Stats() ManagerStats {
	m.mu.Lock()
	pools := make(map[string]*Pool, len(m.pools))
	for k, v := range m.pools {
		pools[k] = v
	}
	m.mu.Unlock()

	stats := ManagerStats{Pools: make(map[string]PoolStats)}
	for name, pool := range pools {
		pool.mu.Lock()
		booted := pool.booted
		pool.mu.Unlock()
		queued := len(pool.waiting)
		stats.VMs += booted
		stats.Queued += queued
		stats.Pools[name] = PoolStats{VMs: booted, Queued: queued}
	}
	return stats
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}
