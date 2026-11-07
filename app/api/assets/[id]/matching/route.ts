import { MatchingError } from "@/lib/anchor-matching";
import { getMatchingAnchor } from "@/lib/anchor/access.server";
import { NextResponse } from "next/server";
type Context = { params: Promise<{ id: string }> };

/** OSD consumes reference images directly; no cloud feature-generation request. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const asset = await getMatchingAnchor(id);
    return NextResponse.json({ data: { status: asset.file_url ? "ready" : "missing_image", engine: "osd" } },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MatchingError ? error.message : "无法读取参考图状态" },
      { status: error instanceof MatchingError ? error.status : 503 });
  }
}

// Retained for older management clients; it only refreshes image availability.
export const POST = GET;
