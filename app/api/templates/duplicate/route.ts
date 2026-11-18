import { duplicateTemplate } from "@/lib/content-model/duplicate.server";
import { handleActorRoute, ok, readJsonBody } from "@/lib/content-model/http.server";

export async function POST(request: Request) {
  return handleActorRoute(request, "/api/templates/duplicate", async (actor) => {
    const result = await duplicateTemplate(actor, await readJsonBody(request));
    return ok(result, result.created ? 201 : 200);
  });
}
