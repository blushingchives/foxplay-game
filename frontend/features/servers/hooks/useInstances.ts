"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstanceCreate } from "@/lib/models";

export type InstanceListItem = {
  id: string;
  name: string;
  state: string;
  base_image: string;
  guest_ip: string | null;
  ssh_host_port: number | null;
  created_at: string;
};

async function fetchInstances(): Promise<InstanceListItem[]> {
  const res = await fetch("/api/instances");
  if (!res.ok) throw new Error("failed to load instances");
  return (await res.json()).instances;
}

async function post(url: string) {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `request failed: ${res.status}`);
  }
}

export function useInstances() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["instances"] });

  const query = useQuery({ queryKey: ["instances"], queryFn: fetchInstances });

  const create = useMutation({
    mutationFn: async (input: InstanceCreate): Promise<{ id: string }> => {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `create failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: invalidate,
  });

  const start = useMutation({
    mutationFn: (id: string) => post(`/api/instances/${encodeURIComponent(id)}/start`),
    onSuccess: invalidate,
  });
  const stop = useMutation({
    mutationFn: (id: string) => post(`/api/instances/${encodeURIComponent(id)}/stop`),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/instances/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `delete failed: ${res.status}`);
      }
    },
    onSuccess: invalidate,
  });

  return {
    instances: query.data ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    create: (input: InstanceCreate) => create.mutateAsync(input),
    start: (id: string) => start.mutateAsync(id),
    stop: (id: string) => stop.mutateAsync(id),
    remove: (id: string) => remove.mutateAsync(id),
  };
}
