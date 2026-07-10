// Code generated from the live database schema by database/generate.sh. DO NOT EDIT.

package dbtypes

import (
	"time"
)

type DeploymentsRow struct {
	FunctionName string `json:"function_name" db:"function_name"`
	ImageSizeBytes int64 `json:"image_size_bytes" db:"image_size_bytes"`
	BuildMs int64 `json:"build_ms" db:"build_ms"`
	SnapshotEnabled bool `json:"snapshot_enabled" db:"snapshot_enabled"`
	SnapshotMs int64 `json:"snapshot_ms" db:"snapshot_ms"`
	SnapshotOk bool `json:"snapshot_ok" db:"snapshot_ok"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	KernelPath string `json:"kernel_path" db:"kernel_path"`
	KernelSizeBytes int64 `json:"kernel_size_bytes" db:"kernel_size_bytes"`
	BaseRootfsPath string `json:"base_rootfs_path" db:"base_rootfs_path"`
	BaseRootfsSizeBytes int64 `json:"base_rootfs_size_bytes" db:"base_rootfs_size_bytes"`
	BootstrapVersion string `json:"bootstrap_version" db:"bootstrap_version"`
	ID string `json:"id" db:"id"`
}

type FunctionsRow struct {
	Name string `json:"name" db:"name"`
	UserID *string `json:"user_id" db:"user_id"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	ID string `json:"id" db:"id"`
}

type InvocationsRow struct {
	FunctionName string `json:"function_name" db:"function_name"`
	StartType string `json:"start_type" db:"start_type"`
	QueueWaitMs int64 `json:"queue_wait_ms" db:"queue_wait_ms"`
	BootMs int64 `json:"boot_ms" db:"boot_ms"`
	InvokeMs int64 `json:"invoke_ms" db:"invoke_ms"`
	Status int `json:"status" db:"status"`
	InfraError bool `json:"infra_error" db:"infra_error"`
	CpuMs int64 `json:"cpu_ms" db:"cpu_ms"`
	MemPeakKb int64 `json:"mem_peak_kb" db:"mem_peak_kb"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	RequestBody string `json:"request_body" db:"request_body"`
	ID string `json:"id" db:"id"`
}

type UsersRow struct {
	ID string `json:"id" db:"id"`
	Email *string `json:"email" db:"email"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}
