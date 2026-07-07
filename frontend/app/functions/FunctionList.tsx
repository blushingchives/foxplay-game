"use client";

type Props = {
  functions: string[];
  invoking: string[];
  onInvoke: (name: string) => void;
  onRemove: (name: string) => void;
};

export default function FunctionList({
  functions,
  invoking,
  onInvoke,
  onRemove,
}: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {functions.length === 0 && (
        <li className="text-gray-500">No functions uploaded yet.</li>
      )}
      {functions.map((fn) => (
        <li
          key={fn}
          className="flex items-center justify-between bg-white border border-[#efefea] rounded px-4 py-3 transition-all duration-150 hover:border-[#f26a1f] hover:shadow-sm"
        >
          <button
            type="button"
            onClick={() => onInvoke(fn)}
            disabled={invoking.includes(fn)}
            className="font-mono text-left flex-1 transition-all duration-150 hover:text-[#f26a1f] hover:translate-x-1 disabled:opacity-50 disabled:hover:translate-x-0"
          >
            {invoking.includes(fn) ? `${fn} (invoking...)` : fn}
          </button>
          <button
            type="button"
            onClick={() => onRemove(fn)}
            className="text-gray-400 hover:text-gray-700 ml-4"
            aria-label={`Remove ${fn}`}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
