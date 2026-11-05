import "server-only";
import type { Actor } from "./access.server";
import type { CollectionState, LibraryListQuery } from "./contracts";
import { handleActorRoute, ok } from "./http.server";
import { queryInt, requireEnum, requireUuid } from "./input";

/** Pickers request the full list. Libraries opt into pages with limit/offset. */
export function teamLibraryResponse<T>(
  request: Request,
  organizationId: string,
  resource: "collections" | "activities" | "scenes",
  defaultState: CollectionState,
  list: (actor: Actor, organizationId: string, query: LibraryListQuery) => Promise<T[]>,
) {
  return handleActorRoute(request, `/api/organizations/${organizationId}/${resource}`, async (actor) => {
    const id = requireUuid(organizationId, "organization id");
    const params = new URL(request.url).searchParams;
    const state = requireEnum(params.get("state") || defaultState, "state", ["active", "archived", "all"] as const);
    const q = params.get("q") || undefined;
    if (!params.has("limit") && !params.has("offset")) return list(actor, id, { state, q });

    const limit = queryInt(params, "limit", 30, 1, 200);
    const offset = queryInt(params, "offset", 0, 0, 1000000);
    const rows = await list(actor, id, { state, q, limit: limit + 1, offset });
    return ok(rows.slice(0, limit), 200, { page: { limit, offset, hasMore: rows.length > limit } });
  });
}
