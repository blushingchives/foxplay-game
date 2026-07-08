package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
)

func main() {
	loadEnvFile()
	store := NewStore(getEnv("DATABASE_URL", ""))

	http.HandleFunc("/events/invocation", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !requireDB(w, store) {
			return
		}
		var ev InvocationEvent
		if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if ev.Function == "" {
			http.Error(w, "function is required", http.StatusBadRequest)
			return
		}
		switch ev.StartType {
		case "cold", "restored", "warm":
		default:
			http.Error(w, "start_type must be cold, restored, or warm", http.StatusBadRequest)
			return
		}
		if err := store.InsertInvocation(ev); err != nil {
			log.Printf("insert invocation: %v", err)
			http.Error(w, "insert failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	http.HandleFunc("/events/deployment", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !requireDB(w, store) {
			return
		}
		var ev DeploymentEvent
		if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if ev.Function == "" {
			http.Error(w, "function is required", http.StatusBadRequest)
			return
		}
		if err := store.InsertDeployment(ev); err != nil {
			log.Printf("insert deployment: %v", err)
			http.Error(w, "insert failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	http.HandleFunc("/functions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !requireDB(w, store) {
			return
		}
		functions, err := store.ListFunctions()
		if err != nil {
			log.Printf("list functions: %v", err)
			http.Error(w, "query failed", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"functions": functions})
	})

	// /functions/{name} and /functions/{name}/invocations
	http.HandleFunc("/functions/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !requireDB(w, store) {
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/functions/"), "/")
		switch {
		case len(parts) == 1 && parts[0] != "":
			detail, err := store.FunctionDetail(parts[0])
			if err != nil {
				log.Printf("function detail: %v", err)
				http.Error(w, "query failed", http.StatusInternalServerError)
				return
			}
			if detail == nil {
				http.NotFound(w, r)
				return
			}
			writeJSON(w, http.StatusOK, detail)
		case len(parts) == 2 && parts[0] != "" && parts[1] == "invocations":
			limit := 50
			if v := r.URL.Query().Get("limit"); v != "" {
				if n, err := strconv.Atoi(v); err == nil && n > 0 {
					limit = n
				}
			}
			if limit > 500 {
				limit = 500
			}
			invocations, err := store.RecentInvocations(parts[0], limit)
			if err != nil {
				log.Printf("recent invocations: %v", err)
				http.Error(w, "query failed", http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"invocations": invocations})
		default:
			http.NotFound(w, r)
		}
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		status := "ok"
		if store.db == nil {
			status = "not configured"
		} else if !store.ready.Load() {
			status = "unavailable"
		}
		writeJSON(w, http.StatusOK, map[string]string{"database": status})
	})

	addr := getEnv("LISTEN_ADDR", ":7070")
	log.Printf("metrics listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func requireDB(w http.ResponseWriter, store *Store) bool {
	if store.Ready() {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no database configured"})
	return false
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
