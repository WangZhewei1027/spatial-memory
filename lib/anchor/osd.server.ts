import "server-only";
import { MatchingError, parseGps } from "@/lib/anchor-matching";
import { clientKey, MiniappError, readJson, requireUuid } from "@/lib/miniapp/request";
import { consumeRequest } from "@/lib/miniapp/rate-limit";
import { anchorPlacements } from "@/lib/placements/runtime.server";
import { findNearbyAnchors } from "./nearby.server";

/** Public map discovery, not proof of recognition or authorization to check in. */
export async function readOSDRequest(request: Request) {
  const body = await readJson(request);
  const workspaceId = requireUuid(body.workspace_id, "workspace_id");
  if (!consumeRequest(`osd:${workspaceId}:${clientKey(request)}`, 60, 60_000).allowed ||
      !consumeRequest(`osd:${workspaceId}`, 3000, 60_000).allowed)
    throw new MiniappError("请求过于频繁，请稍后重新扫描", 429);
  const form = new FormData();
  for (const field of ["latitude", "longitude", "accuracy", "gps_timestamp", "coordinate_system"]) {
    const value = body[field];
    if (typeof value !== "string" && typeof value !== "number") throw new MiniappError(`Invalid ${field}`);
    form.set(field, String(value));
  }
  try { return { body, workspaceId, gps: parseGps(form) }; }
  catch (error) {
    if (error instanceof MatchingError) throw new MiniappError(error.message, error.status);
    throw error;
  }
}

export async function osdCandidates(context: Awaited<ReturnType<typeof readOSDRequest>>) {
  const candidates = await findNearbyAnchors(context.workspaceId, context.gps);
  if (candidates.length > 200) throw new MiniappError("附近匹配点过多，请缩小地图范围", 422);
  return { candidates: candidates.map((row) => ({
    id: row.id, name: row.name, image_url: row.file_url, image_urls: row.file_urls,
    reference_version: row.reference_version, distance_meters: row.distance_meters,
  })), gps_radius_meters: context.gps.radius };
}

export async function osdContent(context: Awaited<ReturnType<typeof readOSDRequest>>) {
  const anchorId = requireUuid(context.body.anchor_id, "anchor_id");
  const version = context.body.reference_version;
  if (typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version))
    throw new MiniappError("Invalid reference_version");
  const candidates = await findNearbyAnchors(context.workspaceId, context.gps);
  const anchor = candidates.find((row) => row.id === anchorId);
  if (!anchor) throw new MiniappError("目标已移除或不在附近，请重新扫描", 404);
  if (anchor.reference_version !== version) throw new MiniappError("参考图已更新，请重新扫描", 409);
  const assets = await anchorPlacements(context.workspaceId, anchor.asset_id);
  return { anchor: { id: anchor.id, name: anchor.name }, assets };
}
