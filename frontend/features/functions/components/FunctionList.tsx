"use client";
import Link from "next/link";

type Props = {
  functions: string[];
};

export default function FunctionList({ functions }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {functions.length === 0 && (
        <li className="text-gray-500">No functions uploaded yet.</li>
      )}
      {functions.map((fn) => (
        <li
          key={fn}
          className="flex bg-white border border-[#efefea] rounded transition-all duration-150 hover:border-[#f26a1f] hover:shadow-sm"
        >
          <Link
            href={`/functions/${encodeURIComponent(fn)}`}
            className="font-mono flex-1 px-4 py-3 transition-all duration-150 hover:text-[#f26a1f] hover:translate-x-1"
          >
            {fn}
          </Link>
        </li>
      ))}
    </ul>
  );
}
