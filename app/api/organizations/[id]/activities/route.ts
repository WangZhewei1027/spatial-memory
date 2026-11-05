import { teamLibraryResponse } from "@/lib/content-model/team-library.server";
import { handleActorRoute, readJsonBody } from "@/lib/content-model/http.server";
import { requireUuid } from "@/lib/content-model/input";
import { createActivity, listActivities } from "@/lib/activities/service.server";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return teamLibraryResponse(request, id, "activities", "all", listActivities);
}
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleActorRoute(request, `/api/organizations/${id}/activities`, async (actor) => createActivity(actor, requireUuid(id, "organization id"), await readJsonBody(request)), 201);
}
