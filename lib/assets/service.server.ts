import {
  ensureAssetUse,
  loadWorkspaceAccess,
  lockOrgForWrite,
  lockWorkspaceForWrite,
  requireAssetMaintain,
  requireAssetRead,
  requireOrgRead,
  requireOrgWrite,
  requireWorkspaceEdit,
  requireWorkspaceRead,
  type Actor,
  type OrgAccess,
  type WorkspaceAccess
} from "@/lib/content-model/access.server";
import {
  ASSET_FILE_TYPES,
  SPECIAL_ASSET_FILE_TYPES,
  type ApiPage,
  type ArchiveAssetResult,
  type AssetDetailDto,
  type AssetDto,
  type AssetListQuery,
  type AssetOrigin,
  type AssetUsageDto,
  type AssetVisibility,
  type CreateAssetResult,
  type PlacementDto,
  type ResourceRole,
} from "@/lib/content-model/contracts";
import { archived, checkLockVersion, forbidden, invalid, notFound } from "@/lib/content-model/errors";
import {
  isRecord,
  nameContainsPattern,
  optionalEnum,
  optionalInt,
  rejectUnknown,
  requireEnum,
  requireIdempotencyKey,
  requireString,
  requireUuid,
  type JsonRecord,
} from "@/lib/content-model/input";
import { parseAssetPayload, parseFileType, parseResourceInputs } from "@/lib/content-model/payload";
import {
  audit,
  claimIdempotency,
  contentTransaction,
  recordIdempotency,
  requestHash,
  type Trx,
} from "@/lib/content-model/tx.server";
import { db, sql } from "@/lib/db";
import {
  buildPlacementDtos,
  insertPlacementTx,
  loadPlacementRows,
  parsePlacementFields,
  resolveTargetForWrite,
  type PlacementFields,
} from "@/lib/placements/core.server";
import "server-only";
import { ASSET_FULL_COLUMNS, buildAssetDtos, loadAssetDto, loadAssetContents } from "./dto.server";
import { computeImpact } from "./usage.server";
import { writeAssetContent } from "./content.server";
import { releaseObjectsIfUnreferenced } from "@/lib/storage/retention.server";

const VISIBILITIES: readonly AssetVisibility[] = ["restricted", "organization"];
const ORIGINS: readonly AssetOrigin[] = ["team_upload", "public_submission", "legacy"];
/** Team assets are visible to the whole team; the field is descriptive only. */
const DEFAULT_VISIBILITY: AssetVisibility = "organization";

// ───────────────────────── catalogs ─────────────────────────

export function parseAssetListQuery(params: URLSearchParams): AssetListQuery {
  const get = (name: string) => params.get(name) ?? undefined;
  const limit = get("limit");
  const offset = get("offset");
  const state = get("state");
  return {
    view: optionalEnum(get("view"), "view", ["shared", "maintained", "all"] as const),
    q: get("q")?.slice(0, 100) || undefined,
    file_type: optionalEnum(get("file_type"), "file_type", ASSET_FILE_TYPES),
    origin: optionalEnum(get("origin"), "origin", ORIGINS),
    state: state === undefined ? undefined : requireEnum(state, "state", ["active", "archived", "all"] as const),
    usable_in: get("usable_in") ? requireUuid(get("usable_in"), "usable_in") : undefined,
    limit: limit === undefined ? undefined : optionalInt(Number(limit), "limit", 1, 200),
    offset: offset === undefined ? undefined : optionalInt(Number(offset), "offset", 0, 1_000_000),
  };
}

/**
 * The team catalog. `shared` / `maintained` are plain metadata filters
 * (visibility "organization" / maintained by me), never an access rule.
 */
