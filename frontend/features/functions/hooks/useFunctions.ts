"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function fetchFunctions(): Promise<string[]> {
  const res = await fetch("/api/functions");
  if (!res.ok) throw new Error("failed to load functions");
  const data = await res.json();
  return (data.functions as { name: string }[]).map((f) => f.name);
}

async function registerFunction(name: string) {
  const res = await fetch("/api/functions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function unregisterFunction(name: string) {
  const res = await fetch(`/api/functions/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
}

// The list of registered functions, backed by Postgres via /api/functions.
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
    remove: (name: string) => unregister.mutateAsync(name),
  };
}
