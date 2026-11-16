import "server-only";
import { db, sql } from "@/lib/db";
import { insertSceneTx, parseDocument } from "@/lib/scene/service.server";
import { insertPlacementTx, resolveTargetForWrite } from "@/lib/placements/core.server";
import { lockObjectKeys } from "@/lib/storage/retention.server";
import { mediaKeysInText } from "@/lib/storage/public-url";
import {
  lockOrgForWrite, lockWorkspaceForWrite, requireOrgWrite, requireWorkspaceEdit,
  type Actor, type OrgAccess, type WorkspaceAccess,
} from "./access.server";
import type { PlacementRenderConfig, PlacementStatus } from "./contracts";
import {
  DUPLICATE_CONTENT_SOURCE_TYPES,
  type DuplicateContentRequest, type DuplicateContentResult, type DuplicateContentSourceType,
} from "./duplicate-contracts";
import { archived, forbidden, invalid, notFound } from "./errors";
import { rejectUnknown, requireEnum, requireIdempotencyKey, requireString, requireUuid, type JsonRecord } from "./input";
import { audit, claimIdempotency, declareWriter, lockKeys, recordIdempotency, requestHash, type Trx } from "./tx.server";

const SOURCE_TABLES = { asset: "asset", scene: "scene", activity: "activity", collection: "workspace", placement: "placement" } as const;

function parseRequest(body: JsonRecord): DuplicateContentRequest {
  rejectUnknown(body, ["sourceType", "sourceId", "targetOrganizationId", "targetWorkspaceId", "name", "idempotencyKey"]);
  const sourceType = requireEnum(body.sourceType, "sourceType", DUPLICATE_CONTENT_SOURCE_TYPES);
  const targetWorkspaceId = body.targetWorkspaceId === undefined ? undefined : requireUuid(body.targetWorkspaceId, "targetWorkspaceId");
  if (sourceType === "placement" && !targetWorkspaceId) throw invalid("复制投放需要指定目标合集");
  if ((sourceType === "collection" || sourceType === "activity") && targetWorkspaceId) throw invalid("该内容类型不接受目标合集");
  return {
    sourceType, sourceId: requireUuid(body.sourceId, "sourceId"),
    targetOrganizationId: requireUuid(body.targetOrganizationId, "targetOrganizationId"), targetWorkspaceId,
    ...(body.name === undefined ? {} : { name: requireString(body.name, "name", { max: 200 }) }),
    idempotencyKey: requireIdempotencyKey(body.idempotencyKey),
  };
}

/** One request owns these maps: shared dependencies get exactly one new identity. */
class DuplicateGraph {
  private readonly assets = new Map<string, string>();
  private readonly scenes = new Map<string, string>();
  private readonly activities = new Map<string, string>();
  private readonly placements = new Map<string, string>();
  private readonly tags = new Map<string, string>();
  private readonly visitingPlacements = new Set<string>();

  constructor(
    private readonly trx: Trx,
    private readonly actor: Actor,
    private readonly sourceOrganizationId: string,
    private readonly target: OrgAccess,
    private workspace: WorkspaceAccess | undefined,
  ) {}

  private assertSource(row: { organization_id: string; state?: string; status?: string; archived_at?: Date | null } | undefined) {
    if (!row || row.organization_id !== this.sourceOrganizationId) throw notFound("来源内容不存在或不属于来源组织");
    if (row.state === "archived" || row.status === "archived" || row.archived_at) throw archived("来源内容或其依赖已归档，请先恢复后再复制");
  }

  private async log(type: DuplicateContentSourceType, sourceId: string, id: string) {
    await audit(this.trx, {
      organizationId: this.target.org.id, actorId: this.actor.userId, action: "content.duplicate",
      objectType: SOURCE_TABLES[type], objectId: id, workspaceId: this.workspace?.workspace.id ?? null,
      details: { source_type: type, source_id: sourceId, source_organization_id: this.sourceOrganizationId },
    });
  }