async function queryCatalog(actor: Actor, org: OrgAccess, query: AssetListQuery, usableIn?: WorkspaceAccess): Promise<ApiPage<AssetDto>> {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const view = query.view ?? "all";
  let base = db.selectFrom("asset").where("asset.organization_id", "=", org.org.id);
  if (view === "shared") base = base.where("asset.visibility", "=", "organization");
  if (view === "maintained") base = base.where("asset.maintained_by", "=", actor.userId);
  if (query.file_type) base = base.where("asset.file_type", "=", query.file_type);
  else base = base.where("asset.file_type", "not in", [...SPECIAL_ASSET_FILE_TYPES]);
  if (query.origin) base = base.where("asset.origin", "=", query.origin);
  const state = query.state ?? "active";
  if (state !== "all") base = base.where("asset.state", "=", state);
  if (query.q) base = base.where("asset.name", "ilike", nameContainsPattern(query.q));

  const [{ total }, rows] = await Promise.all([
    base.select(({ fn }) => fn.countAll<number>().as("total")).executeTakeFirstOrThrow(),
    base.select(ASSET_FULL_COLUMNS).orderBy("asset.updated_at", "desc").orderBy("asset.id").limit(limit).offset(offset).execute(),
  ]);
  const typed = rows.flatMap((row) => (row.organization_id ? [{ ...row, organization_id: row.organization_id }] : []));
  const data = await buildAssetDtos(db, actor, typed, { usableIn, orgAccess: org });
  return { data, page: { limit, offset, total: Number(total) } };
}

/** Collection catalog: the whole team catalog, with use flags for that collection (no grants). */
export async function listWorkspaceAssets(actor: Actor, workspaceId: string, query: AssetListQuery): Promise<ApiPage<AssetDto>> {
  const access = await requireWorkspaceRead(db, actor, workspaceId);
  return queryCatalog(actor, access, query, access);
}

/** Team catalog: every same-team asset for every member (view/usable_in are optional filters/flags). */
export async function listOrganizationAssets(actor: Actor, organizationId: string, query: AssetListQuery): Promise<ApiPage<AssetDto>> {
  const org = await requireOrgRead(db, actor, organizationId);
  let usableIn: WorkspaceAccess | undefined;
  if (query.usable_in) {
    usableIn = (await loadWorkspaceAccess(db, actor, query.usable_in)) ?? undefined;
    if (!usableIn?.canRead || usableIn.workspace.organization_id !== organizationId) throw notFound("合集不存在");
  }
  return queryCatalog(actor, org, query, usableIn);
}

export async function getAssetDetail(actor: Actor, assetId: string): Promise<AssetDetailDto> {
  await requireAssetRead(db, actor, assetId);
  const asset = await loadAssetDto(db, actor, assetId);
  if (!asset) throw notFound("素材不存在");
  return asset;
}

// ───────────────────────── create ─────────────────────────

export interface ParsedCreateAsset {
  name: string;
  fileType: ReturnType<typeof parseFileType>;
  payload: ReturnType<typeof parseAssetPayload>;
  resources: ReturnType<typeof parseResourceInputs>;
  visibility: AssetVisibility;
  idempotencyKey?: string;
  placement?: PlacementFields;
}

export function parseCreateAsset(body: JsonRecord, opts: { requireKey: boolean; allowPlacement: boolean }): ParsedCreateAsset {
  rejectUnknown(body, ["name", "fileType", "payload", "resources", "visibility", ...(opts.requireKey ? ["idempotencyKey"] : []), ...(opts.allowPlacement ? ["placement"] : [])]);
  const fileType = parseFileType(body.fileType);
  const placement = body.placement === undefined ? undefined : parsePlacementFields(isRecord(body.placement) ? body.placement : (() => { throw invalid("placement 必须是对象"); })());
  return {
    name: requireString(body.name, "name", { max: 200 }),
    fileType,
    payload: parseAssetPayload(fileType, body.payload),
    resources: parseResourceInputs(fileType, body.resources),
    visibility: body.visibility === undefined ? DEFAULT_VISIBILITY : requireEnum(body.visibility, "visibility", VISIBILITIES),
    idempotencyKey: opts.requireKey ? requireIdempotencyKey(body.idempotencyKey) : undefined,
    placement,
  };
}

/** Where a new team asset is created: always an organization; a collection only as origin / placement target. */
export interface AssetCreateTarget {
  org: OrgAccess;
  workspace?: WorkspaceAccess;
}

