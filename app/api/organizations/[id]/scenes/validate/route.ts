import { handleActorRoute, readJsonBody } from "@/lib/content-model/http.server";
import { requireUuid } from "@/lib/content-model/input";
import { validateOrganizationScene } from "@/lib/scene/service.server";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleActorRoute(request, `/api/organizations/${id}/scenes/validate`, async actor =>
    validateOrganizationScene(actor, requireUuid(id, "organization id"), await readJsonBody(request)),
  );
}
