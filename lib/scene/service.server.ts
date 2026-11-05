import { loadAssetContents, primaryResource } from "@/lib/assets/dto.server";
import {
  assertOrgWritable,
  ensureAssetUse,
  loadOrgAccess,
  lockOrgForWrite,
  lockWorkspaceForWrite,
  requireOrgRead,
  requireOrgWrite,
  requireWorkspaceEdit,
  type Actor,
  type OrgAccess
} from "@/lib/content-model/access.server";
import type {
  LibraryListQuery,
  ModelAnimationInfo,
  SceneDetailDto,
  SceneDocumentJson,
  SceneResolvedResourceDto,
  SceneSummaryDto,
} from "@/lib/content-model/contracts";
import { archived, checkLockVersion, invalid, notFound } from "@/lib/content-model/errors";
import {
  nameContainsPattern,
  isRecord,
  isUuid,
  optionalIdempotencyKey,
  rejectUnknown,
  requireEnum,
  requireInt,
  requireString,
  requireUuid,
  type JsonRecord,
} from "@/lib/content-model/input";
import {
  audit,
  claimIdempotency,
  contentTransaction,
  recordIdempotency,
  requestHash,
  toIsoRequired,
  type Executor,
  type Trx,
} from "@/lib/content-model/tx.server";
import { db, sql } from "@/lib/db";
import "server-only";
import { clipIssues, resourceKindIssues } from "./compile";
import { createBlankSceneDocument, type SceneDocument } from "./protocol";
import { validateSceneDocument } from "./validate";

interface SceneRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  name: string;
  document: unknown;
  lock_version: number;
  state: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const SCENE_COLUMNS = ["id", "organization_id", "workspace_id", "name", "document", "lock_version", "state", "created_by", "updated_by", "created_at", "updated_at"] as const;

export function parseDocument(value: unknown): SceneDocument {
  const result = validateSceneDocument(value);
  if (!result.ok)
    throw invalid(
      "场景校验失败",
      result.issues.filter((i) => i.severity === "error").slice(0, 20).map((i) => ({ path: i.path, message: i.message })),
    );
  return value as SceneDocument;
}

async function loadSceneRow(exec: Executor, sceneId: string, forUpdate = false): Promise<SceneRow | null> {
  if (!isUuid(sceneId)) return null;
  let query = exec.selectFrom("scene").select(SCENE_COLUMNS).where("id", "=", sceneId);
  if (forUpdate) query = query.forUpdate();
  return (await query.executeTakeFirst()) ?? null;
}

/** Scene + team access; scenes of other organizations are indistinguishable from missing ones. */
async function requireSceneRead(exec: Executor, actor: Actor, sceneId: string): Promise<{ scene: SceneRow; access: OrgAccess }> {
  const scene = await loadSceneRow(exec, sceneId);
  if (!scene) throw notFound("场景不存在");
  const access = await loadOrgAccess(exec, actor, scene.organization_id);
  if (!access?.canRead) throw notFound("场景不存在");
  return { scene, access };
}

async function requireSceneWrite(exec: Executor, actor: Actor, sceneId: string): Promise<{ scene: SceneRow; access: OrgAccess }> {
  const found = await requireSceneRead(exec, actor, sceneId);
  assertOrgWritable(found.access);
  return found;
}

// ───────────────────────── derived references ─────────────────────────

function animationsOf(payload: unknown): ModelAnimationInfo[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.animations)) return undefined;
  return payload.animations as ModelAnimationInfo[];
}

