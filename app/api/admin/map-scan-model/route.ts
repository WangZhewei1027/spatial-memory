import { handleActorRoute, readJsonBody } from "@/lib/content-model/http.server";
import { listMapScanModelOrganizations, updateMapScanModelSetting } from "@/lib/map-scan-model.server";

const PATH = "/api/admin/map-scan-model";

export async function GET(request: Request) {
  return handleActorRoute(request, PATH, listMapScanModelOrganizations);
}

export async function PUT(request: Request) {
  return handleActorRoute(request, PATH, async (actor) => updateMapScanModelSetting(actor, await readJsonBody(request)));
}
