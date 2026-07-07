"use client";
import { useState } from "react";
import { toast } from "@/app/components/Toast";
import FileDropzone from "@/app/functions/FileDropzone";

type Props = {
  onDeployed: (name: string) => void;
};

export default function UploadForm({ onDeployed }: Props) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  function selectFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(tar\.gz|tgz)$/i.test(f.name)) {
      toast.error("Invalid file", {
        description: "Please choose a .tar.gz or .tgz file",
      });
      return;
    }
    setFile(f);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const functionName = name.trim();
    if (!functionName || !file) return;
    if (!/^[a-z0-9-]{1,64}$/.test(functionName)) {
      toast.error("Invalid name", {
        description: "Use lowercase letters, digits, and hyphens only",
      });
      return;
    }

    setUploading(true);
    const start = performance.now();
    try {
      const formData = new FormData();
      formData.append("code", file);
      const res = await fetch(`/api/artifact-store/deploy/${functionName}`, {
        method: "POST",
        body: formData,
      });
      const elapsed = performance.now() - start;
      if (!res.ok) {
        toast.error(`Deploy ${functionName} failed`, {
          description: await res.text(),
          timeTakenMs: elapsed,
        });
        return;
      }
      onDeployed(functionName);
      toast.success("Deployed", {
        description: `${functionName} is ready to invoke`,
        timeTakenMs: elapsed,
      });
      setName("");
      setFile(null);
    } catch (err) {
      toast.error(`Deploy ${functionName} failed`, {
        description: String(err),
        timeTakenMs: performance.now() - start,
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleUpload} className="flex flex-col gap-3">
      <label htmlFor="functionName">Function name:</label>
      <input
        id="functionName"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="my-function"
        autoComplete="off"
        className="border border-[#efefea] bg-white rounded px-3 py-2"
      />
      <label htmlFor="code">Code (.tar.gz):</label>
      <FileDropzone file={file} onSelect={selectFile} />
      <button
        type="submit"
        disabled={uploading}
        className="bg-[#f26a1f] text-white font-bold rounded px-4 py-2 transition-colors duration-150 hover:bg-[#d95a15] disabled:opacity-50"
      >
        {uploading ? "Uploading..." : "Upload"}
      </button>
    </form>
  );
}
