package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"sync"
	"time"
)

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

	// Fast path: try warm pool without locking
	select {
	case vm = <-pool.warm:
		log.Printf("[%s] reusing warm VM %s", functionName, vm.id)
	default:
		// Slow path: decide whether to boot or queue
		pool.mu.Lock()

		// Re-check warm pool under lock — prevents the race where a VM was
		// returned between the select above and acquiring this lock.
		select {
		case vm = <-pool.warm:
			pool.mu.Unlock()
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
			} else {
				// At max capacity — queue this request
				w := &waiter{ch: make(chan *VM, 1), ctx: ctx}
				pool.waiting = append(pool.waiting, w)
				pool.mu.Unlock()
				log.Printf("[%s] at max VMs (%d), request queued", functionName, maxVMs)

				select {
				case vm = <-w.ch:
					if vm == nil {
						return nil, fmt.Errorf("[%s] queued request failed: VM boot error", functionName)
					}
					log.Printf("[%s] dequeued, got VM %s", functionName, vm.id)
				case <-ctx.Done():
					return nil, fmt.Errorf("[%s] request cancelled by client", functionName)
				}
			}
		}
	}

	vm.state = StateBusy
	resp, err := invokeViaVsock(vm.vsockPath, event)

	if err != nil {
		log.Printf("[%s] VM %s unhealthy (vsock error), killing", functionName, vm.id)
		m.discardVM(pool, functionName, vm)
		return nil, err
	}

	if resp.Status >= 500 {
		log.Printf("[%s] VM %s returned status %d, killing", functionName, vm.id, resp.Status)
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
	id := newID()
	socketPath := fmt.Sprintf("/tmp/fc-%s.sock", id)
	vsockPath := fmt.Sprintf("/tmp/fc-%s-vsock.sock", id)
	codeRootfs := fmt.Sprintf("%s/%s.ext4", m.config.FunctionsDir, functionName)

	vm := &VM{
		id:         id,
		socketPath: socketPath,
		vsockPath:  vsockPath,
		state:      StateBooting,
		function:   functionName,
	}

	pid, err := spawnFirecracker(m.config.FirecrackerBin, socketPath)
	if err != nil {
		return nil, fmt.Errorf("spawn firecracker: %w", err)
	}
	vm.pid = pid

	if err := configureVM(socketPath, m.config.KernelPath, m.config.BaseRootfs, codeRootfs, vsockPath); err != nil {
		killVM(vm)
		return nil, fmt.Errorf("configure VM: %w", err)
	}

	if err := startVM(socketPath); err != nil {
		killVM(vm)
		return nil, fmt.Errorf("start VM: %w", err)
	}

	log.Printf("[%s] VM %s booting, waiting for bootstrap...", functionName, id)

	if err := waitForVsock(vsockPath, 30*time.Second); err != nil {
		killVM(vm)
		return nil, fmt.Errorf("VM not ready: %w", err)
	}

	vm.state = StateWarm
	vm.lastUsed = time.Now()
	log.Printf("[%s] VM %s ready", functionName, id)
	return vm, nil
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

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}
