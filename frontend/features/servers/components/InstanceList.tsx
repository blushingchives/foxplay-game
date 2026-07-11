"use client";
import Link from "next/link";
import { shortId } from "@/lib/id";
import StateBadge from "@/features/servers/components/StateBadge";
import type { InstanceListItem } from "@/features/servers/hooks/useInstances";

type Props = {
  instances: InstanceListItem[];
};

export default function InstanceList({ instances }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {instances.length === 0 && (
        <li className="text-gray-500">No servers yet.</li>
      )}
      {instances.map((inst) => (
        <li
          key={inst.id}
          className="flex bg-white border border-[#efefea] rounded transition-all duration-150 hover:border-[#f26a1f] hover:shadow-sm"
        >
          <Link
            href={`/servers/${inst.id}`}
            className="flex-1 flex items-center justify-between gap-3 px-4 py-3 transition-all duration-150 hover:translate-x-1"
          >
            <span className="font-mono flex items-center gap-3">
              <span className="hover:text-[#f26a1f]">{inst.name}</span>
              <StateBadge state={inst.state} />
            </span>
            <span className="text-xs text-gray-400">{shortId(inst.id)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
