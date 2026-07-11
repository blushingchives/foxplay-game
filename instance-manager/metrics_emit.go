package main

// Fire-and-forget usage sampling to the metrics service. Same shared-by-copy
// emitter as the other services; failures are logged and dropped so metrics
// being down never disrupts an instance.

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

var metricsClient = &http.Client{Timeout: 2 * time.Second}

// Resolved per call rather than in a package-level var: vars initialize
// before main() runs loadEnvFile(), which would miss METRICS_URL from .env.
func metricsURL() string {
	return getEnv("METRICS_URL", "http://localhost:7070")
}

type InstanceMetric struct {
	InstanceID string `json:"instance_id"`
	CPUPct     int    `json:"cpu_pct"`
	MemRSSKB   int64  `json:"mem_rss_kb"`
}

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
