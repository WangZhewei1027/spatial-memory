import "server-only";
import { loadAssetContents, primaryResource } from "@/lib/assets/dto.server";
import { ContentError, invalid, notFound } from "@/lib/content-model/errors";
import { isRecord, optionalUuid, rejectUnknown, requireEnum, requireIdempotencyKey, requireString, requireUuid } from "@/lib/content-model/input";
import { audit, contentTransaction, lockKeys, requestHash, toIsoRequired, type Executor, type Trx } from "@/lib/content-model/tx.server";
import { db, sql } from "@/lib/db";
import type { ActivityLocation, ActivityType, PublicActivityDto } from "./contracts";
import { distanceMeters, effectiveConfig, parseLocation } from "./input";
import { DEFAULT_DANMAKU_MAX_LENGTH } from "./defaults";
import { locationOf, locationSql } from "./service.server";

export interface ActivityScope { workspaceId: string | null; organizationId: string | null }

function publicQuery(exec: Executor, scope: ActivityScope) {
  let query = exec.selectFrom("activity_placement as p")
    .innerJoin("activity as a", "a.id", "p.activity_id")
    .innerJoin("workspace as w", "w.id", "p.workspace_id")
    .innerJoin("organization as o", "o.id", "p.organization_id")
    .where("p.status", "=", "active").where("a.state", "=", "active")
    .where("w.archived_at", "is", null).where("o.archived_at", "is", null)
    .select(["p.id", "p.activity_id", "p.organization_id", "p.workspace_id", "w.name as workspace_name", "a.radius_meters",
      "a.name", "a.type", "a.config", sql<number | null>`ST_X(a.location)`.as("longitude"), sql<number | null>`ST_Y(a.location)`.as("latitude")]);
  if (scope.workspaceId) query = query.where("p.workspace_id", "=", scope.workspaceId);
  if (scope.organizationId) query = query.where("p.organization_id", "=", scope.organizationId);
  return query;
}

async function publicPoints(exec: Executor, activityId: string) {
  const rows = await exec.selectFrom("activity_point")
    .select(["id", "id as point_id", "name", "description", "image_asset_id", "reward_asset_id",
      sql<number | null>`ST_X(location)`.as("longitude"), sql<number | null>`ST_Y(location)`.as("latitude")])
    .where("activity_id", "=", activityId).where("state", "=", "active")
    .orderBy("ordinal").orderBy("id").execute();
  const contents = await loadAssetContents(exec, rows.flatMap((row) => [row.image_asset_id, row.reward_asset_id].filter((id): id is string => !!id)));
  return rows.map((row) => ({ ...row,
    image_url: row.image_asset_id ? primaryResource(contents.get(row.image_asset_id))?.url ?? null : null,
    reward_url: row.reward_asset_id ? primaryResource(contents.get(row.reward_asset_id))?.url ?? null : null,
  }));
}

export async function publicActivities(scope: ActivityScope): Promise<PublicActivityDto[]> {
  if (!scope.workspaceId && !scope.organizationId) throw invalid("请指定地图或团队");
  const rows = await publicQuery(db, scope).orderBy("p.created_at").orderBy("p.id").execute();
  return Promise.all(rows.map(async (row) => {
    const type = requireEnum(row.type, "type", ["shop_checkin", "danmaku"]);
    const points = type === "shop_checkin" ? await publicPoints(db, row.activity_id) : [];
    return { id: row.id, activity_id: row.activity_id, workspace_id: row.workspace_id, workspace_name: row.workspace_name, type, name: row.name,
      config: effectiveConfig(type, row.config), location: locationOf(row), radius_meters: row.radius_meters,
      points: points.map((p) => ({ id: p.id, point_id: p.point_id, name: p.name, description: p.description, image_url: p.image_url, reward_url: p.reward_url, latitude: p.latitude, longitude: p.longitude })),
    };
  }));
}

function recordProjection(row: { id: string; activity_id: string; placement_id: string; content: string | null; metadata: unknown; render_config: unknown; longitude: number | null; latitude: number | null; created_at: Date | string }) {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const render = isRecord(row.render_config) ? row.render_config : {};
  const attributes = { ...(isRecord(metadata.attributes) ? metadata.attributes : metadata) };
  delete attributes.submission_hash;
  delete attributes.channel;
  return { id: row.id, activity_id: row.activity_id, activity_placement_id: row.placement_id,
    file_type: "text", file_url: null, text_content: row.content,
    metadata: { ...attributes, ...(isRecord(render.display) ? render.display : {}), ...(row.longitude === null ? {} : { longitude: row.longitude, latitude: row.latitude }) },
    config: isRecord(render.config) ? render.config : {}, is_huge: false, create_at: toIsoRequired(row.created_at) };
}

