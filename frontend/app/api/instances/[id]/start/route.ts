import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { instanceIdSchema } from "@/lib/models";
import { instanceManager, type InstanceSpec } from "@/lib/instanceManager";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!instanceIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const res = await db.query(
      `SELECT id, base_image, vcpu, mem_mib, guest_ip, ssh_host_port, ssh_public_key
       FROM instances WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const spec = res.rows[0] as InstanceSpec;
    try {
      await instanceManager.start(spec);
    } catch (err) {
      return NextResponse.json(
        { error: `start failed: ${err instanceof Error ? err.message : err}` },
        { status: 502 },
      );
    }
    await db.query(`UPDATE instances SET state = 'running' WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("start instance:", err);
    return NextResponse.json({ error: "start failed" }, { status: 500 });
  }
}
