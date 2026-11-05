import { teamLibraryResponse } from "@/lib/content-model/team-library.server";
import { handleActorRoute, readJsonBody } from "@/lib/content-model/http.server";
import { requireUuid } from "@/lib/content-model/input";
import { createOrganizationScene, listOrganizationScenes } from "@/lib/scene/service.server";

type Context = { params: Promise<{ id: string }> };

// GET  /api/organizations/[id]/scenes?state=active|archived|all (default all) → { data: SceneSummaryDto[] }
// POST /api/organizations/[id]/scenes CreateSceneRequest → 201 { data: SceneDetailDto }
// Scenes belong to the team; no collection is involved.
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return teamLibraryResponse(request, id, "scenes", "all", listOrganizationScenes);
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleActorRoute(
    request,
    `/api/organizations/${id}/scenes`,
    async (actor) => createOrganizationScene(actor, requireUuid(id, "organization id"), await readJsonBody(request)),
    201,
  );
}
