"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "@/app/components/Toast";
import PayloadEditor from "@/app/functions/PayloadEditor";
import FunctionList from "@/app/functions/FunctionList";
import { DEFAULT_PAYLOAD, normalizeEvent } from "@/app/functions/json";
import { useFunctions } from "@/app/functions/useFunctions";

export default function FunctionsClient() {
  const { functions, remove } = useFunctions();
  const [payload, setPayload] = useState(DEFAULT_PAYLOAD);
  const [invoking, setInvoking] = useState<string[]>([]);

  async function invoke(functionName: string) {
    let event: string;
    try {
      event = normalizeEvent(JSON.parse(payload));
    } catch (err) {
      toast.error("Invalid payload", {
        description: `Not valid JSON: ${String(err)}`,
      });
      return;
    }

    setInvoking((prev) => [...prev, functionName]);
    const start = performance.now();
    try {
      const res = await fetch(`/api/pool-manager/invoke/${functionName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: event,
      });
      const text = await res.text();
      const elapsed = performance.now() - start;
      if (!res.ok) {
        toast.error(`Invoke ${functionName} failed`, {
          description: text,
          timeTakenMs: elapsed,
        });
        return;
      }
      let body = text;
      try {
        body = JSON.parse(text).body ?? text;
      } catch {}
      toast.success(`${functionName} → ${res.status}`, {
        description: body,
        timeTakenMs: elapsed,
      });
    } catch (err) {
      toast.error(`Invoke ${functionName} failed`, {
        description: String(err),
        timeTakenMs: performance.now() - start,
      });
    } finally {
      setInvoking((prev) => prev.filter((n) => n !== functionName));
    }
  }

  return (
    <div className="p-6 max-w-xl flex flex-col gap-8">
      <PayloadEditor value={payload} onChange={setPayload} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label>Functions:</label>
          <Link
            href="/functions/create"
            className="flex items-center gap-1 bg-[#f26a1f] text-white text-sm font-bold rounded px-3 py-1.5 transition-colors duration-150 hover:bg-[#d95a15]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-plus-icon lucide-plus"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            <span>New function</span>
          </Link>
        </div>
        <FunctionList
          functions={functions}
          invoking={invoking}
          onInvoke={invoke}
          onRemove={remove}
        />
      </div>
    </div>
  );
}
