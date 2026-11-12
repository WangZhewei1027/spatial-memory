import "server-only";
import { ContentError } from "@/lib/content-model/errors";
import { errorResponse, json } from "@/lib/miniapp/request";
export async function activityFailure(error: unknown, request: Request) {
  return error instanceof ContentError ? json({ error: error.message, code: error.code }, error.status) : errorResponse(error, request);
}
