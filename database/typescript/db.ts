// Code generated from the live database schema by database/generate.sh. DO NOT EDIT.
// timestamptz columns are typed as string — the ISO form they take once
// JSON-serialized by an API route.

export interface DeploymentsRow {
  function_id: string;
  image_size_bytes: number;
  build_ms: number;
  snapshot_enabled: boolean;
  snapshot_ms: number;
  snapshot_ok: boolean;
  created_at: string;
  kernel_path: string;
  kernel_size_bytes: number;
  base_rootfs_path: string;
  base_rootfs_size_bytes: number;
  bootstrap_version: string;
  id: string;
}

export interface FunctionsRow {
  name: string;
  user_id: string | null;
  created_at: string;
  id: string;
  deleted_at: string | null;
}

export interface InstanceMetricsRow {
  id: string;
  instance_id: string;
  cpu_pct: number;
  mem_rss_kb: number;
  created_at: string;
}

export interface InstancesRow {
  id: string;
  name: string;
  user_id: string | null;
  state: string;
  base_image: string;
  vcpu: number;
  mem_mib: number;
  guest_ip: string | null;
  ssh_host_port: number | null;
  ssh_public_key: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface InvocationsRow {
  function_id: string;
  start_type: string;
  queue_wait_ms: number;
  boot_ms: number;
  invoke_ms: number;
  status: number;
  infra_error: boolean;
  cpu_ms: number;
  mem_peak_kb: number;
  created_at: string;
  request_body: string;
  id: string;
}

export interface UsersRow {
  id: string;
  email: string | null;
  created_at: string;
}

