import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sshKeyIdSchema } from "@/lib/models";

// Soft-deletes a saved key. Instances already created keep their injected
// key (it lives on their disk); this only removes it from the picker.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!sshKeyIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    await db.query(
      `UPDATE ssh_keys SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete ssh key:", err);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
