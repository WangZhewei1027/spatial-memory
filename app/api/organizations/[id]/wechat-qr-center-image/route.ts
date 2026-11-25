import { handleActorRoute, readJsonBody } from "@/lib/content-model/http.server";
import { requireUuid } from "@/lib/content-model/input";
import { setTeamQrCenterImage } from "@/lib/wechat-qr-center-image.server";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleActorRoute(request, `/api/organizations/${id}/wechat-qr-center-image`, async (actor) =>
    setTeamQrCenterImage(actor, requireUuid(id, "organizationId"), await readJsonBody(request)));
}
