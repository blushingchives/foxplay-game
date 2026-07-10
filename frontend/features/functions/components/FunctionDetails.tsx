"use client";
import { useQuery } from "@tanstack/react-query";
import type { InvocationRow } from "@/lib/models";
import { functionDetailQueryOptions } from "@/features/functions/lib/api";

function fmtBytes(n: number) {
  if (n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString();
}

function avg(xs: number[]) {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

type Props = {
  id: string;
};

export default function FunctionDetails({ id }: Props) {
  // Both queries share the ["function", id] key prefix, so one invalidation
  // after an invoke refreshes details and history together. The detail
  // query is also shared (same key) with the page header.
  const detailQuery = useQuery(functionDetailQueryOptions(id));
  const runsQuery = useQuery({
    queryKey: ["function", id, "invocations"],
    queryFn: async (): Promise<InvocationRow[]> => {
      const res = await fetch(
        `/api/functions/${encodeURIComponent(id)}/invocations?limit=50`,
      );
      if (!res.ok) throw new Error(`invocations query failed: ${res.status}`);
      return (await res.json()).invocations ?? [];
    },
  });

  if (detailQuery.isPending || runsQuery.isPending) {
    return <Panel label="Details:">Loading…</Panel>;
  }
  if (detailQuery.isError || runsQuery.isError) {
    return <Panel label="Details:">Failed to load metrics.</Panel>;
  }
  const detail = detailQuery.data;
  if (!detail) {
    return <Panel label="Details:">Function not found.</Panel>;
  }
  const runs = runsQuery.data ?? [];

  const dep = detail.last_deployment;
  const warm10 = runs.filter((r) => r.start_type === "warm").slice(0, 10);
  const boot10 = runs.filter((r) => r.start_type !== "warm").slice(0, 10);
  const avgWarmMs = avg(warm10.map((r) => r.invoke_ms));
  const avgBootMs = avg(boot10.map((r) => r.boot_ms + r.invoke_ms));
  const avgMemKB = avg(runs.slice(0, 10).map((r) => r.mem_peak_kb));

  const rows: [string, string][] = [
    ["Last ran", detail.last_run ? fmtTime(detail.last_run) : "never"],
    ["Created", fmtTime(detail.created_at)],
    ["Avg warm start, last 10", avgWarmMs !== null ? `${avgWarmMs} ms` : "—"],
    [
      "Avg cold/snapshot start, last 10",
      avgBootMs !== null ? `${avgBootMs} ms` : "—",
    ],
    [
      "Avg peak memory, last 10",
      avgMemKB !== null ? fmtBytes(avgMemKB * 1024) : "—",
    ],
    ["Image size", dep ? fmtBytes(dep.image_size_bytes) : "—"],
    [
      "Snapshot",
      dep
        ? dep.snapshot_enabled
          ? dep.snapshot_ok
            ? "Enabled"
            : "Enabled (creation failed)"
          : "Disabled"
        : "—",
    ],
    [
      "Kernel",
      dep && dep.kernel_path
        ? `${dep.kernel_path} (${fmtBytes(dep.kernel_size_bytes)})`
        : "—",
    ],
    [
      "Base rootfs",
      dep && dep.base_rootfs_path
        ? `${dep.base_rootfs_path} (${fmtBytes(dep.base_rootfs_size_bytes)})`
        : "—",
    ],
    ["Bootstrap", dep?.bootstrap_version || "—"],
  ];

  return (
    <>
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
        <label>History (last 10 runs):</label>
        {runs.length === 0 ? (
          <div className="text-sm text-gray-500 bg-white border border-[#efefea] rounded px-4 py-3">
            No runs yet.
          </div>
        ) : (
          <div className="text-sm bg-white border border-[#efefea] rounded overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-500 border-b border-[#efefea]">
                  <th className="font-normal px-4 py-2">Time</th>
                  <th className="font-normal px-4 py-2">Type</th>
                  <th className="font-normal px-4 py-2 text-right">Duration</th>
                  <th className="font-normal px-4 py-2 text-right">Status</th>
                  <th className="font-normal px-4 py-2 text-right">Memory</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {runs.slice(0, 10).map((r, idx) => (
                  <tr
                    key={`${r.created_at}-${idx}`}
                    className="border-b border-[#efefea] last:border-b-0"
                  >
                    <td className="px-4 py-2 whitespace-nowrap">
                      {fmtTime(r.created_at)}
                    </td>
                    <td className="px-4 py-2">{r.start_type}</td>
                    <td className="px-4 py-2 text-right">
                      {r.boot_ms + r.invoke_ms} ms
                    </td>
                    <td
                      className={`px-4 py-2 text-right ${
                        r.infra_error || r.status >= 400
                          ? "text-red-500"
                          : "text-green-600"
                      }`}
                    >
                      {r.infra_error && r.status === 0 ? "infra" : r.status}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {fmtBytes(r.mem_peak_kb * 1024)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Panel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label>{label}</label>
      <div className="text-sm text-gray-500 bg-white border border-[#efefea] rounded px-4 py-3">
        {children}
      </div>
    </div>
  );
}
