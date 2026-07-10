"use client";
import Link from "next/link";
import { shortId } from "@/lib/id";
import type { FunctionListItem } from "@/features/functions/hooks/useFunctions";

type Props = {
  functions: FunctionListItem[];
};

export default function FunctionList({ functions }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {functions.length === 0 && (
        <li className="text-gray-500">No functions uploaded yet.</li>
      )}
      {functions.map((fn) => (
        <li
          key={fn.id}
          className="flex bg-white border border-[#efefea] rounded transition-all duration-150 hover:border-[#f26a1f] hover:shadow-sm"
        >
          <Link
            href={`/functions/${fn.id}`}
            className="font-mono flex-1 flex items-center justify-between px-4 py-3 transition-all duration-150 hover:text-[#f26a1f] hover:translate-x-1"
          >
            <span>{fn.name}</span>
            <span className="text-xs text-gray-400">{shortId(fn.id)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
