"use client";
import { useRouter } from "next/navigation";
import UploadForm from "@/features/functions/components/UploadForm";

export default function CreateFunctionClient() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-xl">
      <UploadForm onDeployed={() => router.push("/functions")} />
    </div>
  );
}
