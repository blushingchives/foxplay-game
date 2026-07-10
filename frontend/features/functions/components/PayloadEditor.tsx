"use client";
import { useMemo } from "react";
import { DEFAULT_PAYLOAD, handleJsonKeyDown } from "@/features/functions/lib/json";

type Props = {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
};

export default function PayloadEditor({ value, onChange, rows = 10 }: Props) {
  const error = useMemo(() => {
    try {
      JSON.parse(value);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor="payload">Invocation payload:</label>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_PAYLOAD)}
          className="text-xs text-gray-400 cursor-pointer transition-colors duration-150 hover:text-[#f26a1f]"
        >
          Reset to default
        </button>
      </div>
      <textarea
        id="payload"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => handleJsonKeyDown(e, onChange)}
        rows={rows}
        spellCheck={false}
        className={`border bg-white rounded px-3 py-2 font-mono text-sm resize-y transition-colors duration-150 focus:outline-none ${
          error
            ? "border-red-400 focus:border-red-500"
            : "border-[#efefea] focus:border-[#f26a1f]"
        }`}
      />
      <div className="text-xs min-h-4">
        {error ? (
          <span className="text-red-500">⚠ {error}</span>
        ) : (
          <span className="text-green-600">✓ Valid JSON</span>
        )}
      </div>
    </div>
  );
}
