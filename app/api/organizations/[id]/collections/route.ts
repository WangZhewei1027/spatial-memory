import { teamLibraryResponse } from "@/lib/content-model/team-library.server";
import { handleActorRoute, readJsonBody } from "@/lib/content-model/http.server";
import { requireUuid } from "@/lib/content-model/input";
import { createCollection, listCollections } from "@/lib/content-model/projects.server";

type Context = { params: Promise<{ id: string }> };

// GET  /api/organizations/[id]/collections?state=active|archived|all (default active) → { data: CollectionDto[] }
// POST /api/organizations/[id]/collections { name, description? } → 201 { data: CollectionDto }
// Map collections are stored as workspace rows; every team writer manages them.
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return teamLibraryResponse(request, id, "collections", "active", listCollections);
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleActorRoute(
    request,
    `/api/organizations/${id}/collections`,
    async (actor) => createCollection(actor, requireUuid(id, "organization id"), await readJsonBody(request)),
    201,
  );
}
