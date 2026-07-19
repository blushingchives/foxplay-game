import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { instanceIdSchema } from "@/lib/models";

// CPU/memory samples for an instance (newest first, paginated), plus the
// running average over the last hour and the total sample count for paging.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!instanceIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const search = new URL(req.url).searchParams;
  let limit = Number(search.get("limit") ?? 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 10;
  if (limit > 200) limit = 200;
  let offset = Number(search.get("offset") ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  try {
    const [samples, totals, avg] = await Promise.all([
      db.query(
        `SELECT cpu_pct, mem_rss_kb::int AS mem_rss_kb, created_at
         FROM instance_metrics WHERE instance_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      ),
      db.query(
        `SELECT count(*)::int AS total FROM instance_metrics WHERE instance_id = $1`,
        [id],
      ),
      db.query(
        `SELECT avg(cpu_pct)::int AS cpu_pct, avg(mem_rss_kb)::int AS mem_rss_kb
         FROM instance_metrics
         WHERE instance_id = $1 AND created_at > now() - interval '1 hour'`,
        [id],
      ),
    ]);
    return NextResponse.json({
      samples: samples.rows,
      total: totals.rows[0].total,
      avg_1h: avg.rows[0], // cpu_pct/mem_rss_kb are null when no samples in the window
    });
  } catch (err) {
    console.error("instance metrics query:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
