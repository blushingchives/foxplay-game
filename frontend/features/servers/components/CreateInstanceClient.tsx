"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/components/Toast";
import { useInstances } from "@/features/servers/hooks/useInstances";
import { instanceCreateSchema } from "@/lib/models";

export default function CreateInstanceClient() {
  const router = useRouter();
  const { create } = useInstances();
  const [name, setName] = useState("");
  const [image, setImage] = useState("alpine");
  const [sshKey, setSshKey] = useState("");
  const [creating, setCreating] = useState(false);

  const imagesQuery = useQuery({
    queryKey: ["images"],
    queryFn: async (): Promise<string[]> => {
      const res = await fetch("/api/images");
      if (!res.ok) throw new Error("failed to load images");
      return (await res.json()).images;
    },
  });
  const images = imagesQuery.data ?? ["alpine"];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const parsed = instanceCreateSchema.safeParse({
      name: name.trim(),
      base_image: image,
      ssh_public_key: sshKey.trim(),
    });
    if (!parsed.success) {
      toast.error("Invalid input", {
        description: parsed.error.issues[0].message,
      });
      return;
    }

    setCreating(true);
    const start = performance.now();
    try {
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
        <label htmlFor="sshKey">SSH public key:</label>
        <textarea
          id="sshKey"
          value={sshKey}
          onChange={(e) => setSshKey(e.target.value)}
          placeholder="ssh-ed25519 AAAA… you@host"
          rows={4}
          spellCheck={false}
          className="border border-[#efefea] bg-white rounded px-3 py-2 font-mono text-sm resize-y"
        />
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
