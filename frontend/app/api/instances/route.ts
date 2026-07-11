import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { instanceCreateSchema } from "@/lib/models";
import { instanceManager, type InstanceSpec } from "@/lib/instanceManager";

const DEFAULT_VCPU = 1;
const DEFAULT_MEM_MIB = 128;

export async function GET() {
  try {
    const res = await db.query(
      `SELECT id, name, state, base_image, guest_ip, ssh_host_port, created_at
       FROM instances WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    // Reconcile DB state against what the manager is actually running (covers
    // host reboots and re-adoption misses). Skip silently if it's unreachable.
    try {
      const { running } = await instanceManager.running();
      const live = new Set(running);
      const stale = res.rows.filter(
        (r) => r.state === "running" && !live.has(r.id),
      );
      if (stale.length > 0) {
        await db.query(
          `UPDATE instances SET state = 'stopped'
           WHERE id = ANY($1) AND deleted_at IS NULL`,
          [stale.map((r) => r.id)],
        );
        for (const r of stale) r.state = "stopped";
      }
    } catch {
      // manager down — show DB state as-is
    }
    return NextResponse.json({ instances: res.rows });
  } catch (err) {
    console.error("list instances:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

// Allocates a guest IP + host SSH port, records the row, then asks the
// instance-manager to provision and boot. On boot failure the row is marked
// 'error' so it can be retried or deleted.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = instanceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }
  const { name, base_image, ssh_public_key } = parsed.data;

  try {
    // Allocate from the high-water mark across all rows (incl. deleted) to
    // avoid reusing a slot whose host networking might still linger.
    const alloc = await db.query(
      `SELECT COALESCE(MAX(ssh_host_port), 39999) + 1 AS port,
              COALESCE(MAX(split_part(guest_ip, '.', 4)::int), 1) + 1 AS octet
       FROM instances`,
    );
    const port: number = alloc.rows[0].port;
    const octet: number = alloc.rows[0].octet;
    if (octet > 254) {
      return NextResponse.json({ error: "address space full" }, { status: 507 });
    }
    const guestIp = `172.16.0.${octet}`;

    const inserted = await db.query(
      `INSERT INTO instances
         (name, state, base_image, vcpu, mem_mib, guest_ip, ssh_host_port, ssh_public_key)
       VALUES ($1, 'creating', $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [name, base_image, DEFAULT_VCPU, DEFAULT_MEM_MIB, guestIp, port, ssh_public_key],
    );
    const id: string = inserted.rows[0].id;

    const spec: InstanceSpec = {
      id,
      base_image,
      vcpu: DEFAULT_VCPU,
      mem_mib: DEFAULT_MEM_MIB,
      guest_ip: guestIp,
      ssh_host_port: port,
      ssh_public_key,
    };
    try {
      await instanceManager.create(spec);
    } catch (err) {
      await db.query(`UPDATE instances SET state = 'error' WHERE id = $1`, [id]);
      return NextResponse.json(
        { error: `create failed: ${err instanceof Error ? err.message : err}` },
        { status: 502 },
      );
    }
    await db.query(`UPDATE instances SET state = 'running' WHERE id = $1`, [id]);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: `an instance named '${name}' already exists` },
        { status: 409 },
      );
    }
    console.error("create instance:", err);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
