import { asFileType } from "@/lib/assets/dto.server";
import { createAssetForCollection } from "@/lib/assets/service.server";
import {
  loadWorkspaceAccess,
  lockWorkspaceForWrite,
  requireOrgRead,
  requireWorkspaceEdit,
  requireWorkspaceRead,
  type Actor,
  type WorkspaceAccess,
} from "@/lib/content-model/access.server";
import type {
  AssetPayload,
  CreatePlacementResult,
  GeoPointInput,
  PlacementContentDto,
  PlacementDto,
  PlacementStatus,
  SceneDocumentJson,
} from "@/lib/content-model/contracts";
import { checkLockVersion, invalid, notFound } from "@/lib/content-model/errors";
import {
  isRecord,
  optionalIdempotencyKey,
  rejectUnknown,
  requireInt,
  requireNumber,
  requireUuid,
  type JsonRecord,
} from "@/lib/content-model/input";
import { parseRenderConfig } from "@/lib/content-model/payload";
import {
  audit,
  claimIdempotency,
  contentTransaction,
  recordIdempotency,
  requestHash,
  type Executor,
  type Trx,
} from "@/lib/content-model/tx.server";
import { db, sql } from "@/lib/db";
import "server-only";
import { resolvePlacementContent, type StaticPlacementTarget } from "./content.server";
import {
  assertAnchorUsable,
  assertDiscoverable,
  assertPlacementWritable,
  buildPlacementDtos,
  insertPlacementTx,
  loadPlacementRows,
  lockPlacement,
  parseGeoPoint,
  parsePlacementFields,
  parseStatus,
  parseTarget,
  placementQuery,
  pointSql,
  renderConfigOf,
  replaceTags,
  resolveTargetForWrite,
  type PlacementRow,
  type ResolvedTarget,
} from "./core.server";

// ───────────────────────── queries ─────────────────────────

/** Placements owned by this collection. */
export async function listWorkspacePlacements(
  actor: Actor,
  workspaceId: string,
  opts: { status?: PlacementStatus } = {},
): Promise<PlacementDto[]> {
  await requireWorkspaceRead(db, actor, workspaceId);
  let query = placementQuery(db).where("p.workspace_id", "=", workspaceId);
  if (opts.status) query = query.where("p.status", "=", opts.status);
  const rows = await query.orderBy("p.updated_at", "desc").execute();
  return buildPlacementDtos(db, actor, rows);
}

/** Team map: placements of every collection of the organization (each listed once). */
export async function listOrganizationPlacements(actor: Actor, organizationId: string, opts: { status?: PlacementStatus } = {}): Promise<PlacementDto[]> {
  await requireOrgRead(db, actor, organizationId);
  let query = placementQuery(db).where("p.organization_id", "=", organizationId);
  if (opts.status) query = query.where("p.status", "=", opts.status);
  const rows = await query.orderBy("p.updated_at", "desc").execute();
  return buildPlacementDtos(db, actor, rows);
}

async function requirePlacementRead(actor: Actor, placementId: string, viewerWorkspaceId?: string): Promise<PlacementRow> {
  const [row] = await loadPlacementRows(db, [placementId]);
  if (!row) throw notFound("投放不存在");
  const own = await loadWorkspaceAccess(db, actor, row.workspace_id);
  if (!own?.canRead) throw notFound("投放不存在");
  if (viewerWorkspaceId && viewerWorkspaceId !== row.workspace_id) {
    throw notFound("投放不存在");
  }
  return row;
}

export async function getPlacement(actor: Actor, placementId: string, viewerWorkspaceId?: string): Promise<PlacementDto> {
  const row = await requirePlacementRead(actor, placementId, viewerWorkspaceId);
  return (await buildPlacementDtos(db, actor, [row]))[0];
}

/**
 * GET /api/placements/[id]/content: the current playable content, through
 * the resolvePlacementContent boundary. No history, no current-version hints,
 * no grant and no catalog access are derived from it.
 */
