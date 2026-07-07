"use client";
import { useEffect, useState } from "react";

type ToastKind = "success" | "error";

export type ToastOptions = {
  description?: string;
  timeTakenMs?: number;
};

type ToastItem = ToastOptions & {
  id: number;
  kind: ToastKind;
  message: string;
};

const DISMISS_MS = 6000;

let nextId = 0;
let listener: ((t: ToastItem) => void) | null = null;

function push(kind: ToastKind, message: string, opts?: ToastOptions) {
  listener?.({ id: ++nextId, kind, message, ...opts });
}

export const toast = {
  success: (message: string, opts?: ToastOptions) =>
    push("success", message, opts),
  error: (message: string, opts?: ToastOptions) => push("error", message, opts),
};

function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

// Renders the toast stack and receives toasts fired via `toast.*` from
// anywhere in the app. Mount once, in the root layout.
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    listener = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, DISMISS_MS);
    };
    return () => {
      listener = null;
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`w-80 rounded border px-4 py-3 shadow-lg bg-white ${
            t.kind === "success" ? "border-green-500" : "border-red-500"
          }`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-bold text-sm">{t.message}</div>
            {t.timeTakenMs !== undefined && (
              <div className="text-xs text-gray-400 font-mono shrink-0">
                {formatDuration(t.timeTakenMs)}
              </div>
            )}
          </div>
          {t.description !== undefined && (
            <div className="text-sm break-words whitespace-pre-wrap max-h-40 overflow-y-auto">
              {t.description}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
