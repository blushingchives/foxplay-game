"use client";
import { useRouter } from "next/navigation";
import UploadForm from "@/features/functions/components/UploadForm";
import { useFunctions } from "@/features/functions/hooks/useFunctions";

export default function CreateFunctionClient() {
  const router = useRouter();
  const { add } = useFunctions();

  return (
    <div className="p-6 max-w-xl">
      <UploadForm
        onDeployed={async (name) => {
          // the deploy itself succeeded; a failed registry insert just means
          // the list misses the name until the next deploy re-registers it
          await add(name).catch(() => {});
          router.push("/functions");
        }}
      />
    </div>
  );
}
