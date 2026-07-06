package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	store := &ArtifactStore{
		functionsDir: getEnv("FUNCTIONS_DIR", "/tmp/functions"),
	}

	os.MkdirAll(store.functionsDir, 0755)

	http.HandleFunc("/deploy/", store.handleDeploy)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
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
