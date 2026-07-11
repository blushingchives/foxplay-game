import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { instanceIdSchema } from "@/lib/models";
import { instanceManager, type InstanceSpec } from "@/lib/instanceManager";

async function loadSpec(id: string): Promise<{ row: SpecRow | null }> {
  const res = await db.query(
    `SELECT id, name, state, base_image, vcpu, mem_mib, guest_ip,
            ssh_host_port, ssh_public_key, created_at, deleted_at
     FROM instances WHERE id = $1`,
    [id],
  );
  return { row: res.rows[0] ?? null };
}

type SpecRow = {
  id: string;
  base_image: string;
  vcpu: number;
  mem_mib: number;
  guest_ip: string;
  ssh_host_port: number;
  ssh_public_key: string;
};

function toSpec(row: SpecRow): InstanceSpec {
  return {
    id: row.id,
    base_image: row.base_image,
    vcpu: row.vcpu,
    mem_mib: row.mem_mib,
    guest_ip: row.guest_ip,
    ssh_host_port: row.ssh_host_port,
    ssh_public_key: row.ssh_public_key,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!instanceIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const res = await db.query(
      `SELECT id, name, state, base_image, vcpu, mem_mib, guest_ip,
              ssh_host_port, created_at
       FROM instances WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error("instance detail:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

// Stops the instance (if running) and removes its disk, then soft-deletes.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!instanceIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const { row } = await loadSpec(id);
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    try {
      await instanceManager.delete(toSpec(row));
    } catch (err) {
      return NextResponse.json(
        { error: `server teardown failed: ${err instanceof Error ? err.message : err}` },
        { status: 502 },
      );
    }
    await db.query(
      `UPDATE instances SET state = 'stopped', deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete instance:", err);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