async function validateSceneRefs(trx: Trx, actor: Actor, scene: { id?: string; organization_id: string }, writer: OrgAccess, document: SceneDocument): Promise<void> {
  const existing = new Set(scene.id ? (await trx.selectFrom("scene_asset_ref").select("asset_id").where("scene_id", "=", scene.id).execute()).map((r) => r.asset_id) : []);
  const entries = Object.entries(document.content.assets);
  const assetIds = [...new Set(entries.map(([, ref]) => ref.assetId.toLowerCase()))].sort();
  for (const id of assetIds) await ensureAssetUse(trx, actor, id, writer, { existingReference: existing.has(id) });
  const assets = await loadAssetContents(trx, assetIds);
  const issues: { path: string; message: string }[] = [];
  const animations: Record<string, ModelAnimationInfo[] | undefined> = {};
  const kinds: Record<string, string> = {};
  for (const [alias, ref] of entries) {
    const asset = assets.get(ref.assetId.toLowerCase());
    const path = `content.assets.${alias}`;
    if (!asset || asset.organization_id !== scene.organization_id) issues.push({ path, message: "素材不存在" });
    else {
      kinds[alias] = asset.file_type;
      if (!primaryResource(asset)) issues.push({ path, message: "素材缺少可播放文件" });
      if (asset.file_type === "model") animations[alias] = animationsOf(asset.payload);
    }
  }
  issues.push(...resourceKindIssues(document, kinds));
  issues.push(...clipIssues(document, animations));
  if (issues.length) throw invalid("场景引用校验失败", issues);
}

async function syncSceneRefs(trx: Trx, actor: Actor, scene: { id: string; organization_id: string }, writer: OrgAccess, document: SceneDocument): Promise<void> {
  await validateSceneRefs(trx, actor, scene, writer, document);
  const entries = Object.entries(document.content.assets);
  await trx.deleteFrom("scene_asset_ref").where("scene_id", "=", scene.id).execute();
  if (entries.length) await trx.insertInto("scene_asset_ref").values(entries.map(([alias, ref]) => ({
    scene_id: scene.id, organization_id: scene.organization_id, resource_alias: alias, asset_id: ref.assetId.toLowerCase(),
  }))).execute();
}

/** Read-only draft preflight. Saving repeats these checks in its own transaction. */
export async function validateOrganizationScene(actor: Actor, organizationId: string, body: JsonRecord) {
  rejectUnknown(body, ["document", "sceneId", "expectedLockVersion"]);
  const document = parseDocument(body.document);
  const sceneId = body.sceneId === undefined ? undefined : requireUuid(body.sceneId, "sceneId");
  const expected = body.expectedLockVersion === undefined ? undefined : requireInt(body.expectedLockVersion, "expectedLockVersion", 0);
  return db.transaction().execute(async (trx) => {
    const writer = await requireOrgWrite(trx, actor, organizationId);
    const scene = sceneId ? (await requireSceneWrite(trx, actor, sceneId)).scene : undefined;
    if (scene && scene.organization_id !== organizationId) throw notFound("场景不存在");
    if (scene?.state === "archived") throw archived("场景已归档，请先恢复再编辑");
    if (scene && expected !== undefined) checkLockVersion(expected, scene.lock_version, "场景");
    if (!scene && expected !== undefined) throw invalid("新场景不接受 expectedLockVersion");
    await validateSceneRefs(trx, actor, { id: sceneId, organization_id: organizationId }, writer, document);
    const referenced_resources = await resolveSceneResources(trx, Object.entries(document.content.assets).map(([resource_alias, ref]) => ({ resource_alias, asset_id: ref.assetId.toLowerCase() })));
    return { valid: true as const, ...(scene ? { lock_version: scene.lock_version } : {}), referenced_resources };
  });
}

// ───────────────────────── DTOs ─────────────────────────

async function orgAccessMap(exec: Executor, actor: Actor, orgIds: string[]): Promise<Map<string, OrgAccess>> {
  const out = new Map<string, OrgAccess>();
  for (const orgId of new Set(orgIds)) {
    const access = await loadOrgAccess(exec, actor, orgId);
    if (access) out.set(orgId, access);
  }
  return out;
}

