"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/components/Toast";
import { useInstances } from "@/features/servers/hooks/useInstances";
import { useSshKeys } from "@/features/ssh-keys/hooks/useSshKeys";
import { instanceCreateSchema, sshKeyCreateSchema } from "@/lib/models";

const NEW_KEY = "__new__";

export default function CreateInstanceClient() {
  const router = useRouter();
  const { create } = useInstances();
  const { keys, create: createKey } = useSshKeys();

  const [name, setName] = useState("");
  const [image, setImage] = useState("alpine");
  const [keyChoice, setKeyChoice] = useState(NEW_KEY);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyText, setNewKeyText] = useState("");
  const [creating, setCreating] = useState(false);

  // Default to the first saved key once keys load, if the user hasn't chosen.
  useEffect(() => {
    if (keyChoice === NEW_KEY && keys.length > 0) setKeyChoice(keys[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.length]);

  const imagesQuery = useQuery({
    queryKey: ["images"],
    queryFn: async (): Promise<string[]> => {
      const res = await fetch("/api/images");
      if (!res.ok) throw new Error("failed to load images");
      return (await res.json()).images;
    },
  });
  const images = imagesQuery.data ?? ["alpine"];

  // Resolve the public key to inject: a saved key, or a new one we save now.
  async function resolvePublicKey(): Promise<string | null> {
    if (keyChoice === NEW_KEY) {
      const parsed = sshKeyCreateSchema.safeParse({
        name: newKeyName.trim(),
        public_key: newKeyText.trim(),
      });
      if (!parsed.success) {
        toast.error("Invalid key", {
          description: parsed.error.issues[0].message,
        });
        return null;
      }
      try {
        const saved = await createKey(parsed.data);
        return saved.public_key;
      } catch (err) {
        toast.error("Saving key failed", {
          description: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }
    const chosen = keys.find((k) => k.id === keyChoice);
    if (!chosen) {
      toast.error("Select an SSH key");
      return null;
    }
    return chosen.public_key;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const start = performance.now();
    try {
      const publicKey = await resolvePublicKey();
      if (!publicKey) return;

      const parsed = instanceCreateSchema.safeParse({
        name: name.trim(),
        base_image: image,
        ssh_public_key: publicKey,
      });
      if (!parsed.success) {
        toast.error("Invalid input", {
          description: parsed.error.issues[0].message,
        });
        return;
      }
      await create(parsed.data);
      toast.success("Server created", {
        description: `${parsed.data.name} is booting`,
        timeTakenMs: performance.now() - start,
      });
      router.push("/servers");
    } catch (err) {
      toast.error("Create failed", {
        description: err instanceof Error ? err.message : String(err),
        timeTakenMs: performance.now() - start,
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 max-w-xl">
      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <label htmlFor="serverName">Server name:</label>
        <input
          id="serverName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-server"
          autoComplete="off"
          className="border border-[#efefea] bg-white rounded px-3 py-2"
        />
        <label htmlFor="image">Base image:</label>
        <select
          id="image"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          className="border border-[#efefea] bg-white rounded px-3 py-2"
        >
          {images.map((img) => (
            <option key={img} value={img}>
              {img}
            </option>
          ))}
        </select>

        <label htmlFor="sshKey">SSH key:</label>
        <select
          id="sshKey"
          value={keyChoice}
          onChange={(e) => setKeyChoice(e.target.value)}
          className="border border-[#efefea] bg-white rounded px-3 py-2"
        >
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
          <option value={NEW_KEY}>+ Add a new key…</option>
        </select>

        {keyChoice === NEW_KEY && (
          <div className="flex flex-col gap-3 border border-[#efefea] rounded p-3 bg-white">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="key name, e.g. my-laptop"
              autoComplete="off"
              className="border border-[#efefea] bg-white rounded px-3 py-2"
            />
            <textarea
              value={newKeyText}
              onChange={(e) => setNewKeyText(e.target.value)}
              placeholder="ssh-ed25519 AAAA… you@host"
              rows={3}
              spellCheck={false}
              className="border border-[#efefea] bg-white rounded px-3 py-2 font-mono text-sm resize-y"
            />
            <p className="text-xs text-gray-400">
              This key is saved to your SSH Keys and reusable for future
              servers.
            </p>
          </div>
        )}

        <p className="text-xs text-gray-400">
          A generic Alpine machine (1 vCPU, 128 MB). Your key is injected as
          root; connect with{" "}
          <span className="font-mono">ssh root@&lt;host&gt; -p &lt;port&gt;</span>{" "}
          once it&apos;s running.
        </p>
        <button
          type="submit"
          disabled={creating}
          className="bg-[#f26a1f] text-white font-bold rounded px-4 py-2 cursor-pointer transition-colors duration-150 hover:bg-[#d95a15] disabled:opacity-50 disabled:cursor-default"
        >
          {creating ? "Creating…" : "Create server"}
        </button>
      </form>
    </div>
  );
}
