import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { functionNameSchema } from "@/lib/models";

// The function registry. Functions are identified by UUID; name is a
// display label, unique per user among active (non-deleted) functions.
// user_id scoping comes with Clerk auth later.

const registerBodySchema = z.object({ name: functionNameSchema });

export async function GET() {
  try {
    const res = await db.query(
      `SELECT id, name, created_at FROM functions
       WHERE deleted_at IS NULL ORDER BY name`,
    );
    return NextResponse.json({ functions: res.rows });
  } catch (err) {
    console.error("list functions:", err);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

// Registers a new function and returns its id — called before the code is
// deployed, since the artifact-store stores the image under the id.
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
    const res = await db.query(
      `INSERT INTO functions (name) VALUES ($1) RETURNING id, name`,
      [name],
    );
    return NextResponse.json(res.rows[0], { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: `a function named '${name}' already exists` },
        { status: 409 },
      );
    }
    console.error("register function:", err);
    return NextResponse.json({ error: "insert failed" }, { status: 500 });
  }
}