  async asset(sourceId: string, name?: string): Promise<string> {
    const previous = this.assets.get(sourceId);
    if (previous) return previous;
    const source = await this.trx.selectFrom("asset").selectAll().where("id", "=", sourceId).forShare().executeTakeFirst();
    this.assertSource(source);
    if (!source) throw notFound();
    const resources = await this.trx.selectFrom("asset_resource").selectAll().where("asset_id", "=", sourceId).execute();
    // No upload receipt or same-team fromAssetId bypass is exposed. Only this
    // privileged operation can copy already-authorized stored resources.
    await lockObjectKeys(this.trx, [
      ...resources.flatMap((resource) => resource.storage_key ? [resource.storage_key] : []),
      ...mediaKeysInText(JSON.stringify(source.payload)),
    ]);
    const created = await this.trx.insertInto("asset").values({
      organization_id: this.target.org.id, origin_workspace_id: this.workspace?.workspace.id ?? null,
      name: name ?? source.name, file_type: source.file_type, payload: JSON.stringify(source.payload),
      visibility: source.visibility, origin: "team_upload", state: "active",
      maintained_by: this.actor.userId, created_by: this.actor.userId,
    }).returning("id").executeTakeFirstOrThrow();
    if (resources.length) await this.trx.insertInto("asset_resource").values(resources.map((resource) => ({ ...resource, asset_id: created.id }))).execute();
    // Anchor descriptors are derived caches tied to the old identity/generation;
    // its reference images above are sufficient for rebuilding on the new asset.
    this.assets.set(sourceId, created.id);
    await this.log("asset", sourceId, created.id);
    return created.id;
  }

  async scene(sourceId: string, name?: string): Promise<string> {
    const previous = this.scenes.get(sourceId);
    if (previous) return previous;
    const source = await this.trx.selectFrom("scene").selectAll().where("id", "=", sourceId).forShare().executeTakeFirst();
    this.assertSource(source);
    if (!source) throw notFound();
    const document = structuredClone(parseDocument(source.document));
    for (const id of [...new Set(Object.values(document.content.assets).map((ref) => ref.assetId.toLowerCase()))].sort()) await this.asset(id);
    for (const ref of Object.values(document.content.assets)) ref.assetId = this.assets.get(ref.assetId.toLowerCase())!;
    const id = await insertSceneTx(this.trx, this.actor, this.target, {
      name: name ?? source.name, document, workspaceId: this.workspace?.workspace.id ?? null,
    });
    this.scenes.set(sourceId, id);
    await this.log("scene", sourceId, id);
    return id;
  }

  async activity(sourceId: string, name?: string): Promise<string> {
    const previous = this.activities.get(sourceId);
    if (previous) return previous;
    const source = await this.trx.selectFrom("activity").selectAll().where("id", "=", sourceId).forShare().executeTakeFirst();
    this.assertSource(source);
    if (!source) throw notFound();
    const points = await this.trx.selectFrom("activity_point").selectAll().where("activity_id", "=", sourceId).orderBy("id").execute();
    const assetIds = [...new Set(points.flatMap((point) => [point.image_asset_id, point.reward_asset_id].filter((id): id is string => !!id)))].sort();
    for (const id of assetIds) {
      await this.asset(id);
      const asset = await this.trx.selectFrom("asset").select("file_type").where("id", "=", id).executeTakeFirstOrThrow();
      if (asset.file_type !== "image") throw invalid("打卡点图片与奖励图必须使用图片素材");
    }
    const created = await this.trx.insertInto("activity").values({
      organization_id: this.target.org.id, type: source.type, name: name ?? source.name,
      description: source.description, config: JSON.stringify(source.config),
      // PostgreSQL's stored EWKB is passed back as a typed geometry parameter.
      location: source.location === null ? null : sql<string>`${source.location}::geometry`, radius_meters: source.radius_meters,
      state: "active", created_by: this.actor.userId, updated_by: this.actor.userId,
    }).returning("id").executeTakeFirstOrThrow();
    if (points.length) await this.trx.insertInto("activity_point").values(points.map((point) => ({
      activity_id: created.id, organization_id: this.target.org.id, name: point.name, description: point.description,
      ordinal: point.ordinal, state: point.state,
      image_asset_id: point.image_asset_id ? this.assets.get(point.image_asset_id)! : null,
      reward_asset_id: point.reward_asset_id ? this.assets.get(point.reward_asset_id)! : null,
      location: point.location === null ? null : sql<string>`${point.location}::geometry`,
    }))).execute();
    this.activities.set(sourceId, created.id);
    await this.log("activity", sourceId, created.id);
    return created.id;
  }

