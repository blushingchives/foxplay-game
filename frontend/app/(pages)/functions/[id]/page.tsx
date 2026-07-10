import Header from "@/components/Header";
import FunctionDetailClient from "@/features/functions/components/FunctionDetailClient";

export default async function FunctionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Header />
      <FunctionDetailClient name={decodeURIComponent(id)} />
    </>
  );
}
