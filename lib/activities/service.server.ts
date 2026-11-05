import "server-only";
import { randomUUID } from "node:crypto";
import { loadAssetContents, primaryResource } from "@/lib/assets/dto.server";
import { assertOrgWritable, ensureAssetUse, loadOrgAccess, lockOrgForWrite, lockWorkspaceForWrite, requireOrgRead, requireOrgWrite, requireWorkspaceEdit, requireWorkspaceRead, type Actor, type OrgAccess } from "@/lib/content-model/access.server";
import { archived, checkLockVersion, ContentError, invalid, notFound } from "@/lib/content-model/errors";
import { nameContainsPattern, optionalIdempotencyKey, optionalInt, optionalString, rejectUnknown, requireEnum, requireRecord, requireString, requireUuid } from "@/lib/content-model/input";
import { audit, claimIdempotency, contentTransaction, lockKeys, recordIdempotency, requestHash, toIsoRequired, type Executor, type Trx } from "@/lib/content-model/tx.server";
import { db, sql } from "@/lib/db";
import type { LibraryListQuery } from "@/lib/content-model/contracts";
import type { ActivityDto, ActivityLocation, ActivityPlacementDto, ActivityRecordDto, ActivityType } from "./contracts";
import { effectiveConfig, parseActivityArea, parseActivityConfig, parsePoints } from "./input";

export const locationSql = (point: ActivityLocation | null) => point ? sql<string>`ST_SetSRID(ST_MakePoint(${point.longitude}::float8, ${point.latitude}::float8), 4326)` : null;
export const locationOf = (row: { longitude: number | null; latitude: number | null }): ActivityLocation | null =>
  row.longitude === null || row.latitude === null ? null : { longitude: row.longitude, latitude: row.latitude };
const typeOf = (value: string): ActivityType => requireEnum(value, "activity.type", ["shop_checkin", "danmaku"]);

async function activityAccess(exec: Executor, actor: Actor, id: string) {
  const activity = await exec.selectFrom("activity").selectAll().where("id", "=", id).executeTakeFirst();
  if (!activity) throw notFound("活动不存在");
  const access = await loadOrgAccess(exec, actor, activity.organization_id);
  if (!access?.canRead) throw notFound("活动不存在");
  return { activity, access };
}

async function activityDto(exec: Executor, id: string, access: OrgAccess): Promise<ActivityDto> {
  const row = await exec.selectFrom("activity").selectAll()
    .select([sql<number | null>`ST_X(location)`.as("longitude"), sql<number | null>`ST_Y(location)`.as("latitude")])
    .where("id", "=", id).executeTakeFirstOrThrow();
  const points = await exec.selectFrom("activity_point").selectAll()
    .select([sql<number | null>`ST_X(location)`.as("longitude"), sql<number | null>`ST_Y(location)`.as("latitude")])
    .where("activity_id", "=", id).orderBy("ordinal").orderBy("id").execute();
  const contents = await loadAssetContents(exec, points.flatMap((point) => [point.image_asset_id, point.reward_asset_id].filter((v): v is string => !!v)));
  const image = (assetId: string | null) => assetId ? primaryResource(contents.get(assetId))?.url ?? null : null;
  return {
    id: row.id, organization_id: row.organization_id, type: typeOf(row.type), name: row.name, description: row.description,
    config: effectiveConfig(typeOf(row.type), row.config), state: requireEnum(row.state, "state", ["active", "archived"]),
    location: locationOf(row), radius_meters: row.radius_meters,
    lock_version: row.lock_version, created_at: toIsoRequired(row.created_at), updated_at: toIsoRequired(row.updated_at),
    capabilities: { can_read: access.canRead, can_edit: access.canWrite && !access.org.archived_at },
    points: points.map((point) => ({ id: point.id, activity_id: id, name: point.name, description: point.description, ordinal: point.ordinal,
      image_asset_id: point.image_asset_id, reward_asset_id: point.reward_asset_id, image_url: image(point.image_asset_id), reward_url: image(point.reward_asset_id),
      location: locationOf(point), state: requireEnum(point.state, "point.state", ["active", "archived"]) })),
  };
}

export async function getActivity(actor: Actor, id: string): Promise<ActivityDto> {
  const { access } = await activityAccess(db, actor, id);
  return activityDto(db, id, access);
}

export async function listActivities(actor: Actor, organizationId: string, opts: LibraryListQuery = {}): Promise<ActivityDto[]> {
  const access = await requireOrgRead(db, actor, organizationId);
  let query = db.selectFrom("activity").select("id").where("organization_id", "=", organizationId)
    .orderBy("created_at", "desc").orderBy("id");
  if (opts.state && opts.state !== "all") query = query.where("state", "=", opts.state);
  if (opts.q) query = query.where("name", "ilike", nameContainsPattern(opts.q));
  if (opts.limit !== undefined) query = query.limit(opts.limit).offset(opts.offset ?? 0);
  const rows = await query.execute();
  return Promise.all(rows.map((row) => activityDto(db, row.id, access)));
}

