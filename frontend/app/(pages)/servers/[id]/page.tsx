import Header from "@/components/Header";
import InstanceDetailClient from "@/features/servers/components/InstanceDetailClient";

export default async function ServerDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Header />
      <InstanceDetailClient id={decodeURIComponent(id)} />
    </>
  );
}
