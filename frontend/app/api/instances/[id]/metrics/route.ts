import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { instanceIdSchema } from "@/lib/models";

// Recent CPU/memory samples for an instance, newest first. Written by the
// instance-manager's sampler via the metrics service.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!instanceIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  if (limit > 200) limit = 200;

  try {
    const res = await db.query(
      `SELECT cpu_pct, mem_rss_kb::int AS mem_rss_kb, created_at
       FROM instance_metrics WHERE instance_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [id, limit],
    );
    return NextResponse.json({ samples: res.rows });
  } catch (err) {
    console.error("instance metrics query:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
