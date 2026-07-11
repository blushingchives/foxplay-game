import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { functionIdSchema } from "@/lib/models";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!functionIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const search = new URL(req.url).searchParams;
  let limit = Number(search.get("limit") ?? 50);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 500) limit = 500;
  let offset = Number(search.get("offset") ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  try {
    const res = await db.query(
      `SELECT start_type, queue_wait_ms::int AS queue_wait_ms,
              boot_ms::int AS boot_ms, invoke_ms::int AS invoke_ms,
              status, infra_error, cpu_ms::int AS cpu_ms,
              mem_peak_kb::int AS mem_peak_kb, request_body, created_at
       FROM invocations WHERE function_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    return NextResponse.json({ invocations: res.rows });
  } catch (err) {
    console.error("invocations query:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