async function buildSceneSummaries(exec: Executor, actor: Actor, scenes: SceneRow[]): Promise<SceneSummaryDto[]> {
  if (!scenes.length) return [];
  const ids = scenes.map((s) => s.id);
  const [placementCounts, access] = await Promise.all([
    exec.selectFrom("placement").select(["scene_id", ({ fn }) => fn.countAll<number>().as("n")])
      .where("scene_id", "in", ids).where("status", "<>", "archived").groupBy("scene_id").execute(),
    orgAccessMap(exec, actor, scenes.map((s) => s.organization_id)),
  ]);
  const countByScene = new Map(placementCounts.map((r) => [r.scene_id, Number(r.n)]));
  return scenes.map((scene) => {
    const org = access.get(scene.organization_id);
    const writable = !!org?.canWrite && !org.org.archived_at;
    const editable = writable && scene.state === "active";
    return {
      id: scene.id,
      organization_id: scene.organization_id,
      workspace_id: scene.workspace_id,
      name: scene.name,
      state: scene.state === "archived" ? "archived" : "active",
      lock_version: scene.lock_version,
      placement_count: countByScene.get(scene.id) ?? 0,
      created_by: scene.created_by,
      updated_by: scene.updated_by,
      created_at: toIsoRequired(scene.created_at),
      updated_at: toIsoRequired(scene.updated_at),
      capabilities: { can_read: !!org?.canRead, can_edit: editable, can_archive: writable },
    };
  });
}

/** Resolve each alias against its asset's current content. */
export async function resolveSceneResources(exec: Executor, refs: { resource_alias: string; asset_id: string }[]): Promise<SceneResolvedResourceDto[]> {
  if (!refs.length) return [];
  const ids = [...new Set(refs.map((r) => r.asset_id))];
  const contents = await loadAssetContents(exec, ids);
  const identities = await exec.selectFrom("asset").select(["id", "name", "state"]).where("id", "in", ids).execute();
  const byId = new Map(identities.map((a) => [a.id, a]));
  return refs.map((ref) => {
    const asset = contents.get(ref.asset_id);
    const identity = byId.get(ref.asset_id);
    return {
      resource_alias: ref.resource_alias, asset_id: ref.asset_id, asset_name: identity?.name ?? null,
      file_type: asset?.file_type ?? "model", asset_state: identity?.state === "archived" ? "archived" : "active",
      asset_lock_version: asset?.lock_version ?? 0, url: primaryResource(asset)?.url ?? null,
      animations: asset?.payload.kind === "model" ? asset.payload.animations ?? [] : [],
    };
  });
}

async function buildSceneDetail(exec: Executor, actor: Actor, scene: SceneRow): Promise<SceneDetailDto> {
  const [summary] = await buildSceneSummaries(exec, actor, [scene]);
  const refs = await exec
    .selectFrom("scene_asset_ref")
    .select(["resource_alias", "asset_id"])
    .where("scene_id", "=", scene.id)
    .orderBy("resource_alias")
    .execute();
  return {
    ...summary,
    document: scene.document as SceneDocumentJson,
    referenced_resources: await resolveSceneResources(exec, refs),
  };
}

// ───────────────────────── queries ─────────────────────────

export async function listOrganizationScenes(actor: Actor, organizationId: string, opts: LibraryListQuery = {}): Promise<SceneSummaryDto[]> {
  await requireOrgRead(db, actor, organizationId);
  let query = db.selectFrom("scene").select(SCENE_COLUMNS).where("organization_id", "=", organizationId)
    .orderBy("updated_at", "desc").orderBy("id");
  if (opts.state && opts.state !== "all") query = query.where("state", "=", opts.state);
  if (opts.q) query = query.where("name", "ilike", nameContainsPattern(opts.q));
  if (opts.limit !== undefined) query = query.limit(opts.limit).offset(opts.offset ?? 0);
  return buildSceneSummaries(db, actor, await query.execute());
}

