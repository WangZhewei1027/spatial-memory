import { activityProgress, parseParticipant } from "@/lib/activities/runtime.server";
import { activityFailure } from "@/lib/activities/http.server";
import { json, requireUuid } from "@/lib/miniapp/request";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return json(await activityProgress(requireUuid(params.get("placement_id"), "placement_id"), parseParticipant(params.get("participant_id"))));
  } catch (error) { return activityFailure(error, request); }
}
