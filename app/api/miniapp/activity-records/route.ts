import { parseSubmission, publicDanmaku, submitActivityRecord } from "@/lib/activities/runtime.server";
import { activityFailure } from "@/lib/activities/http.server";
import { allowRequest } from "@/lib/miniapp/rate-limit";
import { clientIp, finiteNumber, json, readJson, requireUuid } from "@/lib/miniapp/request";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const placementId = requireUuid(params.get("placement_id"), "placement_id");
    const hasLocation = params.has("user_lat") || params.has("user_lng");
    const location = hasLocation ? { latitude: finiteNumber(params.get("user_lat"), -90, 90, "user_lat"), longitude: finiteNumber(params.get("user_lng"), -180, 180, "user_lng") } : undefined;
    return json(await publicDanmaku({ workspaceId: null, organizationId: null }, { placementId, location,
      radius: params.has("max_distance_meters") ? finiteNumber(params.get("max_distance_meters"), 0, 5000, "max_distance_meters") : undefined }));
  } catch (error) { return activityFailure(error, request); }
}
export async function POST(request: Request) {
  try {
    const input = parseSubmission(await readJson(request));
    if (!allowRequest(`activity:ip:${clientIp(request)}`, 60, 60000) || !allowRequest(`activity:placement:${input.placementId}`, 120, 60000))
      return json({ error: "发送过于频繁，请稍后重试" }, 429);
    return json(await submitActivityRecord(input));
  } catch (error) { return activityFailure(error, request); }
}
