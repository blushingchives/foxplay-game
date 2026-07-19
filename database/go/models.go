// Code generated from the live database schema by database/generate.sh. DO NOT EDIT.

package dbtypes

import (
	"time"
)

type DeploymentsRow struct {
	FunctionID string `json:"function_id" db:"function_id"`
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
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"`
}

type InstanceMetricsRow struct {
	ID string `json:"id" db:"id"`
	InstanceID string `json:"instance_id" db:"instance_id"`
	CpuPct int `json:"cpu_pct" db:"cpu_pct"`
	MemRssKb int64 `json:"mem_rss_kb" db:"mem_rss_kb"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type InstancesRow struct {
	ID string `json:"id" db:"id"`
	Name string `json:"name" db:"name"`
	UserID *string `json:"user_id" db:"user_id"`
	State string `json:"state" db:"state"`
	BaseImage string `json:"base_image" db:"base_image"`
	Vcpu int `json:"vcpu" db:"vcpu"`
	MemMib int `json:"mem_mib" db:"mem_mib"`
	GuestIp *string `json:"guest_ip" db:"guest_ip"`
	SshHostPort *int `json:"ssh_host_port" db:"ssh_host_port"`
	SshPublicKey *string `json:"ssh_public_key" db:"ssh_public_key"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"`
}

type InvocationsRow struct {
	FunctionID string `json:"function_id" db:"function_id"`
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

type SshKeysRow struct {
	ID string `json:"id" db:"id"`
	Name string `json:"name" db:"name"`
	PublicKey string `json:"public_key" db:"public_key"`
	UserID *string `json:"user_id" db:"user_id"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"`
}

type UsersRow struct {
	ID string `json:"id" db:"id"`
	Email *string `json:"email" db:"email"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}