export async function publicDanmaku(scope: ActivityScope, options: { placementId?: string; location?: ActivityLocation; radius?: number } = {}) {
  let query = publicQuery(db, scope).innerJoin("activity_record as r", "r.placement_id", "p.id")
    .clearSelect().select(["r.id", "r.activity_id", "r.placement_id", "r.content", "r.metadata", "r.render_config", "r.created_at",
      sql<number | null>`ST_X(r.location)`.as("longitude"), sql<number | null>`ST_Y(r.location)`.as("latitude")])
    .where("r.kind", "=", "danmaku").where("r.status", "=", "visible").where("a.type", "=", "danmaku");
  if (options.placementId) query = query.where("p.id", "=", options.placementId);
  if (options.location) {
    const point = locationSql(options.location);
    query = query.where(sql<boolean>`ST_DWithin(r.location::geography, ${point}::geography, ${options.radius ?? 5000}::float8)`)
      .orderBy(sql`ST_Distance(r.location::geography, ${point}::geography)`);
  }
  const rows = await query.orderBy("r.created_at", "desc").limit(500).execute();
  return rows.map((row) => ({ ...recordProjection(row),
    ...(options.location && row.longitude !== null && row.latitude !== null ? { distance: distanceMeters(options.location, { longitude: row.longitude, latitude: row.latitude }) } : {}) }));
}

async function lockPublicPlacement(trx: Trx, id: string) {
  const initial = await publicQuery(trx, { workspaceId: null, organizationId: null }).where("p.id", "=", id).executeTakeFirst();
  if (!initial) throw notFound("活动投放不存在或未启用");
  // Use the same order as management writes; check again after acquiring locks.
  await trx.selectFrom("organization").select("id").where("id", "=", initial.organization_id).forShare().execute();
  await trx.selectFrom("workspace").select("id").where("id", "=", initial.workspace_id).forShare().execute();
  await trx.selectFrom("activity").select("id").where("id", "=", initial.activity_id).forShare().execute();
  await trx.selectFrom("activity_placement").select("id").where("id", "=", id).forShare().execute();
  const row = await publicQuery(trx, { workspaceId: null, organizationId: null }).where("p.id", "=", id).executeTakeFirst();
  if (!row) throw notFound("活动投放不存在或未启用");
  return row;
}

export function parseParticipant(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw invalid("participant_id 必须是有效的设备参与标识");
  return value;
}

export interface Submission {
  placementId: string; kind: "danmaku" | "checkin"; pointId: string | null; participantId: string | null;
  content: string | null; location: ActivityLocation | null; idempotencyKey: string | null;
}

export function parseSubmission(value: unknown): Submission {
  const body = requireRecordBody(value);
  rejectUnknown(body, ["placement_id", "kind", "point_id", "participant_id", "content", "user_lat", "user_lng", "idempotency_key"]);
  const kind = requireEnum(body.kind, "kind", ["danmaku", "checkin"]);
  const pointId = optionalUuid(body.point_id, "point_id") ?? null;
  if (kind === "checkin" && !pointId) throw invalid("打卡需要 point_id");
  if (kind === "danmaku" && pointId) throw invalid("弹幕不关联打卡点");
  if (kind === "checkin" && body.content != null) throw invalid("打卡不接受留言内容");
  const location = parseLocation({ longitude: body.user_lng, latitude: body.user_lat });
  return { placementId: requireUuid(body.placement_id, "placement_id"), kind, pointId,
    participantId: parseParticipant(body.participant_id), content: kind === "danmaku" ? requireString(body.content, "content", { max: 500 }) : null,
    location, idempotencyKey: requireIdempotencyKey(body.idempotency_key) };
}
function requireRecordBody(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw invalid("请求体必须是对象"); return value; }