export async function createActivity(actor: Actor, organizationId: string, value: unknown): Promise<ActivityDto> {
  const body = requireRecord(value, "activity");
  rejectUnknown(body, ["name", "type", "description", "config", "location", "radiusMeters", "idempotencyKey"]);
  const type = typeOf(requireString(body.type, "type"));
  const name = requireString(body.name, "name");
  const description = optionalString(body.description, "description", { max: 5000 }) ?? null;
  const config = effectiveConfig(type, parseActivityConfig(body.config ?? {}, type));
  const area = parseActivityArea(body);
  const key = optionalIdempotencyKey(body.idempotencyKey);
  const id = await contentTransaction(async (trx) => {
    await requireOrgWrite(trx, actor, organizationId);
    await lockOrgForWrite(trx, organizationId);
    const scope = key ? { actorId: actor.userId, command: `activity.create:${organizationId}`, key, hash: requestHash(body) } : null;
    if (scope) { const replay = await claimIdempotency(trx, scope); if (replay) return replay; }
    const result = await trx.insertInto("activity").values({ organization_id: organizationId, type, name, description, config: JSON.stringify(config),
      location: locationSql(area.location), radius_meters: area.radius_meters, created_by: actor.userId, updated_by: actor.userId }).returning("id").executeTakeFirstOrThrow();
    if (scope) await recordIdempotency(trx, scope, organizationId, "activity", result.id);
    await audit(trx, { organizationId, actorId: actor.userId, action: "activity.create", objectType: "activity", objectId: result.id });
    return result.id;
  });
  return getActivity(actor, id);
}

async function savePoints(trx: Trx, actor: Actor, activityId: string, access: OrgAccess, value: unknown): Promise<void> {
  const points = parsePoints(value);
  const previous = await trx.selectFrom("activity_point").selectAll().where("activity_id", "=", activityId).execute();
  const prior = new Map(previous.map((p) => [p.id, p]));
  for (const point of points) {
    if (point.id && !prior.has(point.id)) throw invalid("打卡点不属于该活动");
    const old = point.id ? prior.get(point.id) : undefined;
    for (const [id, oldId] of [[point.imageAssetId, old?.image_asset_id], [point.rewardAssetId, old?.reward_asset_id]]) {
      if (!id) continue;
      const asset = await ensureAssetUse(trx, actor, id, access, { existingReference: oldId === id });
      if (asset.file_type !== "image") throw invalid("打卡点图片与奖励图必须使用图片素材");
    }
  }
  const retained = new Set(points.flatMap((point) => point.id ? [point.id] : []));
  const omitted = previous.filter((p) => !retained.has(p.id)).map((p) => p.id);
  if (omitted.length) await trx.updateTable("activity_point").set({ state: "archived", updated_at: new Date() }).where("id", "in", omitted).execute();
  for (const point of points) {
    const values = { name: point.name, description: point.description ?? null, ordinal: point.ordinal ?? 0, image_asset_id: point.imageAssetId ?? null,
      reward_asset_id: point.rewardAssetId ?? null, ...(point.location === undefined ? {} : { location: locationSql(point.location) }),
      state: point.state ?? "active", updated_at: new Date() };
    if (point.id) {
      await trx.updateTable("activity_point").set(values).where("id", "=", point.id).execute();
    } else {
      const id = randomUUID();
      await trx.insertInto("activity_point").values({ ...values, id, activity_id: activityId, organization_id: access.org.id }).execute();
    }
  }
}

export async function updateActivity(actor: Actor, id: string, value: unknown): Promise<ActivityDto> {
  const body = requireRecord(value, "activity");
  rejectUnknown(body, ["expectedLockVersion", "name", "description", "config", "location", "radiusMeters", "state", "points"]);
  await contentTransaction(async (trx) => {
    const { activity, access } = await activityAccess(trx, actor, id);
    assertOrgWritable(access);
    await lockOrgForWrite(trx, activity.organization_id);
    const locked = await trx.selectFrom("activity").selectAll()
      .select([sql<number | null>`ST_X(location)`.as("longitude"), sql<number | null>`ST_Y(location)`.as("latitude")])
      .where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
    checkLockVersion(optionalInt(body.expectedLockVersion, "expectedLockVersion", 1), locked.lock_version, "活动");
    const state = body.state === undefined ? locked.state : requireEnum(body.state, "state", ["active", "archived"]);
    if (locked.state === "archived" && state !== "active") throw archived("请先恢复活动再编辑");
    const type = typeOf(locked.type);
    const area = parseActivityArea(body, { location: locationOf(locked), radius_meters: locked.radius_meters });
    if (body.points !== undefined) {
      if (type !== "shop_checkin") throw invalid("弹幕活动不包含打卡点");
      await savePoints(trx, actor, id, access, body.points);
    }
    await trx.updateTable("activity").set({
      ...(body.name === undefined ? {} : { name: requireString(body.name, "name") }),
      ...(body.description === undefined ? {} : { description: optionalString(body.description, "description", { max: 5000 }) }),
      ...(body.config === undefined ? {} : { config: JSON.stringify(effectiveConfig(type, parseActivityConfig(body.config, type))) }),
      location: locationSql(area.location), radius_meters: area.radius_meters,
      state, lock_version: locked.lock_version + 1, updated_at: new Date(), updated_by: actor.userId,
    }).where("id", "=", id).execute();
    await audit(trx, { organizationId: activity.organization_id, actorId: actor.userId, action: "activity.update", objectType: "activity", objectId: id });
  });
  return getActivity(actor, id);
}

