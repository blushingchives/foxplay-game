package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	KernelPath     string
	FirecrackerBin string
	InstancesDir   string // per-instance writable disks
	BaseImagesDir  string // {image}.ext4 base images
	Bridge         string
	GatewayIP      string
	Subnet         string
	Netmask        string
	PrefixLen      string
	ListenAddr     string
}

func main() {
	loadEnvFile()

	cfg := &Config{
		KernelPath:     getEnv("KERNEL_PATH", "/var/lib/foxplay/vmlinux.bin"),
		FirecrackerBin: getEnv("FIRECRACKER_BIN", "firecracker"),
		InstancesDir:   getEnv("INSTANCES_DIR", "/var/lib/foxplay/instances"),
		BaseImagesDir:  getEnv("BASE_IMAGES_DIR", "/var/lib/foxplay/base"),
		Bridge:         getEnv("BRIDGE", "fcbr0"),
		GatewayIP:      getEnv("GATEWAY_IP", "172.16.0.1"),
		Subnet:         getEnv("SUBNET", "172.16.0.0/24"),
		Netmask:        getEnv("NETMASK", "255.255.255.0"),
		PrefixLen:      getEnv("PREFIX_LEN", "24"),
		ListenAddr:     getEnv("LISTEN_ADDR", ":7000"),
	}

	mgr, err := NewManager(cfg)
	if err != nil {
		log.Fatalf("init manager: %v", err)
	}
	mgr.StartSampler(time.Duration(getEnvInt("SAMPLE_INTERVAL_SEC", 30)) * time.Second)

	// All lifecycle endpoints take the instance id as the last path segment.
	http.HandleFunc("/create/", specHandler(func(s InstanceSpec) error { return mgr.Create(s) }))
	http.HandleFunc("/start/", specHandler(func(s InstanceSpec) error { return mgr.Start(s) }))
	http.HandleFunc("/delete/", specHandler(func(s InstanceSpec) error { return mgr.Delete(s) }))

	http.HandleFunc("/stop/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/stop/")
		if id == "" {
			http.Error(w, "instance id required", http.StatusBadRequest)
			return
		}
		if err := mgr.Stop(id); err != nil {
			log.Printf("[%s] stop error: %v", id, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	http.HandleFunc("/status/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/status/")
		writeJSON(w, http.StatusOK, map[string]any{
			"id":      id,
			"running": mgr.IsRunning(id),
		})
	})

	http.HandleFunc("/running", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"running": mgr.RunningIDs()})
	})

	http.HandleFunc("/images", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"images": mgr.ListImages()})
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		mgr.mu.Lock()
		running := len(mgr.running)
		mgr.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"running": running})
	})

	log.Printf("instance-manager listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, nil))
}

// specHandler decodes an InstanceSpec body and runs a lifecycle action.
func specHandler(action func(InstanceSpec) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var spec InstanceSpec
		if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if spec.ID == "" {
			http.Error(w, "instance id required", http.StatusBadRequest)
			return
		}
		if err := action(spec); err != nil {
			log.Printf("[%s] error: %v", spec.ID, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func loadEnvFile() {
	data, err := os.ReadFile(".env")
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" && os.Getenv(key) == "" {
			os.Setenv(key, value)
		}
	}
}
