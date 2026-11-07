import { handleActorRoute } from "@/lib/content-model/http.server";
import { requireUuid } from "@/lib/content-model/input";
import { getMapScanModelSetting } from "@/lib/map-scan-model.server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleActorRoute(request, `/api/organizations/${id}/map-scan-model`,
    (actor) => getMapScanModelSetting(actor, requireUuid(id, "organizationId")));
}
