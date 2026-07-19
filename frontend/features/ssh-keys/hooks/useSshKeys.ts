"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SshKeyCreate } from "@/lib/models";

export type SshKeyItem = {
  id: string;
  name: string;
  public_key: string;
  created_at: string;
};

async function fetchKeys(): Promise<SshKeyItem[]> {
  const res = await fetch("/api/ssh-keys");
  if (!res.ok) throw new Error("failed to load ssh keys");
  return (await res.json()).keys;
}

export function useSshKeys() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["ssh-keys"] });

  const query = useQuery({ queryKey: ["ssh-keys"], queryFn: fetchKeys });

  const create = useMutation({
    mutationFn: async (input: SshKeyCreate): Promise<SshKeyItem> => {
      const res = await fetch("/api/ssh-keys", {
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

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ssh-keys/${encodeURIComponent(id)}`, {
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
    keys: query.data ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    create: (input: SshKeyCreate) => create.mutateAsync(input),
    remove: (id: string) => remove.mutateAsync(id),
  };
}