async function placementDto(exec: Executor, id: string, actor: Actor): Promise<ActivityPlacementDto> {
  const row = await exec.selectFrom("activity_placement as p").innerJoin("activity as a", "a.id", "p.activity_id").innerJoin("workspace as w", "w.id", "p.workspace_id")
    .selectAll("p").select(["a.name as activity_name", "a.type as activity_type", "w.name as workspace_name", "a.state as activity_state"])
    .where("p.id", "=", id).executeTakeFirst();
  if (!row) throw notFound("活动投放不存在");
  const access = await requireWorkspaceRead(exec, actor, row.workspace_id);
  return {
    id, activity_id: row.activity_id, organization_id: row.organization_id, workspace_id: row.workspace_id,
    activity_name: row.activity_name, activity_type: typeOf(row.activity_type), workspace_name: row.workspace_name,
    status: requireEnum(row.status, "status", ["draft", "active", "paused", "archived"]), lock_version: row.lock_version,
    capabilities: { can_read: true, can_edit: access.canEdit && row.activity_state === "active" },
    created_at: toIsoRequired(row.created_at), updated_at: toIsoRequired(row.updated_at),
  };
}

export const getActivityPlacement = (actor: Actor, id: string) => placementDto(db, id, actor);

export async function listActivityPlacements(actor: Actor, activityId: string): Promise<ActivityPlacementDto[]> {
  await activityAccess(db, actor, activityId);
  const rows = await db.selectFrom("activity_placement").select("id").where("activity_id", "=", activityId).orderBy("created_at", "desc").execute();
  return Promise.all(rows.map((row) => placementDto(db, row.id, actor)));
}

export async function listCollectionActivityPlacements(actor: Actor, workspaceId: string): Promise<ActivityPlacementDto[]> {
  await requireWorkspaceRead(db, actor, workspaceId);
  const rows = await db.selectFrom("activity_placement").select("id").where("workspace_id", "=", workspaceId).orderBy("created_at", "desc").execute();
  return Promise.all(rows.map((row) => placementDto(db, row.id, actor)));
}

export async function createActivityPlacement(actor: Actor, activityId: string, value: unknown): Promise<ActivityPlacementDto> {
  const body = requireRecord(value, "placement");
  rejectUnknown(body, ["workspaceId", "status", "idempotencyKey"]);
  const workspaceId = requireUuid(body.workspaceId, "workspaceId");
  const status = body.status === undefined ? "draft" : requireEnum(body.status, "status", ["draft", "active", "paused", "archived"]);
  const key = optionalIdempotencyKey(body.idempotencyKey);
  const id = await contentTransaction(async (trx) => {
    const access = await requireWorkspaceEdit(trx, actor, workspaceId);
    await lockWorkspaceForWrite(trx, access);
    const activity = await trx.selectFrom("activity").selectAll().where("id", "=", activityId).forShare().executeTakeFirst();
    if (!activity || activity.organization_id !== access.org.id) throw notFound("活动不存在");
    if (activity.state !== "active") throw archived("活动已归档");
    const scope = key ? { actorId: actor.userId, command: `activity.place:${activityId}`, key, hash: requestHash(body) } : null;
    if (scope) { const replay = await claimIdempotency(trx, scope); if (replay) return replay; }
    await lockKeys(trx, [`activity-map:${activityId}:${workspaceId}`]);
    const existing = await trx.selectFrom("activity_placement").select("id")
      .where("activity_id", "=", activityId).where("workspace_id", "=", workspaceId).executeTakeFirst();
    if (existing) throw new ContentError("DEPENDENCY_CONFLICT", "该活动已关联到此地图，请编辑或重新启用已有投放");
    const placement = await trx.insertInto("activity_placement").values({ activity_id: activityId, organization_id: activity.organization_id, workspace_id: workspaceId,
      status, created_by: actor.userId, updated_by: actor.userId }).returning("id").executeTakeFirstOrThrow();
    if (scope) await recordIdempotency(trx, scope, activity.organization_id, "activity_placement", placement.id);
    await audit(trx, { organizationId: activity.organization_id, workspaceId, actorId: actor.userId, action: "activity.place", objectType: "activity_placement", objectId: placement.id });
    return placement.id;
  });
  return placementDto(db, id, actor);
}

