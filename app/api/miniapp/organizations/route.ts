import { db } from "@/lib/db";
import { errorResponse, json, parseIds } from "@/lib/miniapp/request";

// Public organization names. Map settings are returned by /workspaces.
//   GET /api/miniapp/organizations?ids=<uuid>,<uuid>
//   → [{ id, name }]
// Replaces the mini-program's direct PostgREST reads of `organization`.

export async function GET(request: Request) {
  try {
    const ids = parseIds(request);
    const rows = await db
      .selectFrom("organization")
      .select(["id", "name"])
      .where("id", "in", ids)
      .execute();
    return json(rows);
  } catch (error) {
    return errorResponse(error);
  }
}
