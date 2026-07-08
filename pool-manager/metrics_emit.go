package main

// Fire-and-forget event emission to the metrics service. This file is
// duplicated in artifact-store (matching how the firecracker helpers are
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

type InvocationMetric struct {
	Function    string `json:"function"`
	StartType   string `json:"start_type"`
	QueueWaitMs int64  `json:"queue_wait_ms"`
	BootMs      int64  `json:"boot_ms"`
	InvokeMs    int64  `json:"invoke_ms"`
	Status      int    `json:"status"`
	InfraError  bool   `json:"infra_error"`
	CPUMs       int64  `json:"cpu_ms"`
	MemPeakKB   int64  `json:"mem_peak_kb"`
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
