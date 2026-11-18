import { handleActorRoute, readJsonBody } from "@/lib/content-model/http.server";
import { requireEnum, requireUuid } from "@/lib/content-model/input";
import { TEMPLATE_TYPES } from "@/lib/content-model/template-contracts";
import { getManualPreview, setManualPreview } from "@/lib/content-model/templates.server";

type Context = { params: Promise<{ type: string; id: string }> };

async function preview(request: Request, { params }: Context) {
  const { type, id } = await params;
  return handleActorRoute(request, `/api/templates/${type}/${id}/preview`, async actor => {
    const sourceType = requireEnum(type, "type", TEMPLATE_TYPES);
    const sourceId = requireUuid(id, "id");
    return request.method === "GET"
      ? getManualPreview(actor, sourceType, sourceId)
      : setManualPreview(actor, sourceType, sourceId, await readJsonBody(request));
  });
}

export { preview as GET, preview as PUT };
