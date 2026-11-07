import {
  chooseMatch,
  cosine,
  finiteNumber,
  MatchingError,
  parseGps,
} from "@/lib/anchor-matching";
import { db, sql } from "@/lib/db";
import { anchorPlacements } from "@/lib/placements/runtime.server";
import "server-only";
import { embedImage } from "./embedding.server";
import type { ModelTelemetry } from "./model-telemetry";
import { loadReferenceVectors, readReferenceMeta } from "./reference-cache.server";

// Shared cap for everyone recognizing in one workspace (database counter, so
// it holds across processes). Set just above what the model service can serve
// — one A10 handles ~43 requests/s ≈ 2600/min (measured 2026-10-08) — because
// hitting this cap blocks the whole workspace until the minute ends, while
// overflow at the model only gets 429 model_queue_full with a 1 s retry.
// Fairness between devices comes from the per-device limit in the route.
const PER_WORKSPACE_PER_MINUTE = 3000;

import { findNearbyAnchors } from "./nearby.server";
export { findNearbyAnchors } from "./nearby.server";
type Candidate = Awaited<ReturnType<typeof findNearbyAnchors>>[number];

export async function recognizeAnchor(
  workspaceId: string,
  form: FormData,
  image: Blob,
  requestId?: string,
) {
  const startedAt = performance.now();
  let checkpoint = startedAt;
  const timings: Record<string, number> = {};
  const mark = (stage: string) => {
    const now = performance.now();
    timings[stage] = Math.round(now - checkpoint);
    checkpoint = now;
  };
  const gps = parseGps(form);
  // Explicit calibration is required: no invented universal similarity cutoff.
  if (!process.env.SAGE_MATCH_THRESHOLD)
    throw new MatchingError("请先配置视觉匹配阈值", 503);
  const threshold = finiteNumber(
    process.env.SAGE_MATCH_THRESHOLD,
    -1,
    1,
    "SAGE_MATCH_THRESHOLD",
  );
  const margin = finiteNumber(
    process.env.SAGE_MATCH_MARGIN || "0.03",
    0,
    2,
    "SAGE_MATCH_MARGIN",
  );
  // Summary only: no candidate identities, URLs, GPS coordinates or vectors.
  const diagnostics = {
    candidate_count: 0,
    ready_reference_count: 0,
    threshold,
    required_margin: margin,
    best_similarity: null as number | null,
    second_similarity: null as number | null,
    score_gap: null as number | null,
    best_distance_meters: null as number | null,
    // reference descriptors served from the in-process cache vs. read from the DB
    reference_cache_hits: 0,
    reference_cache_misses: 0,
  };
  // Model-reported breakdown (queue / decode / inference / service total),
  // folded into timings_ms so the client logs can split model_request_ms.
  const telemetry: ModelTelemetry = { timings_ms: {} };
  const snapshot = () => ({
    ...diagnostics,
    ...(telemetry.upstream_status !== undefined ? { upstream_status: telemetry.upstream_status } : {}),
    ...(telemetry.upstream_request_id ? { upstream_request_id: telemetry.upstream_request_id } : {}),
    ...(telemetry.model_code ? { model_code: telemetry.model_code } : {}),
    ...(telemetry.model_device ? { model_device: telemetry.model_device } : {}),
    timings_ms: {
      ...timings,
      ...telemetry.timings_ms,
      matching_total_ms: Math.round(performance.now() - startedAt),
    } as Record<string, number>,
  });
  mark("validation_ms");
  let allowed: boolean;
  try {
    const { rows } = await sql<{ allowed: boolean }>`
      select public.consume_anchor_match_request(${workspaceId}::uuid, ${PER_WORKSPACE_PER_MINUTE}::integer) as allowed
    `.execute(db);
    allowed = rows[0]?.allowed === true;
  } catch {
    throw new MatchingError("匹配接口未就绪，请检查数据库迁移", 503);
  }
  mark("rate_limit_ms");
  if (!allowed)
    throw new MatchingError(
      "工作空间请求过于频繁，请稍后重试",
      429,
      "workspace_rate_limited",
      60,
    );
  let candidates: Candidate[];
  try {
    candidates = await findNearbyAnchors(workspaceId, gps);
  } catch {
    throw new MatchingError("无法查询附近匹配点", 503);
  }
  mark("gps_query_ms");
  diagnostics.candidate_count = candidates.length;
  const empty = (reason: string) => ({
    matched: false,
    reason,
    anchor: null,
    assets: [],
    gps_radius_meters: gps.radius,
    diagnostics: snapshot(),
  });
  if (!candidates.length) return empty("no_nearby_anchor");
  if (candidates.length > 200)
    throw new MatchingError("附近匹配点过多，请缩小工作空间", 422);
  // Reference metadata only (no 8448-dim vectors); vectors come from the
  // in-process cache unless an anchor's reference changed since last round.
  let references;
  let ready;
  try {
    const meta = await readReferenceMeta(candidates.map((c) => c.id));
    ready = meta.filter(
      (r) =>
        r.status === "ready" &&
        candidates.some((c) => c.id === r.anchor_id && c.file_url === r.image_url),
    );
    diagnostics.ready_reference_count = ready.length;
    // Never silently omit an unprepared competitor and accept a different nearby point.
    if (ready.length !== candidates.length) {
      mark("reference_read_ms");
      return empty("reference_not_ready");
    }
    references = await loadReferenceVectors(ready);
  } catch (error) {
    if (error instanceof MatchingError) throw error;
    throw new MatchingError("无法读取匹配特征", 503);
  }
  diagnostics.reference_cache_hits = references.hits;
  diagnostics.reference_cache_misses = references.misses;
  mark("reference_read_ms");
  if (references.changed) return empty("reference_changed");
  const query = await embedImage(image, { requestId, telemetry });
  mark("model_request_ms");
  if (ready.some((r) => r.embedding_version !== query.version))
    return empty("model_version_mismatch");
  const ranked = ready.map((row) => ({
    id: row.anchor_id,
    score: cosine(query.embedding, references.vectors.get(row.anchor_id)!),
    distance_meters: candidates.find((c) => c.id === row.anchor_id)!
      .distance_meters,
  }));
  const sorted = [...ranked].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  diagnostics.best_similarity = sorted[0]?.score ?? null;
  diagnostics.second_similarity = sorted[1]?.score ?? null;
  diagnostics.score_gap = sorted[1] ? sorted[0].score - sorted[1].score : null;
  diagnostics.best_distance_meters = sorted[0]?.distance_meters ?? null;
  const result = chooseMatch(ranked, threshold, margin);
  mark("ranking_ms");
  if (!result.match) return empty(result.reason);
  const candidate = candidates.find((c) => c.id === result.match!.id)!;
  // Detect replacement/deletion/movement while inference was in flight.
  let current: Candidate[] | null = null;
  try {
    current = await findNearbyAnchors(workspaceId, gps);
  } catch {
    current = null;
  }
  mark("candidate_recheck_ms");
  if (
    !current ||
    current.length !== candidates.length ||
    !candidates.every((old) =>
      current!.some(
        (c) =>
          c.id === old.id &&
          c.file_url === old.file_url &&
          c.distance_meters === old.distance_meters,
      ),
    )
  )
    return empty("reference_changed");
  let assets;
  try {
    assets = await anchorPlacements(workspaceId, candidate.asset_id);
  } catch {
    throw new MatchingError("无法读取挂载素材", 503);
  }
  mark("assets_read_ms");
  return {
    matched: true,
    reason: "matched",
    anchor: {
      id: candidate.asset_id,
      name: candidate.name,
      distance_meters: result.match.distance_meters,
      cosine_similarity: result.match.score,
    },
    assets,
    gps_radius_meters: gps.radius,
    embedding_version: query.version,
    diagnostics: snapshot(),
  };
}