/** Asset identity + v1 (+ optional placement in the origin collection) inside an open transaction. */
export async function createAssetTx(
  trx: Trx,
  actor: Actor,
  target: AssetCreateTarget,
  input: ParsedCreateAsset,
  opts: { origin?: AssetOrigin; maintainedBy?: string | null; createdBy?: string | null } = {},
): Promise<{ assetId: string; placementId: string | null }> {
  const createdBy = opts.createdBy === undefined ? actor.userId : opts.createdBy;
  const organizationId = target.org.org.id;
  const workspace = target.workspace;
  if (input.placement && !workspace) throw invalid("放置素材需要指定合集");
  const asset = await trx
    .insertInto("asset")
    .values({
      organization_id: organizationId,
      origin_workspace_id: workspace?.workspace.id ?? null,
      // Responsible person (metadata); editing is open to every team writer.
      maintained_by: opts.maintainedBy === undefined ? actor.userId : opts.maintainedBy,
      visibility: input.visibility,
      state: "active",
      origin: opts.origin ?? "team_upload",
      file_type: input.fileType,
      name: input.name,
      payload: JSON.stringify(input.payload),
      created_by: createdBy,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  await writeAssetContent(trx, actor, { id: asset.id, organization_id: organizationId }, input.payload, input.resources, {
    access: target.org,
  });
  let placementId: string | null = null;
  if (input.placement && workspace) {
    const resolved = await resolveTargetForWrite(trx, actor, workspace, { kind: "asset", assetId: asset.id });
    placementId = await insertPlacementTx(trx, actor, workspace, resolved, { ...input.placement, name: input.placement.name ?? input.name });
  }
  await audit(trx, {
    organizationId,
    actorId: actor.userId,
    action: "asset.create",
    objectType: "asset",
    objectId: asset.id,
    workspaceId: workspace?.workspace.id ?? null,
    details: { placement_id: placementId, origin: opts.origin ?? "team_upload" },
  });
  return { assetId: asset.id, placementId };
}

async function createResult(actor: Actor, assetId: string, placementId: string | null, created: boolean): Promise<CreateAssetResult> {
  const [asset, placementRows] = await Promise.all([
    loadAssetDto(db, actor, assetId),
    placementId ? loadPlacementRows(db, [placementId]) : Promise.resolve([]),
  ]);
  if (!asset) throw notFound("素材不存在");
  const placement: PlacementDto | null = placementRows.length ? (await buildPlacementDtos(db, actor, placementRows))[0] : null;
  return { asset, placement, created };
}

/** First result of an earlier create command with the same idempotency key. */
async function replayCreate(trx: Trx, assetId: string, withPlacement: boolean) {
  const asset = await trx.selectFrom("asset").select("id").where("id", "=", assetId).executeTakeFirstOrThrow();

  const placement = withPlacement
    ? await trx.selectFrom("placement").select("id").where("asset_id", "=", assetId).orderBy("created_at").limit(1).executeTakeFirst()
    : undefined;
  return { assetId: asset.id, placementId: placement?.id ?? null, created: false };
}

/**
 * POST /api/collections/[id]/assets: a team asset whose origin is this
 * collection, optionally placed there. Replays with the same key return the first result.
 */
export async function createAssetForCollection(actor: Actor, workspaceId: string, body: JsonRecord): Promise<CreateAssetResult> {
  const input = parseCreateAsset(body, { requireKey: true, allowPlacement: true });
  const workspace = await requireWorkspaceEdit(db, actor, workspaceId);
  const scope = { actorId: actor.userId, command: "asset.create", key: input.idempotencyKey!, hash: requestHash({ workspaceId, ...body }) };
  const outcome = await contentTransaction(async (trx) => {
    await lockWorkspaceForWrite(trx, workspace);
    const previous = await claimIdempotency(trx, scope);
    if (previous) return replayCreate(trx, previous, !!input.placement);
    const created = await createAssetTx(trx, actor, { org: workspace, workspace }, input);
    await recordIdempotency(trx, scope, workspace.workspace.organization_id, "asset", created.assetId);
    return { ...created, created: true };
  });
  return createResult(actor, outcome.assetId, outcome.placementId, outcome.created);
}

/** POST /api/organizations/[id]/assets: a team asset without any collection (no placement). */
export async function createAssetInOrganization(actor: Actor, organizationId: string, body: JsonRecord): Promise<CreateAssetResult> {
  const input = parseCreateAsset(body, { requireKey: true, allowPlacement: false });
  const org = await requireOrgWrite(db, actor, organizationId);
  const scope = { actorId: actor.userId, command: "asset.create", key: input.idempotencyKey!, hash: requestHash({ organizationId, ...body }) };
  const outcome = await contentTransaction(async (trx) => {
    await lockOrgForWrite(trx, organizationId);
    const previous = await claimIdempotency(trx, scope);
    if (previous) return replayCreate(trx, previous, false);
    const created = await createAssetTx(trx, actor, { org }, input);
    await recordIdempotency(trx, scope, organizationId, "asset", created.assetId);
    return { ...created, created: true };
  });
  return createResult(actor, outcome.assetId, outcome.placementId, outcome.created);
}

// ───────────────────────── identity maintenance ─────────────────────────

/** PATCH /api/assets/[id]: name / visibility / restore by any team writer; maintainer by owner/admin. */
export async function updateAsset(actor: Actor, assetId: string, body: JsonRecord): Promise<AssetDto> {
  rejectUnknown(body, ["expectedLockVersion", "name", "visibility", "state", "maintainedBy", "payload", "resources"]);
  const expected = body.expectedLockVersion === undefined ? undefined : optionalInt(body.expectedLockVersion, "expectedLockVersion", 0);
  const name = body.name === undefined ? undefined : requireString(body.name, "name", { max: 200 });
  const visibility = body.visibility === undefined ? undefined : requireEnum(body.visibility, "visibility", VISIBILITIES);
  const state = body.state === undefined ? undefined : requireEnum(body.state, "state", ["active"] as const);
  const maintainedBy = body.maintainedBy === undefined ? undefined : body.maintainedBy === null ? null : requireUuid(body.maintainedBy, "maintainedBy");
  const pre = await requireAssetMaintain(db, actor, assetId);
  const hasContent = body.payload !== undefined || body.resources !== undefined;
  const payload = hasContent ? parseAssetPayload(parseFileType(pre.asset.file_type), body.payload) : null;
  const resources = hasContent ? parseResourceInputs(parseFileType(pre.asset.file_type), body.resources) : [];
  let retiredKeys: string[] = [];
  await contentTransaction(async (trx) => {
    await lockOrgForWrite(trx, pre.asset.organization_id);
    // Order all participating asset locks to prevent cross-asset reuse deadlocks.
    const lockIds = [...new Set([assetId, ...resources.flatMap((r) => "fromAssetId" in r ? [r.fromAssetId] : [])])].sort();
    await trx.selectFrom("asset").select("id").where("id", "in", lockIds).orderBy("id").forUpdate().execute();
    const access = await requireAssetMaintain(trx, actor, assetId, { forUpdate: true });
    checkLockVersion(expected, access.asset.lock_version, "素材");
    const restoring = state === "active" && access.asset.state === "archived";
    if (access.asset.state === "archived" && !restoring) throw archived("素材已归档，请先恢复");
    const changes: Record<string, unknown> = {};
    if (name !== undefined && name !== access.asset.name) changes.name = name;
    if (visibility !== undefined && visibility !== access.asset.visibility) changes.visibility = visibility;
    if (maintainedBy !== undefined && maintainedBy !== access.asset.maintained_by) {
      if (!access.canTransfer) throw forbidden("只有组织拥有者或管理员可以转交素材负责人");
      if (maintainedBy) {
        const member = await trx
          .selectFrom("organization_member")
          .select("role")
          .where("organization_id", "=", access.asset.organization_id)
          .where("user_id", "=", maintainedBy)
          .executeTakeFirst();
        if (!member || member.role === "viewer") throw invalid("新负责人必须是可编辑的组织成员");
      }
      changes.maintained_by = maintainedBy;
    }
    if (restoring) Object.assign(changes, { state: "active", archived_at: null, archived_by: null });
    if (payload) retiredKeys = await writeAssetContent(trx, actor, access.asset, payload, resources, { access });
    if (!Object.keys(changes).length && !payload) return;
    await trx
      .updateTable("asset")
      .set((eb) => ({ ...changes, lock_version: eb("lock_version", "+", 1) }))
      .where("id", "=", assetId)
      .execute();
    const action = restoring ? "asset.restore" : "maintained_by" in changes ? "asset.maintainer.transfer" : "visibility" in changes ? "asset.visibility.change" : "asset.update";
    await audit(trx, {
      organizationId: access.asset.organization_id,
      actorId: actor.userId,
      action,
      objectType: "asset",
      objectId: assetId,
      details: {
        changes,
        content_updated: hasContent,
        before: { name: access.asset.name, visibility: access.asset.visibility, maintained_by: access.asset.maintained_by, state: access.asset.state },
      },
    });
  });
  if (retiredKeys.length) await releaseObjectsIfUnreferenced(retiredKeys, { userId: actor.userId, method: "PATCH", path: `/api/assets/${assetId}` });
  const dto = await loadAssetDto(db, actor, assetId);
  if (!dto) throw notFound("素材不存在");
  return dto;
}

/** DELETE /api/assets/[id] = archive; existing references keep working (plan §5.2). */
export async function archiveAsset(actor: Actor, assetId: string, expectedLockVersion: number | undefined): Promise<ArchiveAssetResult> {
  const pre = await requireAssetMaintain(db, actor, assetId);
  await contentTransaction(async (trx) => {
    await lockOrgForWrite(trx, pre.asset.organization_id);
    const access = await requireAssetMaintain(trx, actor, assetId, { forUpdate: true });
    checkLockVersion(expectedLockVersion, access.asset.lock_version, "素材");
    if (access.asset.state === "archived") return;
    await trx
      .updateTable("asset")
      .set((eb) => ({ state: "archived", archived_at: sql<Date>`now()`, archived_by: actor.userId, lock_version: eb("lock_version", "+", 1) }))
      .where("id", "=", assetId)
      .execute();
    await audit(trx, { organizationId: access.asset.organization_id, actorId: actor.userId, action: "asset.archive", objectType: "asset", objectId: assetId });
  });
  const [asset, impact] = await Promise.all([loadAssetDto(db, actor, assetId), computeImpact(db, actor, assetId)]);
  if (!asset) throw notFound("素材不存在");
  return { asset, impact };
}

/**
 * POST /api/assets/[id]/duplicate: new team identity + v1 sharing the
 * physical files. `targetWorkspaceId` (optional) only records an origin
 * collection, which must be open and in the same team.
 */
export async function duplicateAsset(actor: Actor, assetId: string, body: JsonRecord): Promise<CreateAssetResult> {
  rejectUnknown(body, ["targetWorkspaceId", "name", "idempotencyKey"]);
  const targetId = body.targetWorkspaceId === undefined || body.targetWorkspaceId === null ? null : requireUuid(body.targetWorkspaceId, "targetWorkspaceId");
  const key = requireIdempotencyKey(body.idempotencyKey);
  const source = await requireAssetRead(db, actor, assetId);
  const organizationId = source.asset.organization_id;
  const org = await requireOrgWrite(db, actor, organizationId);
  const workspace = targetId ? await requireWorkspaceEdit(db, actor, targetId) : undefined;
  if (workspace && workspace.workspace.organization_id !== organizationId) throw invalid("只能在同一组织内另存副本");
  const target: AssetCreateTarget = workspace ? { org: workspace, workspace } : { org };
  const name = body.name === undefined ? `${source.asset.name ?? "素材"} 副本` : requireString(body.name, "name", { max: 200 });
  const scope = { actorId: actor.userId, command: "asset.duplicate", key, hash: requestHash({ assetId, targetId, name }) };
  const outcome = await contentTransaction(async (trx) => {
    if (workspace) await lockWorkspaceForWrite(trx, workspace);
    else await lockOrgForWrite(trx, organizationId);
    const previous = await claimIdempotency(trx, scope);
    if (previous) return { assetId: previous, created: false };
    await ensureAssetUse(trx, actor, assetId, target.org);
    const content = (await loadAssetContents(trx, [assetId])).get(assetId);
    if (!content) throw notFound("来源素材不存在");
    const resources = content.resources;
    const fileType = parseFileType(source.asset.file_type);
    const created = await createAssetTx(trx, actor, target, {
      name,
      fileType,
      // Stored payloads are immutable and were validated (or migrated) on write; copy verbatim.
      payload: content.payload as unknown as ParsedCreateAsset["payload"],
      resources: resources.map((r) => ({
        role: r.role as ResourceRole,
        ordinal: r.ordinal,
        fromAssetId: assetId,
        fromRole: r.role as ResourceRole,
        fromOrdinal: r.ordinal,
      })),
      visibility: DEFAULT_VISIBILITY,
    });
    await recordIdempotency(trx, scope, organizationId, "asset", created.assetId);
    await audit(trx, {
      organizationId,
      actorId: actor.userId,
      action: "asset.duplicate",
      objectType: "asset",
      objectId: created.assetId,
      workspaceId: workspace?.workspace.id ?? null,
      details: { source_asset_id: assetId },
    });
    return { assetId: created.assetId, created: true };
  });
  return createResult(actor, outcome.assetId, null, outcome.created);
}

// ───────────────────────── usage & retired grants ─────────────────────────

export async function getAssetUsage(actor: Actor, assetId: string): Promise<AssetUsageDto> {
  await requireAssetRead(db, actor, assetId);
  const impact = await computeImpact(db, actor, assetId);
  return { asset_id: assetId, impact };
}
