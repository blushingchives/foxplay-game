import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { functionIdSchema } from "@/lib/models";

// Function detail: registry row (authoritative — 404 when missing) plus
// metrics aggregates. int8 columns are cast to int in SQL — node-postgres
// returns bigint as strings otherwise.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!functionIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const fn = await db.query(
      `SELECT id, name, created_at, deleted_at FROM functions WHERE id = $1`,
      [id],
    );
    if (fn.rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const totals = await db.query(
      `SELECT count(*)::int AS runs, max(created_at) AS last_run,
              (count(*) FILTER (WHERE infra_error))::int AS infra_errors
       FROM invocations WHERE function_id = $1`,
      [id],
    );
    const dep = await db.query(
      `SELECT created_at, image_size_bytes::int AS image_size_bytes,
              build_ms::int AS build_ms, snapshot_enabled,
              snapshot_ms::int AS snapshot_ms, snapshot_ok,
              kernel_path, kernel_size_bytes::int AS kernel_size_bytes,
              base_rootfs_path, base_rootfs_size_bytes::int AS base_rootfs_size_bytes,
              bootstrap_version
       FROM deployments WHERE function_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [id],
    );

    const t = totals.rows[0];
    return NextResponse.json({
      id,
      name: fn.rows[0].name,
      created_at: fn.rows[0].created_at,
      deleted_at: fn.rows[0].deleted_at,
      runs: t.runs,
      last_run: t.last_run,
      infra_errors: t.infra_errors,
      last_deployment: dep.rows[0] ?? null,
    });
  } catch (err) {
    console.error("function detail query:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

// Soft-deletes the registry row and removes the deployed image + snapshot
// from the server. Metrics history stays attributable via the soft-deleted
// row. If the artifact delete fails, nothing is marked deleted so the
// operation can be retried.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!functionIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const res = await fetch(
      `${process.env.ARTIFACT_STORE_URL}/delete/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `server code delete failed: ${await res.text()}` },
        { status: 502 },
      );
    }
    await db.query(
      `UPDATE functions SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete function:", err);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