export async function updateActivityPlacement(actor: Actor, id: string, value: unknown): Promise<ActivityPlacementDto> {
  const body = requireRecord(value, "placement");
  rejectUnknown(body, ["expectedLockVersion", "status"]);
  await contentTransaction(async (trx) => {
    const initial = await trx.selectFrom("activity_placement").selectAll().where("id", "=", id).executeTakeFirst();
    if (!initial) throw notFound("活动投放不存在");
    const access = await requireWorkspaceEdit(trx, actor, initial.workspace_id);
    await lockWorkspaceForWrite(trx, access);
    const activity = await trx.selectFrom("activity").selectAll().where("id", "=", initial.activity_id).forShare().executeTakeFirstOrThrow();
    if (activity.state !== "active") throw archived("请先恢复活动再编辑投放");
    const row = await trx.selectFrom("activity_placement").selectAll().where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
    checkLockVersion(optionalInt(body.expectedLockVersion, "expectedLockVersion", 1), row.lock_version, "活动投放");
    const status = body.status === undefined ? row.status : requireEnum(body.status, "status", ["draft", "active", "paused", "archived"]);
    await trx.updateTable("activity_placement").set({ status,
      lock_version: row.lock_version + 1, updated_at: new Date(), updated_by: actor.userId }).where("id", "=", id).execute();
    await audit(trx, { organizationId: row.organization_id, workspaceId: row.workspace_id, actorId: actor.userId, action: "activity.placement.update", objectType: "activity_placement", objectId: id });
  });
  return placementDto(db, id, actor);
}

function recordQuery(exec: Executor) {
  return exec.selectFrom("activity_record").selectAll().select([sql<number | null>`ST_X(location)`.as("longitude"), sql<number | null>`ST_Y(location)`.as("latitude")]);
}
type RecordRow = Awaited<ReturnType<ReturnType<typeof recordQuery>["executeTakeFirstOrThrow"]>>;
function recordDto(row: RecordRow, canEdit: boolean): ActivityRecordDto {
  return { id: row.id, activity_id: row.activity_id, placement_id: row.placement_id, point_id: row.point_id, participant_id: row.participant_id,
    kind: requireEnum(row.kind, "kind", ["danmaku", "checkin"]), content: row.content, status: requireEnum(row.status, "status", ["visible", "hidden"]),
    location: locationOf(row), created_at: toIsoRequired(row.created_at), lock_version: row.lock_version, capabilities: { can_read: true, can_edit: canEdit } };
}
export async function listActivityRecords(actor: Actor, activityId: string, options: { placementId?: string; limit: number; offset: number }) {
  const { access } = await activityAccess(db, actor, activityId);
  let query = recordQuery(db).where("activity_id", "=", activityId);
  if (options.placementId) query = query.where("placement_id", "=", requireUuid(options.placementId, "placementId"));
  const count = await query.clearSelect().select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await query.orderBy("created_at", "desc").orderBy("id").limit(options.limit).offset(options.offset).execute();
  return { data: rows.map((row) => recordDto(row, access.canWrite && !access.org.archived_at)), page: { total: count.total, limit: options.limit, offset: options.offset } };
}
export async function moderateActivityRecord(actor: Actor, id: string, value: unknown): Promise<ActivityRecordDto> {
  const body = requireRecord(value, "record");
  rejectUnknown(body, ["expectedLockVersion", "status"]);
  return contentTransaction(async (trx) => {
    const initial = await trx.selectFrom("activity_record").selectAll().where("id", "=", id).executeTakeFirst();
    if (!initial) throw notFound("活动记录不存在");
    const { access } = await activityAccess(trx, actor, initial.activity_id);
    assertOrgWritable(access);
    await lockOrgForWrite(trx, initial.organization_id);
    const row = await recordQuery(trx).where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
    checkLockVersion(optionalInt(body.expectedLockVersion, "expectedLockVersion", 1), row.lock_version, "活动记录");
    const status = requireEnum(body.status, "status", ["visible", "hidden"]);
    await trx.updateTable("activity_record").set({ status, lock_version: row.lock_version + 1, updated_at: new Date() }).where("id", "=", id).execute();
    await audit(trx, { organizationId: row.organization_id, actorId: actor.userId, action: "activity.record.moderate", objectType: "activity_record", objectId: id, details: { status } });
    return recordDto({ ...row, status, lock_version: row.lock_version + 1 }, true);
  });
}