export async function getPlacementContent(actor: Actor, placementId: string, viewerWorkspaceId?: string): Promise<PlacementContentDto> {
  const row = await requirePlacementRead(actor, placementId, viewerWorkspaceId);
  const publicId = row.id;
  const target: StaticPlacementTarget = row.asset_id
    ? { kind: "asset", assetId: row.asset_id }
    : { kind: "scene", sceneId: row.scene_id ?? "" };
  const content = await resolvePlacementContent(db, target);
  if (!content) throw notFound("投放内容不存在");
  if (content.kind === "asset") {
    const payload = content.asset.payload;
    return {
      kind: "asset",
      placement_id: row.id,
      public_id: publicId,
      asset_id: content.asset.id,
      asset_lock_version: content.asset.lock_version,
      file_type: content.fileType,
      payload: payload as AssetPayload,
      resources: content.asset.resources,
    };
  }
  const scene = await db.selectFrom("scene").select("name").where("id", "=", content.sceneId).executeTakeFirstOrThrow();
  return {
    kind: "scene",
    placement_id: row.id,
    public_id: publicId,
    scene_id: content.sceneId,
    name: scene.name,
    document: content.document as unknown as SceneDocumentJson,
    resources: content.resources.map((r) => ({
      resource_alias: r.resource_alias,
      asset_id: r.asset_id,
      file_type: r.file_type,
      url: r.url,
      thumbnail_url: r.thumbnail_url ?? null,
      animations: r.animations,
    })),
  };
}

// ───────────────────────── commands ─────────────────────────

async function dto(actor: Actor, id: string): Promise<PlacementDto> {
  const rows = await loadPlacementRows(db, [id]);
  if (!rows.length) throw notFound("投放不存在");
  return (await buildPlacementDtos(db, actor, rows))[0];
}

/**
 * POST /api/collections/[id]/placements. Either a fixed target (any same-team
 * Asset or Scene), or the upload-and-place form (`asset` +
 * `idempotencyKey`) that creates the team Asset, v1 and the placement in one
 * transaction.
 */
export async function createPlacement(actor: Actor, workspaceId: string, body: JsonRecord): Promise<CreatePlacementResult> {
  if (body.asset !== undefined) {
    rejectUnknown(body, ["asset", "idempotencyKey", "name", "location", "anchorId", "renderConfig", "status", "tagIds"]);
    if (!isRecord(body.asset)) throw invalid("asset 必须是对象");
    const { asset, idempotencyKey, ...placement } = body;
    const result = await createAssetForCollection(actor, workspaceId, { ...asset, idempotencyKey, placement });
    if (!result.placement) throw invalid("投放未创建");
    return { placement: result.placement, asset: result.asset, created: result.created };
  }
  rejectUnknown(body, ["target", "idempotencyKey", "name", "location", "anchorId", "renderConfig", "status", "tagIds"]);
  const target = parseTarget(body.target);
  const fields = parsePlacementFields(body);
  const key = optionalIdempotencyKey(body.idempotencyKey);
  const workspace = await requireWorkspaceEdit(db, actor, workspaceId);
  const outcome = await contentTransaction(async (trx) => {
    await lockWorkspaceForWrite(trx, workspace);
    const scope = key ? { actorId: actor.userId, command: "placement.create", key, hash: requestHash({ workspaceId, ...body, idempotencyKey: undefined }) } : null;
    if (scope) {
      const previous = await claimIdempotency(trx, scope);
      if (previous) return { id: previous, created: false };
    }
    const resolved = await resolveTargetForWrite(trx, actor, workspace, target);
    const id = await insertPlacementTx(trx, actor, workspace, resolved, fields);
    if (scope) await recordIdempotency(trx, scope, workspace.workspace.organization_id, "placement", id);
    await audit(trx, {
      organizationId: workspace.workspace.organization_id,
      actorId: actor.userId,
      action: "placement.create",
      objectType: "placement",
      objectId: id,
      workspaceId,
      details: { target },
    });
    return { id, created: true };
  });
  return { placement: await dto(actor, outcome.id), asset: null, created: outcome.created };
}

/** Current target of a placement, as resolveTargetForWrite would describe it. */
async function describeTarget(exec: Executor, row: PlacementRow): Promise<ResolvedTarget> {
  if (row.asset_id) {
    const asset = await exec.selectFrom("asset").select("file_type").where("id", "=", row.asset_id ?? "").executeTakeFirst();
    return {
      kind: "asset",
      assetId: row.asset_id,
      fileType: asFileType(asset?.file_type ?? "document"),
      sceneId: null,
      sceneWorkspaceId: null,
      instanceCount: 1,
    };
  }
  const scene = await exec.selectFrom("scene").select(["document", "workspace_id"])
    .where("id", "=", row.scene_id ?? "").executeTakeFirst();
  const content = isRecord(scene?.document) && isRecord(scene.document.content) ? scene.document.content : null;
  return { kind: "scene", assetId: null, sceneId: row.scene_id, fileType: "scene",
    sceneWorkspaceId: scene?.workspace_id ?? null, instanceCount: Array.isArray(content?.instances) ? content.instances.length : 0 };

}

