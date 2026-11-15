import { db } from "@/lib/db";
import { errorResponse, json, parseIds, requireUuid } from "@/lib/miniapp/request";

// Public names for scanned Scenes, scoped exactly like standalone preview.
export async function GET(request: Request) {
  try {
    const ids = parseIds(request);
    const organizationId = requireUuid(new URL(request.url).searchParams.get("organization_id"), "organization_id");
    const rows = await db.selectFrom("scene as s")
      .innerJoin("organization as o", "o.id", "s.organization_id")
      .select(["s.id", "s.name"])
      .where("s.id", "in", ids)
      .where("s.organization_id", "=", organizationId)
      .where("s.state", "=", "active")
      .where("o.archived_at", "is", null)
      .execute();
    return json(rows);
  } catch (error) {
    return errorResponse(error, request);
  }
}
