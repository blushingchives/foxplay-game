"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/Toast";
import PayloadEditor from "@/features/functions/components/PayloadEditor";
import FunctionDetails from "@/features/functions/components/FunctionDetails";
import { useFunctions } from "@/features/functions/hooks/useFunctions";
import { functionDetailQueryOptions } from "@/features/functions/lib/api";
import { DEFAULT_PAYLOAD, normalizeEvent } from "@/features/functions/lib/json";
import { shortId } from "@/lib/id";

type Props = {
  id: string;
};

export default function FunctionDetailClient({ id }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { remove } = useFunctions();
  const [payload, setPayload] = useState(DEFAULT_PAYLOAD);
  const [invoking, setInvoking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Shares the cache entry with FunctionDetails — one fetch serves both.
  const detailQuery = useQuery(functionDetailQueryOptions(id));
  const name = detailQuery.data?.name ?? "…";

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete ${name}? This removes the deployed code and snapshot from the server. Metrics history is kept.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await remove(id);
      toast.success("Deleted", { description: `${name} was removed` });
      router.push("/functions");
    } catch (err) {
      toast.error(`Delete ${name} failed`, { description: String(err) });
      setDeleting(false);
    }
  }

  async function invoke() {
    let event: string;
    try {
      event = normalizeEvent(JSON.parse(payload));
    } catch (err) {
      toast.error("Invalid payload", {
        description: `Not valid JSON: ${String(err)}`,
      });
      return;
    }

    setInvoking(true);
    const start = performance.now();
    try {
      const res = await fetch(`/api/pool-manager/invoke/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: event,
      });
      const text = await res.text();
      const elapsed = performance.now() - start;
      if (!res.ok) {
        toast.error(`Invoke ${name} failed`, {
          description: text,
          timeTakenMs: elapsed,
        });
        return;
      }
      let body = text;
      try {
        body = JSON.parse(text).body ?? text;
      } catch {}
      toast.success(`${name} → ${res.status}`, {
        description: body,
        timeTakenMs: elapsed,
      });
    } catch (err) {
      toast.error(`Invoke ${name} failed`, {
        description: String(err),
        timeTakenMs: performance.now() - start,
      });
    } finally {
      setInvoking(false);
      // the metrics event is emitted fire-and-forget; give it a moment to
      // land before refreshing the details + history
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ["function", id] }),
        800,
      );
    }
  }

  return (
    <div className="p-6 max-w-6xl flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/functions"
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
            className="lucide lucide-arrow-left-icon lucide-arrow-left"
          >
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
          <span>Back to functions</span>
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-lg font-bold">
            {name}
            <span className="ml-3 text-xs font-normal text-gray-400">
              {shortId(id)}
            </span>
          </h1>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm text-red-500 border border-red-200 rounded px-3 py-1.5 cursor-pointer transition-colors duration-150 hover:bg-red-50 hover:border-red-400 disabled:opacity-50 disabled:cursor-default"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* left: details + history */}
        <div className="flex-1 w-full min-w-0 flex flex-col gap-8">
          <FunctionDetails id={id} />
        </div>

        {/* right: test-request panel, docs style — sticks while scrolling */}
        <div className="w-full lg:w-[420px] lg:shrink-0 lg:sticky lg:top-6 flex flex-col gap-2">
          <PayloadEditor value={payload} onChange={setPayload} />
          <button
            type="button"
            onClick={invoke}
            disabled={invoking}
            className="bg-[#f26a1f] text-white font-bold rounded px-4 py-2 cursor-pointer transition-colors duration-150 hover:bg-[#d95a15] disabled:opacity-50 disabled:cursor-default"
          >
            {invoking ? "Invoking..." : "Invoke"}
          </button>
        </div>
      </div>
    </div>
  );
}
