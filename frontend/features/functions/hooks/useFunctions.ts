"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type FunctionListItem = {
  id: string;
  name: string;
  created_at: string;
};

async function fetchFunctions(): Promise<FunctionListItem[]> {
  const res = await fetch("/api/functions");
  if (!res.ok) throw new Error("failed to load functions");
  return (await res.json()).functions;
}

// Registers a name and returns the new function's id — done before the
// deploy, since the artifact-store stores the image under the id.
async function registerFunction(name: string): Promise<{ id: string }> {
  const res = await fetch("/api/functions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `register failed: ${res.status}`);
  }
  return res.json();
}

async function unregisterFunction(id: string) {
  const res = await fetch(`/api/functions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `delete failed: ${res.status}`);
  }
}

// The registry of active functions, backed by Postgres via /api/functions.
export function useFunctions() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["functions"] });

  const query = useQuery({ queryKey: ["functions"], queryFn: fetchFunctions });

  const register = useMutation({
    mutationFn: registerFunction,
    onSuccess: invalidate,
  });
  const unregister = useMutation({
    mutationFn: unregisterFunction,
    onSuccess: invalidate,
  });

  return {
    functions: query.data ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    add: (name: string) => register.mutateAsync(name),
    remove: (id: string) => unregister.mutateAsync(id),
  };
}
