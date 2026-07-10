package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	loadEnvFile()
	store := &ArtifactStore{
		functionsDir:   getEnv("FUNCTIONS_DIR", "/tmp/functions"),
		kernelPath:     getEnv("KERNEL_PATH", "/tmp/fc/vmlinux.bin"),
		baseRootfs:     getEnv("BASE_ROOTFS", "/tmp/node22.ext4"),
		firecrackerBin: getEnv("FIRECRACKER_BIN", "firecracker"),
	}

	os.MkdirAll(store.functionsDir, 0755)

	http.HandleFunc("/deploy/", store.handleDeploy)
	http.HandleFunc("/delete/", store.handleDelete)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		entries, _ := os.ReadDir(store.functionsDir)
		var totalBytes int64
		functions := map[string]int64{}
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".ext4") {
				if info, err := e.Info(); err == nil {
					name := strings.TrimSuffix(e.Name(), ".ext4")
					functions[name] = info.Size()
					totalBytes += info.Size()
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"artifacts":   len(functions),
			"total_bytes": totalBytes,
			"functions":   functions,
		})
	})

	addr := getEnv("LISTEN_ADDR", ":9090")
	log.Printf("artifact-store listening on %s", addr)
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
