package main

import (
	"database/sql"
	"log"
	"sort"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
)

type InvocationEvent struct {
	Function    string `json:"function"`
	StartType   string `json:"start_type"`
	QueueWaitMs int64  `json:"queue_wait_ms"`
	BootMs      int64  `json:"boot_ms"`
	InvokeMs    int64  `json:"invoke_ms"`
	Status      int    `json:"status"`
	InfraError  bool   `json:"infra_error"`
	CPUMs       int64  `json:"cpu_ms"`
	MemPeakKB   int64  `json:"mem_peak_kb"`
	RequestBody string `json:"request_body"`
}

type DeploymentEvent struct {
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

type InstanceMetricEvent struct {
	InstanceID string `json:"instance_id"`
	CPUPct     int    `json:"cpu_pct"`
	MemRSSKB   int64  `json:"mem_rss_kb"`
}

type FunctionSummary struct {
	Name           string     `json:"name"`
	Runs           int64      `json:"runs"`
	LastRun        *time.Time `json:"last_run"`
	InfraErrors    int64      `json:"infra_errors"`
	HasSnapshot    bool       `json:"has_snapshot"`
	LastDeployedAt *time.Time `json:"last_deployed_at"`
	ImageSizeBytes int64      `json:"image_size_bytes"`
}

type StartTypeStats struct {
	Count          int64 `json:"count"`
	AvgInvokeMs    int64 `json:"avg_invoke_ms"`
	P95InvokeMs    int64 `json:"p95_invoke_ms"`
	AvgBootMs      int64 `json:"avg_boot_ms"`
	AvgQueueWaitMs int64 `json:"avg_queue_wait_ms"`
	AvgCPUMs       int64 `json:"avg_cpu_ms"`
	MaxMemPeakKB   int64 `json:"max_mem_peak_kb"`
}

type DeploymentRow struct {
	CreatedAt           time.Time `json:"created_at"`
	ImageSizeBytes      int64     `json:"image_size_bytes"`
	BuildMs             int64     `json:"build_ms"`
	SnapshotEnabled     bool      `json:"snapshot_enabled"`
	SnapshotMs          int64     `json:"snapshot_ms"`
	SnapshotOK          bool      `json:"snapshot_ok"`
	KernelPath          string    `json:"kernel_path"`
	KernelSizeBytes     int64     `json:"kernel_size_bytes"`
	BaseRootfsPath      string    `json:"base_rootfs_path"`
	BaseRootfsSizeBytes int64     `json:"base_rootfs_size_bytes"`
	BootstrapVersion    string    `json:"bootstrap_version"`
}

type FunctionDetail struct {
	Name           string                    `json:"name"`
	Runs           int64                     `json:"runs"`
	LastRun        *time.Time                `json:"last_run"`
	InfraErrors    int64                     `json:"infra_errors"`
	ByStartType    map[string]StartTypeStats `json:"by_start_type"`
	LastDeployment *DeploymentRow            `json:"last_deployment"`
}

type InvocationRow struct {
	StartType   string    `json:"start_type"`
	QueueWaitMs int64     `json:"queue_wait_ms"`
	BootMs      int64     `json:"boot_ms"`
	InvokeMs    int64     `json:"invoke_ms"`
	Status      int       `json:"status"`
	InfraError  bool      `json:"infra_error"`
	CPUMs       int64     `json:"cpu_ms"`
	MemPeakKB   int64     `json:"mem_peak_kb"`
	RequestBody string    `json:"request_body"`
	CreatedAt   time.Time `json:"created_at"`
}

// Store wraps the Postgres connection. It runs in a degraded mode when no
// DATABASE_URL is configured or the database is unreachable: Ready() stays
// false and handlers respond 503 until the database answers a ping.
// Schema is owned by database/migrations, applied by dbmate in deploy.sh.
type Store struct {
	db    *sql.DB
	ready atomic.Bool
}

func NewStore(databaseURL string) *Store {
	s := &Store{}
	if databaseURL == "" {
		log.Println("DATABASE_URL not set — running without a database")
		return s
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Printf("open database: %v — running without a database", err)
		return s
	}
	s.db = db
	go s.waitReadyLoop()
	return s
}

func (s *Store) Ready() bool {
	return s.db != nil && s.ready.Load()
}

// waitReadyLoop flips Ready once the database answers. DDL lives in
// database/migrations — this service assumes the schema exists.
func (s *Store) waitReadyLoop() {
	for {
		if err := s.db.Ping(); err != nil {
			log.Printf("database not ready: %v (retrying in 30s)", err)
			time.Sleep(30 * time.Second)
			continue
		}
		s.ready.Store(true)
		log.Println("database ready")
		return
	}
}

func (s *Store) InsertInvocation(ev InvocationEvent) error {
	_, err := s.db.Exec(`INSERT INTO invocations
		(function_id, start_type, queue_wait_ms, boot_ms, invoke_ms, status, infra_error, cpu_ms, mem_peak_kb, request_body)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		ev.Function, ev.StartType, ev.QueueWaitMs, ev.BootMs, ev.InvokeMs,
		ev.Status, ev.InfraError, ev.CPUMs, ev.MemPeakKB, ev.RequestBody)
	return err
}

func (s *Store) InsertInstanceMetric(ev InstanceMetricEvent) error {
	_, err := s.db.Exec(
		`INSERT INTO instance_metrics (instance_id, cpu_pct, mem_rss_kb) VALUES ($1, $2, $3)`,
		ev.InstanceID, ev.CPUPct, ev.MemRSSKB)
	return err
}

func (s *Store) InsertDeployment(ev DeploymentEvent) error {
	_, err := s.db.Exec(`INSERT INTO deployments
		(function_id, image_size_bytes, build_ms, snapshot_enabled, snapshot_ms, snapshot_ok,
		 kernel_path, kernel_size_bytes, base_rootfs_path, base_rootfs_size_bytes, bootstrap_version)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		ev.Function, ev.ImageSizeBytes, ev.BuildMs, ev.SnapshotEnabled, ev.SnapshotMs, ev.SnapshotOK,
		ev.KernelPath, ev.KernelSizeBytes, ev.BaseRootfsPath, ev.BaseRootfsSizeBytes, ev.BootstrapVersion)
	return err
}

// ListFunctions merges invocation aggregates with each function's latest
// deployment, so a deployed-but-never-invoked function still appears.
func (s *Store) ListFunctions() ([]FunctionSummary, error) {
	byName := map[string]*FunctionSummary{}
	get := func(name string) *FunctionSummary {
		if f, ok := byName[name]; ok {
			return f
		}
		f := &FunctionSummary{Name: name}
		byName[name] = f
		return f
	}

	rows, err := s.db.Query(`SELECT function_id, count(*), max(created_at),
		count(*) FILTER (WHERE infra_error)
		FROM invocations GROUP BY function_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name string
		var runs, infraErrors int64
		var last time.Time
		if err := rows.Scan(&name, &runs, &last, &infraErrors); err != nil {
			rows.Close()
			return nil, err
		}
		f := get(name)
		f.Runs, f.InfraErrors, f.LastRun = runs, infraErrors, &last
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// has_snapshot means "snapshot succeeded at the most recent deploy"; the
	// pool manager may since have deleted a snapshot that failed to restore.
	rows, err = s.db.Query(`SELECT DISTINCT ON (function_id)
		function_id, image_size_bytes, snapshot_enabled AND snapshot_ok, created_at
		FROM deployments ORDER BY function_id, created_at DESC`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name string
		var size int64
		var hasSnapshot bool
		var at time.Time
		if err := rows.Scan(&name, &size, &hasSnapshot, &at); err != nil {
			rows.Close()
			return nil, err
		}
		f := get(name)
		f.ImageSizeBytes, f.HasSnapshot, f.LastDeployedAt = size, hasSnapshot, &at
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]FunctionSummary, 0, len(byName))
	for _, f := range byName {
		out = append(out, *f)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// FunctionDetail returns nil (no error) for a function with no recorded
// invocations and no deployments — the handler turns that into a 404.
func (s *Store) FunctionDetail(name string) (*FunctionDetail, error) {
	d := &FunctionDetail{Name: name, ByStartType: map[string]StartTypeStats{}}

	var last sql.NullTime
	err := s.db.QueryRow(`SELECT count(*), max(created_at), count(*) FILTER (WHERE infra_error)
		FROM invocations WHERE function_id = $1`, name).
		Scan(&d.Runs, &last, &d.InfraErrors)
	if err != nil {
		return nil, err
	}
	if last.Valid {
		d.LastRun = &last.Time
	}

	rows, err := s.db.Query(`SELECT start_type, count(*),
		avg(invoke_ms)::bigint,
		(percentile_cont(0.95) WITHIN GROUP (ORDER BY invoke_ms))::bigint,
		avg(boot_ms)::bigint, avg(queue_wait_ms)::bigint,
		avg(cpu_ms)::bigint, max(mem_peak_kb)
		FROM invocations WHERE function_id = $1 GROUP BY start_type`, name)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var startType string
		var st StartTypeStats
		if err := rows.Scan(&startType, &st.Count, &st.AvgInvokeMs, &st.P95InvokeMs,
			&st.AvgBootMs, &st.AvgQueueWaitMs, &st.AvgCPUMs, &st.MaxMemPeakKB); err != nil {
			rows.Close()
			return nil, err
		}
		d.ByStartType[startType] = st
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var dep DeploymentRow
	err = s.db.QueryRow(`SELECT created_at, image_size_bytes, build_ms, snapshot_enabled, snapshot_ms, snapshot_ok,
		kernel_path, kernel_size_bytes, base_rootfs_path, base_rootfs_size_bytes, bootstrap_version
		FROM deployments WHERE function_id = $1 ORDER BY created_at DESC LIMIT 1`, name).
		Scan(&dep.CreatedAt, &dep.ImageSizeBytes, &dep.BuildMs, &dep.SnapshotEnabled, &dep.SnapshotMs, &dep.SnapshotOK,
			&dep.KernelPath, &dep.KernelSizeBytes, &dep.BaseRootfsPath, &dep.BaseRootfsSizeBytes, &dep.BootstrapVersion)
	switch err {
	case nil:
		d.LastDeployment = &dep
	case sql.ErrNoRows:
		// fine — never deployed while metrics was running
	default:
		return nil, err
	}

	if d.Runs == 0 && d.LastDeployment == nil {
		return nil, nil
	}
	return d, nil
}

func (s *Store) RecentInvocations(name string, limit int) ([]InvocationRow, error) {
	rows, err := s.db.Query(`SELECT start_type, queue_wait_ms, boot_ms, invoke_ms,
		status, infra_error, cpu_ms, mem_peak_kb, request_body, created_at
		FROM invocations WHERE function_id = $1
		ORDER BY created_at DESC LIMIT $2`, name, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []InvocationRow{}
	for rows.Next() {
		var r InvocationRow
		if err := rows.Scan(&r.StartType, &r.QueueWaitMs, &r.BootMs, &r.InvokeMs,
			&r.Status, &r.InfraError, &r.CPUMs, &r.MemPeakKB, &r.RequestBody, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
