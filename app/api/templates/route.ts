import { failure, ok } from "@/lib/content-model/http.server";
import { optionalEnum, optionalString, queryInt } from "@/lib/content-model/input";
import { TEMPLATE_TYPES } from "@/lib/content-model/template-contracts";
import { listTemplates } from "@/lib/content-model/templates.server";

export async function GET(request: Request) {
  // Read the request outside the error mapper so Next can defer this route to request time.
  const params = new URL(request.url).searchParams;
  try {
    const type = optionalEnum(params.get("type") ?? undefined, "type", TEMPLATE_TYPES);
    const q = optionalString(params.get("q"), "q") ?? undefined;
    const limit = queryInt(params, "limit", 30, 1, 200);
    const offset = queryInt(params, "offset", 0, 0, 1000000);
    const rows = await listTemplates({ type, q, limit: limit + 1, offset });
    return ok(rows.slice(0, limit), 200, { page: { limit, offset, hasMore: rows.length > limit } });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/templates" });
  }
}
