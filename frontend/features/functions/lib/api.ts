import type { DeploymentRow } from "@/lib/models";

// Shared fetcher + query options for a function's detail, so every
// component using it (header, details panel) shares one cache entry.

export type FunctionDetail = {
  id: string;
  name: string;
  created_at: string;
  deleted_at: string | null;
  runs: number;
  last_run: string | null;
  infra_errors: number;
  last_deployment: DeploymentRow | null;
};

export async function fetchFunctionDetail(
  id: string,
): Promise<FunctionDetail | null> {
  const res = await fetch(`/api/functions/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`detail query failed: ${res.status}`);
  return res.json();
}

export function functionDetailQueryOptions(id: string) {
  return {
    queryKey: ["function", id] as const,
    queryFn: () => fetchFunctionDetail(id),
  };
}
