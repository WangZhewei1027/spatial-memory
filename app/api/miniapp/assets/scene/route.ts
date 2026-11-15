import { errorResponse, json, optionalUuid, readJson, requireUuid } from "@/lib/miniapp/request";
import { RuntimeNotFound, sceneManifest } from "@/lib/placements/runtime.server";
import { SceneAssetError } from "@/lib/scene/validate";

// Public: compile the discovered placement's fixed scene revision for playback.
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const assetId = requireUuid(body.asset_id, "asset_id");
    const workspaceId = optionalUuid(body.p_workspace_id, "p_workspace_id");
    const organizationId = optionalUuid(body.p_organization_id, "p_organization_id");
    if (!workspaceId && !organizationId) return json({ error: "缺少工作空间或组织" }, 400);
    return json(await sceneManifest(assetId, { workspaceId, organizationId }));
  } catch (error) {
    if (error instanceof SceneAssetError) return json({ error: error.message }, error.status);
    if (error instanceof RuntimeNotFound) return json({ error: error.message }, 404);
    return errorResponse(error, request);
  }
}