export async function submitActivityRecord(input: Submission) {
  return contentTransaction(async (trx) => {
    const placement = await lockPublicPlacement(trx, input.placementId);
    const type: ActivityType = requireEnum(placement.type, "type", ["shop_checkin", "danmaku"]);
    if ((input.kind === "checkin") !== (type === "shop_checkin")) throw invalid("记录类型与活动类型不匹配");
    const config = effectiveConfig(type, placement.config);
    const center = locationOf(placement);
    if (center && placement.radius_meters !== null && (!input.location || distanceMeters(center, input.location) > placement.radius_meters)) throw invalid("不在活动范围内");
    if (input.kind === "danmaku" && (!input.content || input.content.length > (config.maxLength ?? DEFAULT_DANMAKU_MAX_LENGTH))) throw invalid(`留言最多 ${config.maxLength ?? DEFAULT_DANMAKU_MAX_LENGTH} 字`);
    const fingerprint = requestHash(input);
    if (input.participantId) {
      await lockKeys(trx, [`activity-record:${placement.id}:${input.participantId}`]);
      if (input.idempotencyKey) {
        const replay = await trx.selectFrom("activity_record").selectAll().where("placement_id", "=", placement.id).where("participant_id", "=", input.participantId)
          .where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
        if (replay) {
          if (!isRecord(replay.metadata) || replay.metadata.submission_hash !== fingerprint) throw new ContentError("IDEMPOTENCY_CONFLICT", "请求标识已用于另一条记录");
          if (replay.status === "hidden") throw invalid("该记录已被隐藏，请联系活动管理员");
          return { id: replay.id, activity_id: replay.activity_id, placement_id: replay.placement_id, point_id: replay.point_id, kind: replay.kind, created_at: toIsoRequired(replay.created_at) };
        }
      }
    }
    if (input.kind === "checkin") {
      if (!input.participantId || !input.pointId || !input.location) throw invalid("打卡需要参与标识、打卡点和位置");
      const point = await trx.selectFrom("activity_point")
        .select(["id", sql<number | null>`ST_X(location)`.as("longitude"), sql<number | null>`ST_Y(location)`.as("latitude")])
        .where("activity_id", "=", placement.activity_id).where("id", "=", input.pointId).where("state", "=", "active").executeTakeFirst();
      const target = point ? locationOf(point) : null;
      if (!target) throw invalid("打卡点尚未设置位置或未启用");
      if (distanceMeters(target, input.location) > (config.checkinRadiusMeters ?? 50)) throw invalid("距离打卡点太远，请靠近后再试");
      const existing = await trx.selectFrom("activity_record").selectAll().where("placement_id", "=", placement.id).where("participant_id", "=", input.participantId)
        .where("point_id", "=", input.pointId).where("kind", "=", "checkin").executeTakeFirst();
      if (existing) {
        if (existing.status === "hidden") throw invalid("该打卡记录已被隐藏，请联系活动管理员");
        return { id: existing.id, activity_id: existing.activity_id, placement_id: existing.placement_id, point_id: existing.point_id, kind: existing.kind, created_at: toIsoRequired(existing.created_at) };
      }
    }
    const row = await trx.insertInto("activity_record").values({ activity_id: placement.activity_id, placement_id: placement.id, organization_id: placement.organization_id,
      point_id: input.pointId, participant_id: input.participantId, kind: input.kind, content: input.content, location: locationSql(input.location), status: "visible",
      idempotency_key: input.idempotencyKey, metadata: JSON.stringify({ submission_hash: fingerprint, channel: "miniapp" }) }).returning(["id", "created_at"]).executeTakeFirstOrThrow();
    await audit(trx, { organizationId: placement.organization_id, workspaceId: placement.workspace_id, actorId: null, action: `activity.${input.kind}`, objectType: "activity_record", objectId: row.id });
    return { id: row.id, activity_id: placement.activity_id, placement_id: placement.id, point_id: input.pointId, kind: input.kind, created_at: toIsoRequired(row.created_at),
      ...(input.kind === "danmaku" ? { file_type: "text", text_content: input.content, metadata: input.location } : {}) };
  });
}

export async function activityProgress(placementId: string, participantId: string) {
  const placement = await publicQuery(db, { workspaceId: null, organizationId: null }).where("p.id", "=", placementId).where("a.type", "=", "shop_checkin").executeTakeFirst();
  if (!placement) throw notFound("活动投放不存在或未启用");
  const rows = await db.selectFrom("activity_record as r").innerJoin("activity_point as point", "point.id", "r.point_id")
    .select("r.point_id").where("r.placement_id", "=", placementId).where("r.activity_id", "=", placement.activity_id)
    .where("r.participant_id", "=", parseParticipant(participantId)).where("r.kind", "=", "checkin")
    .where("r.status", "=", "visible").where("point.state", "=", "active").execute();
  return { point_ids: rows.map((row) => row.point_id) };
}
