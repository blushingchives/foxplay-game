"use client";
import { useState } from "react";
import { toast } from "@/components/Toast";
import { useSshKeys } from "@/features/ssh-keys/hooks/useSshKeys";
import { sshKeyCreateSchema } from "@/lib/models";

type Props = {
  onCreated?: (id: string) => void;
};

export default function CreateSshKeyForm({ onCreated }: Props) {
  const { create } = useSshKeys();
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const parsed = sshKeyCreateSchema.safeParse({
      name: name.trim(),
      public_key: publicKey.trim(),
    });
    if (!parsed.success) {
      toast.error("Invalid input", {
        description: parsed.error.issues[0].message,
      });
      return;
    }
    setSaving(true);
    try {
      const key = await create(parsed.data);
      toast.success("Key saved", { description: parsed.data.name });
      setName("");
      setPublicKey("");
      onCreated?.(key.id);
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3">
      <label htmlFor="keyName">Key name:</label>
      <input
        id="keyName"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="my-laptop"
        autoComplete="off"
        className="border border-[#efefea] bg-white rounded px-3 py-2"
      />
      <label htmlFor="publicKey">Public key:</label>
      <textarea
        id="publicKey"
        value={publicKey}
        onChange={(e) => setPublicKey(e.target.value)}
        placeholder="ssh-ed25519 AAAA… you@host"
        rows={3}
        spellCheck={false}
        className="border border-[#efefea] bg-white rounded px-3 py-2 font-mono text-sm resize-y"
      />
      <button
        type="submit"
        disabled={saving}
        className="bg-[#f26a1f] text-white font-bold rounded px-4 py-2 cursor-pointer transition-colors duration-150 hover:bg-[#d95a15] disabled:opacity-50 disabled:cursor-default"
      >
        {saving ? "Saving…" : "Save key"}
      </button>
    </form>
  );
}
