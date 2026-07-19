"use client";
import { toast } from "@/components/Toast";
import CreateSshKeyForm from "@/features/ssh-keys/components/CreateSshKeyForm";
import { useSshKeys } from "@/features/ssh-keys/hooks/useSshKeys";

// A short, readable summary of a public key: "<type> …<last8> <comment>".
function summarizeKey(pub: string) {
  const [type, body, ...comment] = pub.trim().split(/\s+/);
  const tail = body ? `…${body.slice(-8)}` : "";
  return `${type ?? ""} ${tail}${comment.length ? " " + comment.join(" ") : ""}`.trim();
}

export default function SshKeysClient() {
  const { keys, isLoading, isError, remove } = useSshKeys();

  async function handleRemove(id: string, name: string) {
    if (!window.confirm(`Delete key "${name}"? Existing servers keep it.`)) {
      return;
    }
    try {
      await remove(id);
      toast.success("Key deleted", { description: name });
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="p-6 max-w-xl flex flex-col gap-8">
      <CreateSshKeyForm />

      <div className="flex flex-col gap-2">
        <label>Your keys:</label>
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : isError ? (
          <div className="text-sm text-red-500">Failed to load keys.</div>
        ) : keys.length === 0 ? (
          <div className="text-sm text-gray-500 bg-white border border-[#efefea] rounded px-4 py-3">
            No keys yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-4 bg-white border border-[#efefea] rounded px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-bold text-sm">{k.name}</div>
                  <div
                    className="font-mono text-xs text-gray-400 truncate"
                    title={k.public_key}
                  >
                    {summarizeKey(k.public_key)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(k.id, k.name)}
                  className="text-gray-400 hover:text-gray-700 shrink-0 cursor-pointer"
                  aria-label={`Delete ${k.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
