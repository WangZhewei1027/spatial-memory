import { db } from "@/lib/db";
import { errorResponse, json, optionalUuid, parseIds, requireUuid } from "@/lib/miniapp/request";
import { parseCollectionMiniappConfig } from "@/lib/content-model/collection-config";

// Public: open map names and their complete, whitelisted mini-program configuration.
//   GET /api/miniapp/workspaces?ids=<uuid>,<uuid>
//   GET /api/miniapp/workspaces?organization_id=<uuid> lists a team's open maps.
//   → [{ id, name, organization_id, config }]
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const ids = params.has("ids") ? parseIds(request) : null;
    const organizationId = optionalUuid(params.get("organization_id"), "organization_id");
    if (!ids) requireUuid(organizationId, "organization_id");
    let query = db.selectFrom("workspace as w").innerJoin("organization as o", "o.id", "w.organization_id")
      .select(["w.id", "w.name", "w.organization_id", "w.miniapp_config"])
      .where("w.archived_at", "is", null).where("o.archived_at", "is", null);
    if (ids) query = query.where("w.id", "in", ids);
    if (organizationId) query = query.where("w.organization_id", "=", organizationId);
    const rows = await query.orderBy("w.name").orderBy("w.id").execute();
    return json(rows.map(({ miniapp_config, ...row }) => ({ ...row, config: parseCollectionMiniappConfig(miniapp_config) })));
  } catch (error) {
    return errorResponse(error);
  }
}