export async function getScene(actor: Actor, sceneId: string): Promise<SceneDetailDto> {
  const { scene } = await requireSceneRead(db, actor, sceneId);
  return buildSceneDetail(db, actor, scene);
}

// ───────────────────────── commands ─────────────────────────

function parseCreateScene(body: JsonRecord) {
  rejectUnknown(body, ["name", "document", "idempotencyKey"]);
  return {
    name: requireString(body.name, "name", { max: 200 }),
    document: body.document === undefined ? createBlankSceneDocument() : parseDocument(body.document),
    key: optionalIdempotencyKey(body.idempotencyKey),
  };
}

/** Insert a team scene (caller holds the write locks); `workspaceId` is origin metadata only. */
async function insertSceneTx(
  trx: Trx,
  actor: Actor,
  writer: OrgAccess,
  input: { name: string; document: SceneDocument; workspaceId: string | null },
): Promise<string> {
  const scene = await trx
    .insertInto("scene")
    .values({
      organization_id: writer.org.id,
      workspace_id: input.workspaceId,
      name: input.name,
      document: JSON.stringify(input.document),
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .returning(["id", "organization_id"])
    .executeTakeFirstOrThrow();
  await syncSceneRefs(trx, actor, scene, writer, input.document);
  return scene.id;
}

/** POST /api/organizations/[id]/scenes: a team scene without any collection. */
export async function createOrganizationScene(actor: Actor, organizationId: string, body: JsonRecord): Promise<SceneDetailDto> {
  const { name, document, key } = parseCreateScene(body);
  const org = await requireOrgWrite(db, actor, organizationId);
  const sceneId = await contentTransaction(async (trx) => {
    await lockOrgForWrite(trx, organizationId);
    const scope = key ? { actorId: actor.userId, command: "scene.create", key, hash: requestHash({ organizationId, name, document }) } : null;
    if (scope) {
      const previous = await claimIdempotency(trx, scope);
      if (previous) return previous;
    }
    const id = await insertSceneTx(trx, actor, org, { name, document, workspaceId: null });
    if (scope) await recordIdempotency(trx, scope, organizationId, "scene", id);
    await audit(trx, { organizationId, actorId: actor.userId, action: "scene.create", objectType: "scene", objectId: id });
    return id;
  });
  return getScene(actor, sceneId);
}


/**
 * PATCH /api/scenes/[id]: save draft / rename / archive / restore. One
 * transaction: permission, version ownership and use checks, conditional
 * update on lock_version, derived index rebuild. 428 without a lock, 409 when
 * stale; the client keeps its local copy on failure.
 */
export async function saveScene(actor: Actor, sceneId: string, body: JsonRecord): Promise<SceneDetailDto> {
  rejectUnknown(body, ["expectedLockVersion", "name", "document", "state"]);
  const expected = body.expectedLockVersion === undefined ? undefined : requireInt(body.expectedLockVersion, "expectedLockVersion", 0);
  const name = body.name === undefined ? undefined : requireString(body.name, "name", { max: 200 });
  const document = body.document === undefined ? undefined : parseDocument(body.document);
  const state = body.state === undefined ? undefined : requireEnum(body.state, "state", ["active", "archived"] as const);
  const { scene: pre, access } = await requireSceneWrite(db, actor, sceneId);
  await contentTransaction(async (trx) => {
    await lockOrgForWrite(trx, pre.organization_id);
    const scene = await loadSceneRow(trx, sceneId, true);
    if (!scene) throw notFound("场景不存在");
    checkLockVersion(expected, scene.lock_version, "场景");
    const restoring = state === "active" && scene.state === "archived";
    const archiving = state === "archived" && scene.state !== "archived";
    if (scene.state === "archived" && !restoring) throw archived("场景已归档，请先恢复再编辑");
    if (archiving && (document || name)) throw invalid("归档时不能同时修改内容");
    if (document) await syncSceneRefs(trx, actor, scene, access, document);
    if (!document && name === undefined && !restoring && !archiving) return;
    await trx
      .updateTable("scene")
      .set((eb) => ({
        ...(name !== undefined ? { name } : {}),
        ...(document ? { document: JSON.stringify(document) } : {}),
        ...(archiving ? { state: "archived", archived_at: sql<Date>`now()` } : {}),
        ...(restoring ? { state: "active", archived_at: null } : {}),
        lock_version: eb("lock_version", "+", 1),
        updated_by: actor.userId,
        updated_at: sql<Date>`now()`,
      }))
      .where("id", "=", sceneId)
      .where("lock_version", "=", scene.lock_version)
      .execute();
    await audit(trx, {
      organizationId: scene.organization_id,
      actorId: actor.userId,
      action: archiving ? "scene.archive" : restoring ? "scene.restore" : "scene.save",
      objectType: "scene",
      objectId: sceneId,
      workspaceId: scene.workspace_id,
      details: { from_lock_version: scene.lock_version },
    });
  });
  return getScene(actor, sceneId);
}

/**
 * POST /api/scenes/[id]/copy: new editable team scene in the same
 * organization, referencing the same assets (every alias is a new use, so
 * archived assets block the copy). `targetWorkspaceId` (optional) only
 * records an origin collection, which must be open and in the same team.
 */
export async function copyScene(actor: Actor, sceneId: string, body: JsonRecord): Promise<SceneDetailDto> {
  rejectUnknown(body, ["targetWorkspaceId", "name", "idempotencyKey"]);
  const targetId = body.targetWorkspaceId === undefined || body.targetWorkspaceId === null ? null : requireUuid(body.targetWorkspaceId, "targetWorkspaceId");
  const key = optionalIdempotencyKey(body.idempotencyKey);
  const { scene: source, access } = await requireSceneWrite(db, actor, sceneId);
  const workspace = targetId ? await requireWorkspaceEdit(db, actor, targetId) : null;
  if (workspace && workspace.workspace.organization_id !== source.organization_id) throw invalid("只能复制到同一组织的合集");
  const writer: OrgAccess = workspace ?? access;
  const name = body.name === undefined ? `${source.name} 副本` : requireString(body.name, "name", { max: 200 });
  const newId = await contentTransaction(async (trx) => {
    if (workspace) await lockWorkspaceForWrite(trx, workspace);
    else await lockOrgForWrite(trx, source.organization_id);
    const scope = key ? { actorId: actor.userId, command: "scene.copy", key, hash: requestHash({ sceneId, targetId, name }) } : null;
    if (scope) {
      const previous = await claimIdempotency(trx, scope);
      if (previous) return previous;
    }
    const current = await loadSceneRow(trx, sceneId);
    if (!current) throw notFound("场景不存在");
    const document = parseDocument(current.document);
    const id = await insertSceneTx(trx, actor, writer, { name, document, workspaceId: targetId });
    if (scope) await recordIdempotency(trx, scope, source.organization_id, "scene", id);
    await audit(trx, {
      organizationId: source.organization_id,
      actorId: actor.userId,
      action: "scene.copy",
      objectType: "scene",
      objectId: id,
      workspaceId: targetId,
      details: { source_scene_id: sceneId, source_lock_version: current.lock_version },
    });
    return id;
  });
  return getScene(actor, newId);
}

/** Current saved scene and current asset resources, shared by maps and QR preview. */
export async function loadSceneForPlayback(exec: Executor, sceneId: string) {
  const scene = await exec.selectFrom("scene").select(["id", "organization_id", "name", "document", "lock_version"])
    .where("id", "=", sceneId).executeTakeFirst();
  if (!scene) return null;
  const refs = Object.entries(parseDocument(scene.document).content.assets)
    .map(([resource_alias, ref]) => ({ resource_alias, asset_id: ref.assetId }));
  return { scene, resources: await resolveSceneResources(exec, refs) };
}