/** Owning collection of a placement (immutable), read before any lock is taken. */
async function placementWorkspace(exec: Executor, placementId: string): Promise<string> {
  const row = await exec.selectFrom("placement").select("workspace_id").where("id", "=", placementId).executeTakeFirst();
  if (!row) throw notFound("投放不存在");
  return row.workspace_id;
}

async function writableWorkspace(trx: Trx, actor: Actor, workspaceId: string, cache: Map<string, WorkspaceAccess>): Promise<WorkspaceAccess> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;
  const access = await loadWorkspaceAccess(trx, actor, workspaceId);
  assertPlacementWritable(access);
  await lockWorkspaceForWrite(trx, access);
  cache.set(workspaceId, access);
  return access;
}

/**
 * PATCH /api/placements/[id]: location / anchor / render config / status /
 * tags, and upgrade or rollback to another retained version of the same asset
 * or revision of the same scene. Edited in its owning collection (open) by a
 * team writer.
 */
export async function updatePlacement(actor: Actor, placementId: string, body: JsonRecord): Promise<PlacementDto> {
  rejectUnknown(body, ["expectedLockVersion", "name", "location", "anchorId", "renderConfig", "status", "target", "tagIds"]);
  const expected = body.expectedLockVersion === undefined ? undefined : requireInt(body.expectedLockVersion, "expectedLockVersion", 0);
  const fields = parsePlacementFields(body);
  const target = body.target === undefined ? undefined : parseTarget(body.target);
  await contentTransaction(async (trx) => {
    // Lock order everywhere: organization → collection → row.
    const owner = await placementWorkspace(trx, placementId);
    const access = await writableWorkspace(trx, actor, owner, new Map());
    const row = await lockPlacement(trx, placementId);
    checkLockVersion(expected, row.lock_version, "投放");
    let resolved = await describeTarget(trx, row);
    const changes: Record<string, unknown> = {};
    if (target) {
      const next = await resolveTargetForWrite(trx, actor, access, target, {
        currentTarget: { assetId: row.asset_id, sceneId: row.scene_id },
      });
      if (next.kind !== resolved.kind || (next.kind === "asset" ? next.assetId !== resolved.assetId : next.sceneId !== resolved.sceneId))
        throw invalid("只能切换同一场景的发布记录；不同素材请新建投放");
      if (next.assetId !== row.asset_id || next.sceneId !== row.scene_id) {
        changes.asset_id = next.assetId;
        changes.scene_id = next.sceneId;
      }
      resolved = next;
    }
    const status = fields.status ?? (row.status as PlacementStatus);
    const location: GeoPointInput | null =
      fields.location !== undefined ? fields.location : row.longitude !== null && row.latitude !== null ? { longitude: row.longitude, latitude: row.latitude, altitude: row.altitude } : null;
    const anchorId = fields.anchorId !== undefined ? fields.anchorId : row.anchor_id;
    assertDiscoverable(status, location, anchorId, resolved);
    if (fields.anchorId) await assertAnchorUsable(trx, fields.anchorId, access);
    if (fields.name !== undefined) changes.name = fields.name;
    if (fields.location !== undefined) {
      changes.location = fields.location ? pointSql(fields.location) : null;
      changes.altitude = fields.location?.altitude ?? null;
    }
    if (fields.anchorId !== undefined) changes.anchor_id = fields.anchorId;
    if (fields.renderConfig !== undefined) changes.render_config = JSON.stringify(parseRenderConfig(fields.renderConfig, resolved.fileType));
    else if (resolved.fileType !== "model" && renderConfigOf(row.render_config).is_huge) changes.render_config = JSON.stringify({ ...renderConfigOf(row.render_config), is_huge: false });
    if (fields.status !== undefined && fields.status !== row.status) changes.status = fields.status;
    if (fields.tagIds !== undefined) await replaceTags(trx, row.id, row.workspace_id, fields.tagIds);
    if (!Object.keys(changes).length && fields.tagIds === undefined) return;
    await trx
      .updateTable("placement")
      .set((eb) => ({ ...changes, lock_version: eb("lock_version", "+", 1), updated_by: actor.userId, updated_at: sql<Date>`now()` }))
      .where("id", "=", placementId)
      .execute();
    const action = "asset_id" in changes ? "placement.retarget" : "status" in changes ? `placement.status.${String(changes.status)}` : "placement.update";
    await audit(trx, {
      organizationId: row.organization_id,
      actorId: actor.userId,
      action,
      objectType: "placement",
      objectId: placementId,
      workspaceId: row.workspace_id,
      details: {
        fields: [...Object.keys(changes), ...(fields.tagIds !== undefined ? ["tag_ids"] : [])],
        from: { asset_id: row.asset_id, scene_id: row.scene_id, status: row.status },
      },
    });
  });
  return dto(actor, placementId);
}

