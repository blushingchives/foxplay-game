import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Reads the tables the metrics service writes. int8 columns are cast to int
// in SQL — node-postgres returns bigint as strings otherwise.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  try {
    const totals = await db.query(
      `SELECT count(*)::int AS runs, max(created_at) AS last_run,
              (count(*) FILTER (WHERE infra_error))::int AS infra_errors
       FROM invocations WHERE function_name = $1`,
      [name],
    );
    const dep = await db.query(
      `SELECT created_at, image_size_bytes::int AS image_size_bytes,
              build_ms::int AS build_ms, snapshot_enabled,
              snapshot_ms::int AS snapshot_ms, snapshot_ok,
              kernel_path, kernel_size_bytes::int AS kernel_size_bytes,
              base_rootfs_path, base_rootfs_size_bytes::int AS base_rootfs_size_bytes,
              bootstrap_version
       FROM deployments WHERE function_name = $1
       ORDER BY created_at DESC LIMIT 1`,
      [name],
    );

    const t = totals.rows[0];
    const lastDeployment = dep.rows[0] ?? null;
    if (t.runs === 0 && !lastDeployment) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({
      name,
      runs: t.runs,
      last_run: t.last_run,
      infra_errors: t.infra_errors,
      last_deployment: lastDeployment,
    });
  } catch (err) {
    console.error("function detail query:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

// Removes the function everywhere: deployed image + snapshot on the server
// (via the artifact-store), then the registry row. Metrics history
// (invocations, deployments) is deliberately kept. If the artifact delete
// fails, the registry row survives so the delete can be retried.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  try {
    const res = await fetch(
      `${process.env.ARTIFACT_STORE_URL}/delete/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `server code delete failed: ${await res.text()}` },
        { status: 502 },
      );
    }
    await db.query(`DELETE FROM functions WHERE name = $1`, [name]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete function:", err);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
