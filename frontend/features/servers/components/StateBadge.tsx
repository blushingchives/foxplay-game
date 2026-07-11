const COLORS: Record<string, string> = {
  running: "text-green-600 border-green-200 bg-green-50",
  creating: "text-[#f26a1f] border-orange-200 bg-orange-50",
  stopped: "text-gray-500 border-gray-200 bg-gray-50",
  error: "text-red-500 border-red-200 bg-red-50",
};

export default function StateBadge({ state }: { state: string }) {
  const cls = COLORS[state] ?? COLORS.stopped;
  return (
    <span className={`text-xs rounded border px-2 py-0.5 ${cls}`}>{state}</span>
  );
}
