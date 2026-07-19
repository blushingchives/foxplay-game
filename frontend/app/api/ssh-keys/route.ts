import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sshKeyCreateSchema } from "@/lib/models";

// Saved SSH public keys, selectable when creating a server.
export async function GET() {
  try {
    const res = await db.query(
      `SELECT id, name, public_key, created_at FROM ssh_keys
       WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return NextResponse.json({ keys: res.rows });
  } catch (err) {
    console.error("list ssh keys:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = sshKeyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }
  const { name, public_key } = parsed.data;
  try {
    const res = await db.query(
      `INSERT INTO ssh_keys (name, public_key) VALUES ($1, $2)
       RETURNING id, name, public_key`,
      [name, public_key.trim()],
    );
    return NextResponse.json(res.rows[0], { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: `a key named '${name}' already exists` },
        { status: 409 },
      );
    }
    console.error("create ssh key:", err);
    return NextResponse.json({ error: "insert failed" }, { status: 500 });
  }
}
