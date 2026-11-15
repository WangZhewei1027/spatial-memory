import {
  errorResponse,
  json,
  optionalUuid,
  readJson,
  requireUuid,
} from "@/lib/miniapp/request";
import { hugePlacements } from "@/lib/placements/runtime.server";

// Public: active model placements with render_config.is_huge.
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const organizationId = requireUuid(body.p_organization_id, "p_organization_id");
    const workspaceId = optionalUuid(body.p_workspace_id, "p_workspace_id");

    return json(await hugePlacements({ workspaceId, organizationId }));
  } catch (error) {
    return errorResponse(error, request);
  }
}
