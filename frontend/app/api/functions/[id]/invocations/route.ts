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
  let limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 500) limit = 500;

  try {
    const res = await db.query(
      `SELECT start_type, queue_wait_ms::int AS queue_wait_ms,
              boot_ms::int AS boot_ms, invoke_ms::int AS invoke_ms,
              status, infra_error, cpu_ms::int AS cpu_ms,
              mem_peak_kb::int AS mem_peak_kb, request_body, created_at
       FROM invocations WHERE function_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [id, limit],
    );
    return NextResponse.json({ invocations: res.rows });
  } catch (err) {
    console.error("invocations query:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