  private async tag(sourceId: string): Promise<string> {
    const previous = this.tags.get(sourceId);
    if (previous) return previous;
    if (!this.workspace) throw invalid("复制标签需要目标合集");
    const source = await this.trx.selectFrom("tag as t").innerJoin("workspace as w", "w.id", "t.workspace_id")
      .selectAll("t").select("w.organization_id").where("t.id", "=", sourceId).executeTakeFirst();
    this.assertSource(source);
    if (!source) throw notFound();
    // Tag names are unique per collection. Keep existing destination labels
    // untouched and choose an available name for an independent copied label.
    await lockKeys(this.trx, [`duplicate-tags:${this.workspace.workspace.id}`]);
    const existing = await this.trx.selectFrom("tag").select("name").where("workspace_id", "=", this.workspace.workspace.id).execute();
    const names = new Set(existing.map((tag) => tag.name));
    let name = source.name;
    for (let suffix = 2; names.has(name); suffix++) name = `${source.name} (${suffix})`;
    const created = await this.trx.insertInto("tag").values({
      workspace_id: this.workspace.workspace.id, name, color: source.color, created_by: this.actor.userId,
    }).returning("id").executeTakeFirstOrThrow();
    this.tags.set(sourceId, created.id);
    return created.id;
  }

  async placement(sourceId: string, name?: string): Promise<string> {
    const previous = this.placements.get(sourceId);
    if (previous) return previous;
    if (!this.workspace) throw invalid("复制投放需要目标合集");
    if (this.visitingPlacements.has(sourceId)) throw invalid("来源识别目标挂载关系形成循环，无法复制");
    this.visitingPlacements.add(sourceId);
    const source = await this.trx.selectFrom("placement").selectAll()
      .select([sql<number | null>`ST_X(location)`.as("longitude"), sql<number | null>`ST_Y(location)`.as("latitude")])
      .where("id", "=", sourceId).forShare().executeTakeFirst();
    this.assertSource(source);
    if (!source) throw notFound();
    const sourceWorkspace = await requireWorkspaceEdit(this.trx, this.actor, source.workspace_id);
    await lockWorkspaceForWrite(this.trx, sourceWorkspace);
    let anchorId: string | null = null;
    if (source.anchor_id) {
      anchorId = await this.asset(source.anchor_id);
      const anchorPlacement = await this.trx.selectFrom("placement").select("id")
        .where("workspace_id", "=", source.workspace_id).where("asset_id", "=", source.anchor_id)
        .where("status", "=", "active").orderBy("id").executeTakeFirst();
      if (!anchorPlacement) throw invalid("来源识别目标必须已在来源合集中有效投放");
      await this.placement(anchorPlacement.id);
    }
    const target = source.asset_id
      ? { kind: "asset" as const, assetId: await this.asset(source.asset_id) }
      : source.scene_id ? { kind: "scene" as const, sceneId: await this.scene(source.scene_id) } : null;
    if (!target) throw invalid("来源投放没有内容");
    const sourceTags = await this.trx.selectFrom("placement_tag").select("tag_id").where("placement_id", "=", sourceId).orderBy("tag_id").execute();
    const tagIds: string[] = [];
    for (const tag of sourceTags) tagIds.push(await this.tag(tag.tag_id));
    const resolved = await resolveTargetForWrite(this.trx, this.actor, this.workspace, target);
    const id = await insertPlacementTx(this.trx, this.actor, this.workspace, resolved, {
      name: name ?? source.name,
      location: source.longitude === null || source.latitude === null ? null : {
        longitude: source.longitude, latitude: source.latitude, altitude: source.altitude,
      },
      anchorId, storedRenderConfig: source.render_config as PlacementRenderConfig,
      status: source.status as PlacementStatus, tagIds,
    });
    this.placements.set(sourceId, id);
    this.visitingPlacements.delete(sourceId);
    await this.log("placement", sourceId, id);
    return id;
  }

