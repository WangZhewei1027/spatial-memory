import { duplicateContent } from "@/lib/content-model/duplicate.server";
import { handleActorRoute, ok, readJsonBody } from "@/lib/content-model/http.server";

export async function POST(request: Request) {
  return handleActorRoute(request, "/api/content/duplicate", async (actor) => {
    const result = await duplicateContent(actor, await readJsonBody(request));
    return ok(result, result.created ? 201 : 200);
  });
}
