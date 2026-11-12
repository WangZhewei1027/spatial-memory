import { publicActivities } from "@/lib/activities/runtime.server";
import { activityFailure } from "@/lib/activities/http.server";
import { json, optionalUuid } from "@/lib/miniapp/request";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return json(await publicActivities({ workspaceId: optionalUuid(params.get("workspace_id"), "workspace_id"), organizationId: optionalUuid(params.get("organization_id"), "organization_id") }));
  } catch (error) { return activityFailure(error, request); }
}
