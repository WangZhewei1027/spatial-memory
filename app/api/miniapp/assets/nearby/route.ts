import {
  errorResponse,
  finiteNumber,
  json,
  optionalUuid,
  readJson,
} from "@/lib/miniapp/request";
import { nearbyPlacements } from "@/lib/placements/runtime.server";

// Public: active placements within a GPS radius, resolved at current assets.
const MAX_RADIUS_METERS = 5000;

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const lat = finiteNumber(body.user_lat, -90, 90, "user_lat");
    const lng = finiteNumber(body.user_lng, -180, 180, "user_lng");
    const radius = finiteNumber(
      body.max_distance_meters,
      0,
      MAX_RADIUS_METERS,
      "max_distance_meters",
    );
    const workspaceId = optionalUuid(body.p_workspace_id, "p_workspace_id");
    const organizationId = optionalUuid(body.p_organization_id, "p_organization_id");
    return json(await nearbyPlacements({ workspaceId, organizationId }, lat, lng, radius));
  } catch (error) {
    return errorResponse(error, request);
  }
}
