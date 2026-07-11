// Server-side client for the instance-manager (imported only by API route
// handlers). The manager port is never exposed to the browser; all calls go
// through Next API routes.
const BASE = process.env.INSTANCE_MANAGER_URL;

export type InstanceSpec = {
  id: string;
  base_image: string;
  vcpu: number;
  mem_mib: number;
  guest_ip: string;
  ssh_host_port: number;
  ssh_public_key: string;
};

async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `instance-manager ${res.status}`);
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`instance-manager ${res.status}`);
  return res.json();
}

export const instanceManager = {
  create: (spec: InstanceSpec) => call(`/create/${spec.id}`, "POST", spec),
  start: (spec: InstanceSpec) => call(`/start/${spec.id}`, "POST", spec),
  stop: (id: string) => call(`/stop/${id}`, "POST"),
  delete: (spec: InstanceSpec) => call(`/delete/${spec.id}`, "DELETE", spec),
  images: () => getJSON<{ images: string[] }>("/images"),
  running: () => getJSON<{ running: string[] }>("/running"),
};