/** DELETE /api/placements/[id]: archive (never deletes the asset or the revision). */
export async function archivePlacement(actor: Actor, placementId: string, expectedLockVersion: number | undefined): Promise<PlacementDto> {
  return updatePlacement(actor, placementId, { expectedLockVersion, status: "archived" });
}

/** POST /api/placements/move: all-or-nothing batch, each item lock-checked in its own collection. */
export async function movePlacements(actor: Actor, body: JsonRecord): Promise<PlacementDto[]> {
  if (!Array.isArray(body.moves) || body.moves.length === 0 || body.moves.length > 200) throw invalid("moves 必须是 1–200 项的数组");
  const moves = body.moves.map((raw, i) => {
    if (!isRecord(raw)) throw invalid(`moves[${i}] 必须是对象`);
    rejectUnknown(raw, ["placementId", "expectedLockVersion", "longitude", "latitude", "altitude"], `moves[${i}] `);
    return {
      placementId: requireUuid(raw.placementId, `moves[${i}].placementId`),
      expected: raw.expectedLockVersion === undefined ? undefined : requireInt(raw.expectedLockVersion, `moves[${i}].expectedLockVersion`, 0),
      point: {
        longitude: requireNumber(raw.longitude, `moves[${i}].longitude`, -180, 180),
        latitude: requireNumber(raw.latitude, `moves[${i}].latitude`, -90, 90),
        altitude: raw.altitude === undefined || raw.altitude === null ? null : requireNumber(raw.altitude, `moves[${i}].altitude`, -1e5, 1e5),
      },
    };
  });
  if (new Set(moves.map((m) => m.placementId)).size !== moves.length) throw invalid("moves 中的投放重复");
  await contentTransaction(async (trx) => {
    const cache = new Map<string, WorkspaceAccess>();
    const owners = new Map<string, string>();
    for (const move of moves) owners.set(move.placementId, await placementWorkspace(trx, move.placementId));
    for (const workspaceId of [...new Set(owners.values())].sort()) await writableWorkspace(trx, actor, workspaceId, cache);
    for (const move of [...moves].sort((a, b) => a.placementId.localeCompare(b.placementId))) {
      const row = await lockPlacement(trx, move.placementId);
      checkLockVersion(move.expected, row.lock_version, "投放");
      await trx
        .updateTable("placement")
        .set((eb) => ({ location: pointSql(move.point), altitude: move.point.altitude, lock_version: eb("lock_version", "+", 1), updated_by: actor.userId, updated_at: sql<Date>`now()` }))
        .where("id", "=", row.id)
        .execute();
      await audit(trx, {
        organizationId: row.organization_id,
        actorId: actor.userId,
        action: "placement.move",
        objectType: "placement",
        objectId: row.id,
        workspaceId: row.workspace_id,
        details: { from: { longitude: row.longitude, latitude: row.latitude, altitude: row.altitude }, to: move.point },
      });
    }
  });
  const rows = await loadPlacementRows(db, moves.map((m) => m.placementId));
  return buildPlacementDtos(db, actor, rows);
}

function offsetPoint(point: GeoPointInput, meters: number): GeoPointInput {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((point.latitude * Math.PI) / 180) || 111320);
  return { longitude: point.longitude + dLng, latitude: point.latitude + dLat, altitude: point.altitude ?? null };
}

