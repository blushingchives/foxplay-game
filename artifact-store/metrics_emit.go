package main

// Fire-and-forget event emission to the metrics service. This file is
// duplicated in pool-manager (matching how the firecracker helpers are
// shared by copy between the two modules).

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

var metricsClient = &http.Client{Timeout: 2 * time.Second}

// Resolved per call rather than in a package-level var: those initialize
// before main() runs loadEnvFile(), which would miss METRICS_URL from .env.
func metricsURL() string {
	return getEnv("METRICS_URL", "http://localhost:7070")
}

type DeploymentMetric struct {
	Function            string `json:"function"`
	ImageSizeBytes      int64  `json:"image_size_bytes"`
	BuildMs             int64  `json:"build_ms"`
	SnapshotEnabled     bool   `json:"snapshot_enabled"`
	SnapshotMs          int64  `json:"snapshot_ms"`
	SnapshotOK          bool   `json:"snapshot_ok"`
	KernelPath          string `json:"kernel_path"`
	KernelSizeBytes     int64  `json:"kernel_size_bytes"`
	BaseRootfsPath      string `json:"base_rootfs_path"`
	BaseRootfsSizeBytes int64  `json:"base_rootfs_size_bytes"`
	BootstrapVersion    string `json:"bootstrap_version"`
}

// emitMetric POSTs payload to the metrics service in the background.
// Failures are logged and dropped — metrics being down must never fail
// or slow the caller.
func emitMetric(path string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("metrics: marshal: %v", err)
		return
	}
	go func() {
		resp, err := metricsClient.Post(metricsURL()+path, "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("metrics: emit %s: %v", path, err)
			return
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			log.Printf("metrics: emit %s -> %d", path, resp.StatusCode)
		}
	}()
}
