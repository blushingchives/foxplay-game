import { NextResponse } from "next/server";
import { instanceManager } from "@/lib/instanceManager";

// Base images available on the host for new instances.
export async function GET() {
  try {
    const { images } = await instanceManager.images();
    return NextResponse.json({ images });
  } catch {
    // manager down or no images built yet — fall back to the default
    return NextResponse.json({ images: ["alpine"] });
  }
}
