package main

import (
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
	socketPath string // Firecracker API socket
	vsockPath  string // vsock UDS path
	state      VMState
	function   string
}

type Pool struct {
	warm chan *VM // buffered channel of ready VMs
}

type PoolManager struct {
	mu     sync.Mutex
	pools  map[string]*Pool
	config Config
}

func NewPoolManager(cfg Config) *PoolManager {
	return &PoolManager{
		pools:  make(map[string]*Pool),
		config: cfg,
	}
}

func (m *PoolManager) getPool(functionName string) *Pool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if pool, ok := m.pools[functionName]; ok {
		return pool
	}

	pool := &Pool{
		warm: make(chan *VM, 10),
	}
	m.pools[functionName] = pool
	return pool
}

func (m *PoolManager) Invoke(functionName string, event InvocationEvent) (*InvocationResponse, error) {
	pool := m.getPool(functionName)

	// Try to get a warm VM, otherwise boot a new one
	var vm *VM
	select {
	case vm = <-pool.warm:
		log.Printf("[%s] reusing warm VM %s", functionName, vm.id)
	default:
		log.Printf("[%s] cold start — booting new VM", functionName)
		var err error
		vm, err = m.bootVM(functionName)
		if err != nil {
			return nil, fmt.Errorf("boot VM: %w", err)
		}
	}

	vm.state = StateBusy

	resp, err := invokeViaVsock(vm.vsockPath, event)

	// Return VM to warm pool regardless of invocation result
	vm.state = StateWarm
	select {
	case pool.warm <- vm:
		log.Printf("[%s] VM %s returned to warm pool", functionName, vm.id)
	default:
		// Pool is full — kill this VM
		log.Printf("[%s] warm pool full, discarding VM %s", functionName, vm.id)
		killVM(vm)
	}

	return resp, err
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
		return nil, fmt.Errorf("configure VM: %w", err)
	}

	if err := startVM(socketPath); err != nil {
		return nil, fmt.Errorf("start VM: %w", err)
	}

	log.Printf("[%s] VM %s booting, waiting for bootstrap...", functionName, id)

	if err := waitForVsock(vsockPath, 30*time.Second); err != nil {
		return nil, fmt.Errorf("VM not ready: %w", err)
	}

	vm.state = StateWarm
	log.Printf("[%s] VM %s ready", functionName, id)
	return vm, nil
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}
