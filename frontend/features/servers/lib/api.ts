export type InstanceDetail = {
  id: string;
  name: string;
  state: string;
  base_image: string;
  vcpu: number;
  mem_mib: number;
  guest_ip: string | null;
  ssh_host_port: number | null;
  created_at: string;
};

export async function fetchInstanceDetail(
  id: string,
): Promise<InstanceDetail | null> {
  const res = await fetch(`/api/instances/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`detail query failed: ${res.status}`);
  return res.json();
}

export function instanceDetailQueryOptions(id: string) {
  return {
    queryKey: ["instance", id] as const,
    queryFn: () => fetchInstanceDetail(id),
  };
}