/**
 * POST /api/placements/[id]/copy: an independent placement with its own id
 * and public id, referencing the same content, in any open collection of the
 * same team (still subject to archive rules). Tags are copied only inside the
 * same collection; anchors only where the anchor is registered.
 */
export async function copyPlacement(actor: Actor, placementId: string, body: JsonRecord): Promise<CreatePlacementResult> {
  rejectUnknown(body, ["targetWorkspaceId", "offsetMeters", "location", "name", "idempotencyKey"]);
  const [source] = await loadPlacementRows(db, [placementId]);
  if (!source) throw notFound("投放不存在");
  const targetId = body.targetWorkspaceId === undefined ? source.workspace_id : requireUuid(body.targetWorkspaceId, "targetWorkspaceId");
  const offset = body.offsetMeters === undefined ? 4 : requireNumber(body.offsetMeters, "offsetMeters", 0, 10_000);
  const explicitLocation = body.location === undefined ? undefined : parseGeoPoint(body.location);
  const name = body.name === undefined ? (source.name ? `${source.name} 副本` : null) : parsePlacementFields({ name: body.name }).name ?? null;
  const key = optionalIdempotencyKey(body.idempotencyKey);
  const target = await requireWorkspaceEdit(db, actor, targetId);
  const sourceAccess = await loadWorkspaceAccess(db, actor, source.workspace_id);
  if (!sourceAccess?.canRead) throw notFound("投放不存在");
  if (target.workspace.organization_id !== source.organization_id) throw invalid("只能复制到同一组织的合集");
  const outcome = await contentTransaction(async (trx) => {
    await lockWorkspaceForWrite(trx, target);
    const scope = key ? { actorId: actor.userId, command: "placement.copy", key, hash: requestHash({ placementId, ...body, idempotencyKey: undefined }) } : null;
    if (scope) {
      const previous = await claimIdempotency(trx, scope);
      if (previous) return { id: previous, created: false };
    }
    const row = await lockPlacement(trx, placementId);
    const resolved = await resolveTargetForWrite(
      trx,
      actor,
      target,
      row.asset_id ? { kind: "asset", assetId: row.asset_id } : { kind: "scene", sceneId: row.scene_id ?? "" },
    );
    const sourcePoint = row.longitude !== null && row.latitude !== null ? { longitude: row.longitude, latitude: row.latitude, altitude: row.altitude } : null;
    const location = explicitLocation !== undefined ? explicitLocation : sourcePoint ? offsetPoint(sourcePoint, offset) : null;
    const anchorId = row.anchor_id && (target.workspace.id === row.workspace_id || (await anchorInScope(trx, row.anchor_id, target))) ? row.anchor_id : null;
    const status: PlacementStatus = row.status === "archived" ? "draft" : (row.status as PlacementStatus);
    const discoverable =
      status !== "active" ||
      ((!!location || !!anchorId) && !(resolved.kind === "scene" && resolved.instanceCount === 0));
    const id = await insertPlacementTx(trx, actor, target, resolved, {
      name,
      location,
      anchorId,
      storedRenderConfig: renderConfigOf(row.render_config),
      status: discoverable ? status : "draft",
    });
    if (target.workspace.id === row.workspace_id) {
      const tags = await trx.selectFrom("placement_tag").select("tag_id").where("placement_id", "=", row.id).execute();
      if (tags.length) await replaceTags(trx, id, target.workspace.id, tags.map((t) => t.tag_id));
    }
    if (scope) await recordIdempotency(trx, scope, target.workspace.organization_id, "placement", id);
    await audit(trx, {
      organizationId: target.workspace.organization_id,
      actorId: actor.userId,
      action: "placement.copy",
      objectType: "placement",
      objectId: id,
      workspaceId: target.workspace.id,
      details: { source_placement_id: row.id },
    });
    return { id, created: true };
  });
  return { placement: await dto(actor, outcome.id), asset: null, created: outcome.created };
}

async function anchorInScope(exec: Executor, anchorId: string, target: WorkspaceAccess): Promise<boolean> {
  try {
    await assertAnchorUsable(exec, anchorId, target);
    return true;
  } catch {
    return false;
  }
}

export function parseArchiveLock(params: URLSearchParams): number | undefined {
  const raw = params.get("expectedLockVersion");
  if (raw === null) return undefined;
  const value = Number(raw);
  return requireInt(value, "expectedLockVersion", 0);
}

export { parseStatus };
