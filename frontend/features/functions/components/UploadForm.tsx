"use client";
import { useState } from "react";
import { toast } from "@/components/Toast";
import FileDropzone from "@/features/functions/components/FileDropzone";
import { uploadFormSchema } from "@/lib/models";

type Props = {
  onDeployed: (name: string) => void;
};

export default function UploadForm({ onDeployed }: Props) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [snapshot, setSnapshot] = useState(true);
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
    const parsed = uploadFormSchema.safeParse({
      name: name.trim(),
      file,
      snapshot,
    });
    if (!parsed.success) {
      toast.error("Invalid input", {
        description: parsed.error.issues[0].message,
      });
      return;
    }
    const { name: functionName, file: codeFile } = parsed.data;

    setUploading(true);
    const start = performance.now();
    try {
      const formData = new FormData();
      formData.append("code", codeFile);
      formData.append("snapshot", String(parsed.data.snapshot));
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
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={snapshot}
          onChange={(e) => setSnapshot(e.target.checked)}
          className="mt-1 accent-[#f26a1f]"
        />
        <span>
          Create startup snapshot
          <span className="block text-xs text-gray-400">
            Boots the function once at deploy so later cold starts resume in
            under a second. Costs ~256 MB disk and a few extra seconds now.
          </span>
        </span>
      </label>
      <button
        type="submit"
        disabled={uploading}
        className="bg-[#f26a1f] text-white font-bold rounded px-4 py-2 cursor-pointer transition-colors duration-150 hover:bg-[#d95a15] disabled:opacity-50 disabled:cursor-default"
      >
        {uploading ? "Uploading..." : "Upload"}
      </button>
    </form>
  );
}
