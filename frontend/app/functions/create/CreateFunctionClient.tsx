"use client";
import { useRouter } from "next/navigation";
import UploadForm from "@/app/functions/UploadForm";
import { useFunctions } from "@/app/functions/useFunctions";

export default function CreateFunctionClient() {
  const router = useRouter();
  const { add } = useFunctions();

  return (
    <div className="p-6 max-w-xl">
      <UploadForm
        onDeployed={(name) => {
          add(name);
          router.push("/functions");
        }}
      />
    </div>
  );
}
