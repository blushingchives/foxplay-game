"use client";
import { useEffect, useRef, useState } from "react";

type Props = {
  file: File | null;
  onSelect: (f: File | undefined) => void;
};

export default function FileDropzone({ file, onSelect }: Props) {
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // When the parent clears the selection (e.g. after a successful upload),
  // clear the native input too so re-picking the same file fires onChange.
  useEffect(() => {
    if (!file && fileRef.current) fileRef.current.value = "";
  }, [file]);

  return (
    <div
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragActive(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        onSelect(e.dataTransfer.files?.[0]);
      }}
      className={`flex flex-col items-center justify-center gap-1 h-32 bg-white border-2 border-dashed rounded cursor-pointer transition-colors duration-150 ${
        dragActive
          ? "border-[#f26a1f] bg-[#fff7f2]"
          : "border-[#e0e0da] hover:border-[#f26a1f]"
      }`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-400"
      >
        <path d="M12 13v8" />
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
        <path d="m8 17 4-4 4 4" />
      </svg>
      {file ? (
        <>
          <span className="font-mono text-sm">{file.name}</span>
          <span className="text-xs text-gray-400">
            {(file.size / 1024).toFixed(1)} KB — click to change
          </span>
        </>
      ) : (
        <>
          <span className="text-sm">
            <span className="font-bold text-[#f26a1f]">Click to upload</span>{" "}
            or drag and drop
          </span>
          <span className="text-xs text-gray-400">.tar.gz or .tgz</span>
        </>
      )}
      <input
        id="code"
        type="file"
        ref={fileRef}
        accept=".tar.gz,.tgz,application/gzip"
        className="hidden"
        onChange={(e) => onSelect(e.target.files?.[0])}
      />
    </div>
  );
}
