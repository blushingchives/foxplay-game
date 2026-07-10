import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { functionNameSchema } from "@/lib/models";

const registerBodySchema = z.object({ name: functionNameSchema });

// The function registry (which functions exist). user_id scoping comes
// with Clerk auth later.

export async function GET() {
  try {
    const res = await db.query(
      `SELECT name, created_at FROM functions ORDER BY name`,
    );
    return NextResponse.json({ functions: res.rows });
  } catch (err) {
    console.error("list functions:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = registerBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }
  const { name } = parsed.data;
  try {
    await db.query(
      `INSERT INTO functions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name],
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("register function:", err);
    return NextResponse.json({ error: "insert failed" }, { status: 500 });
  }
}
