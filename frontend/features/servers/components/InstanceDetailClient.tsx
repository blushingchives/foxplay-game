"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/components/Toast";
import { shortId } from "@/lib/id";
import StateBadge from "@/features/servers/components/StateBadge";
import { useInstances } from "@/features/servers/hooks/useInstances";
import { instanceDetailQueryOptions } from "@/features/servers/lib/api";

const SSH_HOST = process.env.NEXT_PUBLIC_SERVER_HOST ?? "<droplet-ip>";

type Props = {
  id: string;
};

type Sample = { cpu_pct: number; mem_rss_kb: number; created_at: string };

export default function InstanceDetailClient({ id }: Props) {
  const router = useRouter();
  const { start, stop, remove } = useInstances();
  const [busy, setBusy] = useState<null | "start" | "stop" | "delete">(null);

  // Poll while the page is open so state + usage stay live.
  const detailQuery = useQuery({
    ...instanceDetailQueryOptions(id),
    refetchInterval: 5000,
  });
  const inst = detailQuery.data;
  const running = inst?.state === "running";

  const metricsQuery = useQuery({
    queryKey: ["instance", id, "metrics"],
    queryFn: async (): Promise<Sample[]> => {
      const res = await fetch(
        `/api/instances/${encodeURIComponent(id)}/metrics?limit=20`,
      );
      if (!res.ok) throw new Error(`metrics query failed: ${res.status}`);
      return (await res.json()).samples ?? [];
    },
    refetchInterval: running ? 5000 : false,
    enabled: !!inst,
  });
  const samples = metricsQuery.data ?? [];
  const latest = samples[0];

  async function act(
    kind: "start" | "stop" | "delete",
    fn: () => Promise<unknown>,
    okMsg: string,
  ) {
    setBusy(kind);
    try {
      await fn();
      toast.success(okMsg);
      if (kind === "delete") router.push("/servers");
      else detailQuery.refetch();
    } catch (err) {
      toast.error(`${kind} failed`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  if (detailQuery.isPending) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }
  if (detailQuery.isError || !inst) {
    return <div className="p-6 text-sm text-gray-500">Server not found.</div>;
  }

  const rows: [string, string][] = [
    ["State", inst.state],
    ["Base image", inst.base_image],
    ["Resources", `${inst.vcpu} vCPU · ${inst.mem_mib} MB`],
    ["Private IP", inst.guest_ip ?? "—"],
    [
      "SSH",
      inst.ssh_host_port
        ? `ssh root@${SSH_HOST} -p ${inst.ssh_host_port}`
        : "—",
    ],
    [
      "CPU (now)",
      running && latest ? `${latest.cpu_pct}% of a core` : "—",
    ],
    [
      "Memory (now)",
      running && latest ? `${(latest.mem_rss_kb / 1024).toFixed(1)} MB` : "—",
    ],
    ["Created", new Date(inst.created_at).toLocaleString()],
  ];

  return (
    <div className="p-6 max-w-xl flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/servers"
          className="flex items-center gap-1 text-sm text-gray-500 transition-colors duration-150 hover:text-[#f26a1f]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
          <span>Back to servers</span>
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-lg font-bold flex items-center gap-3">
            {inst.name}
            <StateBadge state={inst.state} />
            <span className="text-xs font-normal text-gray-400">
              {shortId(inst.id)}
            </span>
          </h1>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            act("start", () => start(inst.id), `${inst.name} starting`)
          }
          disabled={busy !== null || inst.state === "running"}
          className="text-sm text-green-600 border border-green-200 rounded px-3 py-1.5 cursor-pointer transition-colors duration-150 hover:bg-green-50 disabled:opacity-40 disabled:cursor-default"
        >
          {busy === "start" ? "Starting…" : "Start"}
        </button>
        <button
          type="button"
          onClick={() =>
            act("stop", () => stop(inst.id), `${inst.name} stopping`)
          }
          disabled={busy !== null || inst.state !== "running"}
          className="text-sm text-gray-600 border border-gray-200 rounded px-3 py-1.5 cursor-pointer transition-colors duration-150 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-default"
        >
          {busy === "stop" ? "Stopping…" : "Stop"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                `Delete ${inst.name}? This destroys the disk permanently.`,
              )
            ) {
              act("delete", () => remove(inst.id), `${inst.name} deleted`);
            }
          }}
          disabled={busy !== null}
          className="text-sm text-red-500 border border-red-200 rounded px-3 py-1.5 cursor-pointer transition-colors duration-150 hover:bg-red-50 disabled:opacity-40 disabled:cursor-default ml-auto"
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label>Details:</label>
        <div className="text-sm bg-white border border-[#efefea] rounded divide-y divide-[#efefea]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-4 py-2">
              <span className="text-gray-500 shrink-0">{label}</span>
              <span className="font-mono text-right break-all">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label>Usage (recent samples):</label>
        {samples.length === 0 ? (
          <div className="text-sm text-gray-500 bg-white border border-[#efefea] rounded px-4 py-3">
            {running ? "Waiting for the first sample…" : "No samples."}
          </div>
        ) : (
          <div className="text-sm bg-white border border-[#efefea] rounded overflow-x-auto">
            <table className="w-full font-mono">
              <thead>
                <tr className="text-left text-gray-500 border-b border-[#efefea]">
                  <th className="font-normal px-4 py-2">Time</th>
                  <th className="font-normal px-4 py-2 text-right">CPU</th>
                  <th className="font-normal px-4 py-2 text-right">Memory</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s, i) => (
                  <tr
                    key={`${s.created_at}-${i}`}
                    className="border-b border-[#efefea] last:border-b-0"
                  >
                    <td className="px-4 py-2 whitespace-nowrap">
                      {new Date(s.created_at).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2 text-right">{s.cpu_pct}%</td>
                    <td className="px-4 py-2 text-right">
                      {(s.mem_rss_kb / 1024).toFixed(1)} MB
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