  async collection(sourceId: string, name?: string): Promise<string> {
    const source = await requireWorkspaceEdit(this.trx, this.actor, sourceId);
    this.assertSource(source.workspace);
    await lockWorkspaceForWrite(this.trx, source);
    const created = await this.trx.insertInto("workspace").values({
      organization_id: this.target.org.id, name: name ?? source.workspace.name,
      description: source.workspace.description, miniapp_config: JSON.stringify(source.workspace.miniapp_config),
    }).returning("id").executeTakeFirstOrThrow();
    this.workspace = await requireWorkspaceEdit(this.trx, this.actor, created.id);
    const tags = await this.trx.selectFrom("tag").select("id").where("workspace_id", "=", sourceId).orderBy("id").execute();
    for (const tag of tags) await this.tag(tag.id);
    const placements = await this.trx.selectFrom("placement").select("id").where("workspace_id", "=", sourceId)
      .where("status", "!=", "archived").orderBy("id").execute();
    for (const placement of placements) await this.placement(placement.id);
    const links = await this.trx.selectFrom("activity_placement").selectAll().where("workspace_id", "=", sourceId)
      .where("status", "!=", "archived").orderBy("id").forShare().execute();
    for (const link of links) {
      const activityId = await this.activity(link.activity_id);
      await this.trx.insertInto("activity_placement").values({
        activity_id: activityId, organization_id: this.target.org.id, workspace_id: created.id,
        status: "paused", created_by: this.actor.userId, updated_by: this.actor.userId,
      }).execute();
    }
    await this.log("collection", sourceId, created.id);
    return created.id;
  }
}

/** Only transient transaction conflicts can restart; business failures always roll back and return unchanged. */
function retryable(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if (error.code === "40001" || error.code === "40P01") return true;
  return error.code === "23505" && "constraint" in error
    && (error.constraint === "content_command_idempotency_pkey" || error.constraint === "tag_name_workspace_id_key");
}

export async function duplicateContent(actor: Actor, body: JsonRecord): Promise<DuplicateContentResult> {
  if (!actor.superAdmin) throw forbidden("只有超级管理员可以跨组织复制内容");
  const input = parseRequest(body);
  const scope = { actorId: actor.userId, command: "content.duplicate", key: input.idempotencyKey, hash: requestHash(input) };
  for (let attempt = 0; ; attempt++) {
    try {
      // A stable snapshot prevents a map or scene from mixing references read
      // before and after concurrent saves. Source share locks also protect the
      // stored files until the new graph commits under the retention locks.
      return await db.transaction().setIsolationLevel("repeatable read").execute(async (trx) => {
        await declareWriter(trx);
        const target = await requireOrgWrite(trx, actor, input.targetOrganizationId);
        await lockOrgForWrite(trx, target.org.id);
        const replay = await claimIdempotency(trx, scope);
        if (replay) return { id: replay, sourceType: input.sourceType, organizationId: target.org.id, created: false };
        const source = await trx.selectFrom(SOURCE_TABLES[input.sourceType]).select(["organization_id", "name"])
          .where("id", "=", input.sourceId).executeTakeFirst();
        if (!source) throw notFound("来源内容不存在");
        await requireOrgWrite(trx, actor, source.organization_id);
        await lockOrgForWrite(trx, source.organization_id);
        const workspace = input.targetWorkspaceId ? await requireWorkspaceEdit(trx, actor, input.targetWorkspaceId) : undefined;
        if (workspace && workspace.org.id !== target.org.id) throw invalid("目标合集必须属于目标组织");
        if (workspace) await lockWorkspaceForWrite(trx, workspace);
        const graph = new DuplicateGraph(trx, actor, source.organization_id, target, workspace);
        const name = input.name ?? `${(source.name ?? "内容").slice(0, 197)} 副本`;
        const id = await graph[input.sourceType](input.sourceId, name);
        await recordIdempotency(trx, scope, target.org.id, SOURCE_TABLES[input.sourceType], id);
        return { id, sourceType: input.sourceType, organizationId: target.org.id, created: true };
      });
    } catch (error) {
      if (attempt >= 2 || !retryable(error)) throw error;
    }
  }
}
