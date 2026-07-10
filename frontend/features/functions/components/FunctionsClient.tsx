"use client";
import Link from "next/link";
import FunctionList from "@/features/functions/components/FunctionList";
import { useFunctions } from "@/features/functions/hooks/useFunctions";

export default function FunctionsClient() {
  const { functions, isLoading, isError } = useFunctions();

  return (
    <div className="p-6 max-w-xl flex flex-col gap-2">
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
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : isError ? (
        <div className="text-sm text-red-500">Failed to load functions.</div>
      ) : (
        <FunctionList functions={functions} />
      )}
    </div>
  );
}
