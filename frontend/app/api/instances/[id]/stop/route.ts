import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { instanceIdSchema } from "@/lib/models";
import { instanceManager } from "@/lib/instanceManager";

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
      `SELECT id FROM instances WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    try {
      await instanceManager.stop(id);
    } catch (err) {
      return NextResponse.json(
        { error: `stop failed: ${err instanceof Error ? err.message : err}` },
        { status: 502 },
      );
    }
    await db.query(`UPDATE instances SET state = 'stopped' WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("stop instance:", err);
    return NextResponse.json({ error: "stop failed" }, { status: 500 });
  }
}
