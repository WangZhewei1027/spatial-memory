import { errorResponse, json, readJson, requireUuid } from "@/lib/miniapp/request";
import { previewSceneManifest, RuntimeNotFound } from "@/lib/placements/runtime.server";
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    return json(await previewSceneManifest(requireUuid(body.scene_id, "scene_id"), requireUuid(body.organization_id, "organization_id")));
  } catch (error) {
    if (error instanceof RuntimeNotFound) return json({ error: error.message }, 404);
    return errorResponse(error, request);
  }
}
