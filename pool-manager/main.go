package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

func cleanupStaleVMs() {
	exec.Command("pkill", "-f", "firecracker --api-sock").Run()
	matches, _ := filepath.Glob("/tmp/fc-*")
	for _, f := range matches {
		os.Remove(f)
	}
	log.Printf("cleaned up %d stale VM files", len(matches))
}

func main() {
	loadEnvFile()
	cleanupStaleVMs()
	mgr := NewPoolManager(Config{
		KernelPath:     getEnv("KERNEL_PATH", "/tmp/fc/vmlinux.bin"),
		BaseRootfs:     getEnv("BASE_ROOTFS", "/tmp/node22.ext4"),
		FunctionsDir:   getEnv("FUNCTIONS_DIR", "/tmp/functions"),
		FirecrackerBin: getEnv("FIRECRACKER_BIN", "firecracker"),
		WarmPoolSize:   1,
		MaxVMs:         getEnvInt("MAX_VMS", 1),
	})

	http.HandleFunc("/invoke/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		functionName := strings.TrimPrefix(r.URL.Path, "/invoke/")
		if functionName == "" {
			http.Error(w, "function name required", http.StatusBadRequest)
			return
		}

		var event InvocationEvent
		if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// r.Context() is not cancelled on HTTP/1.1 client disconnect while the
		// handler is blocked. CloseNotifier actively watches the connection.
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		if cn, ok := w.(http.CloseNotifier); ok {
			go func() {
				select {
				case <-cn.CloseNotify():
					cancel()
				case <-ctx.Done():
				}
			}()
		}

		resp, err := mgr.Invoke(ctx, functionName, event)
		if err != nil {
			log.Printf("[%s] invocation error: %v", functionName, err)
			if errors.Is(err, ErrCodeMissing) {
				http.Error(w, "function code is missing: no image deployed for '"+functionName+"' — deploy it first", http.StatusNotFound)
				return
			}
			http.Error(w, "invocation failed", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.Status)
		json.NewEncoder(w).Encode(resp)
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mgr.Stats())
	})

	addr := getEnv("LISTEN_ADDR", ":8080")
	log.Printf("Pool manager listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadEnvFile reads KEY=VALUE lines from a .env file in the working
// directory into the process environment. Variables already set externally
// win. Blank lines and #-comments are ignored; values may be quoted.
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

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
