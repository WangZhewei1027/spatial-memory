import { asFileType, loadAssetContents, primaryResource } from "@/lib/assets/dto.server";
import type { AssetContentDto } from "@/lib/content-model/contracts";
import { type Executor } from "@/lib/content-model/tx.server";
import { db, sql } from "@/lib/db";
import { parseLinkAssetInput, type LinkAssetData } from "@/lib/link-asset";
import { compileSceneManifest } from "@/lib/scene/compile";
import { isSceneResourceKind, type SceneAssetManifest } from "@/lib/scene/protocol";
import "server-only";
import { resolvePlacementContent } from "./content.server";
import { renderConfigOf } from "./core.server";

/** Public discovery and playback resolve active placements with current saved content. */

export interface RuntimeScope {
  workspaceId: string | null;
  organizationId: string | null;
}

interface RuntimeRow {
  id: string;
  workspace_id: string;
  organization_id: string;
  name: string | null;
  asset_id: string | null;
  scene_id: string | null;
  anchor_id: string | null;
  render_config: unknown;
  altitude: number | null;
  created_at: Date;
  longitude: number | null;
  latitude: number | null;
  public_id: string;
}

/** Only active placements in open teams and collections are public. */
function runtimeQuery(exec: Executor, scope: RuntimeScope) {
  let query = exec
    .selectFrom("placement as p")
    .innerJoin("workspace as w", "w.id", "p.workspace_id")
    .innerJoin("organization as o", "o.id", "p.organization_id")
    .select([
      "p.id",
      "p.workspace_id",
      "p.organization_id",
      "p.name",
      "p.asset_id",
      "p.scene_id",
      "p.anchor_id",
      "p.render_config",
      "p.altitude",
      "p.created_at",
      sql<number | null>`ST_X(p.location)`.as("longitude"),
      sql<number | null>`ST_Y(p.location)`.as("latitude"),
      "p.id as public_id",
    ])
    .where("p.status", "=", "active")
    .where("o.archived_at", "is", null)
    .where("w.archived_at", "is", null);
  if (scope.organizationId) query = query.where("p.organization_id", "=", scope.organizationId);
  if (scope.workspaceId) query = query.where("p.workspace_id", "=", scope.workspaceId);
  return query;
}

interface ProjectionContext {
  contents: Map<string, AssetContentDto>;
  fileTypes: Map<string, string>;
}

async function projectionContext(exec: Executor, rows: RuntimeRow[]): Promise<ProjectionContext> {
  const assetIdsToLoad = rows.map((r) => r.asset_id).filter((id): id is string => !!id);
  const assetIds = rows.map((r) => r.asset_id).filter((id): id is string => !!id);
  const [contents, assets] = await Promise.all([
    loadAssetContents(exec, assetIdsToLoad),
    assetIds.length ? exec.selectFrom("asset").select(["id", "file_type"]).where("id", "in", [...new Set(assetIds)]).execute() : Promise.resolve([]),
  ]);
  return { contents, fileTypes: new Map(assets.map((a) => [a.id, a.file_type])) };
}

function scalarRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function linkData(url: string): LinkAssetData | null {
  try {
    return parseLinkAssetInput(url);
  } catch {
    return null;
  }
}

/** Map the saved content and placement presentation to the mini-program protocol. */
function placementContent(row: RuntimeRow, ctx: ProjectionContext) {
  const render = renderConfigOf(row.render_config);
  const location = row.longitude !== null && row.latitude !== null ? { longitude: row.longitude, latitude: row.latitude, height: row.altitude ?? undefined } : {};
  if (!row.asset_id) {
    return {
      file_type: "scene",
      file_url: null as string | null,
      text_content: null as string | null,
      metadata: { ...scalarRecord(render.display), ...location } as Record<string, unknown>,
      config: { ...scalarRecord(render.config) } as Record<string, unknown>,
      is_huge: false,
      name: row.name,
    };
  }
  const content = ctx.contents.get(row.asset_id);
  const fileType = asFileType(ctx.fileTypes.get(row.asset_id ?? "") ?? content?.payload.kind ?? "document");
  const payload = content?.payload;
  const metadata: Record<string, unknown> = {
    ...scalarRecord(payload?.attributes),
    ...scalarRecord(render.display),
    ...location,
  };
  const config: Record<string, unknown> = { ...scalarRecord(render.config) };
  let fileUrl = primaryResource(content)?.url ?? null;
  let text: string | null = null;
  const name = row.name;
  if (payload?.kind === "text" || payload?.kind === "anchor") text = payload.text ?? text;
  if (payload?.kind === "link") {
    // Link protocol: config.link = LinkAssetData, file_url = preview.
    const link = linkData(payload.url);
    if (link && !scalarRecord(config.link).originalUrl) config.link = link;
    fileUrl = content?.resources.find((r) => r.role === "thumbnail")?.url ?? fileUrl ?? link?.previewUrl ?? null;
  }
  const isHuge = render.is_huge === true;
  return { file_type: fileType, file_url: fileUrl, text_content: text, metadata, config, is_huge: isHuge && fileType === "model", name };
}

async function tagIdsFor(exec: Executor, rows: RuntimeRow[]): Promise<Map<string, string[]>> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return new Map();
  const own = await exec.selectFrom("placement_tag").select(["placement_id", "tag_id"]).where("placement_id", "in", ids).execute();
  const out = new Map<string, string[]>();
  for (const row of rows) out.set(row.id, own.filter((t) => t.placement_id === row.id).map((t) => t.tag_id));
  return out;
}

// ───────────────────────── endpoints ─────────────────────────

export async function nearbyPlacements(scope: RuntimeScope, lat: number, lng: number, radius: number) {
  const point = sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
  const rows = await runtimeQuery(db, scope)
      .where("p.location", "is not", null)
      .where(sql<boolean>`ST_DWithin(p.location::geography, ${point}, ${radius}::float8)`)
      .select(sql<number>`ST_Distance(p.location::geography, ${point})`.as("distance"))
      .orderBy("distance")
      .execute();
  const ctx = await projectionContext(db, rows);
  return rows.map((row) => {
    const c = placementContent(row, ctx);
    return { id: row.public_id, anchor_id: row.anchor_id, file_type: c.file_type, file_url: c.file_url, text_content: c.text_content, metadata: c.metadata, config: c.config, is_huge: c.is_huge, distance: Number(row.distance) };
  });
}

export async function hugePlacements(scope: RuntimeScope) {
  const rows = await runtimeQuery(db, scope).where("p.location", "is not", null).where("p.asset_id", "is not", null).execute();
  const ctx = await projectionContext(db, rows);
  return rows.flatMap((row) => {
    const c = placementContent(row, ctx);
    if (!c.is_huge || c.file_type !== "model") return [];
    return [{ id: row.public_id, anchor_id: row.anchor_id, file_type: c.file_type, file_url: c.file_url, text_content: c.text_content, metadata: c.metadata, config: c.config, latitude: row.latitude, longitude: row.longitude }];
  });
}

/** Content attached to a recognized anchor in a project. */
export async function anchorPlacements(workspaceId: string, anchorId: string) {
  const rows = await runtimeQuery(db, { workspaceId, organizationId: null }).where("p.anchor_id", "=", anchorId).orderBy("p.id").execute();
  const [ctx, tags] = await Promise.all([projectionContext(db, rows), tagIdsFor(db, rows)]);
  return rows.map((row) => {
    const c = placementContent(row, ctx);
    return {
      id: row.public_id,
      name: c.name,
      file_type: c.file_type,
      file_url: c.file_url,
      text_content: c.text_content,
      anchor_id: row.anchor_id,
      tag_ids: tags.get(row.id) ?? [],
      metadata: c.metadata,
      is_huge: c.is_huge,
      config: c.config,
    };
  });
}

export class RuntimeNotFound extends Error {}

/**
 * Compiled schema-2 manifest of a saved scene placement, resolved by the
 * discovery id the client already has. `manifest.assetId` echoes that id.
 */
export async function sceneManifest(publicId: string, scope: RuntimeScope): Promise<SceneAssetManifest> {
  const id = publicId.toLowerCase();
  const rows = await runtimeQuery(db, scope)
    .where("p.scene_id", "is not", null)
    .where("p.id", "=", id)
    .limit(2)
    .execute();
  if (rows.length !== 1 || !rows[0].scene_id) throw new RuntimeNotFound("场景素材不存在");
  const content = await resolvePlacementContent(db, { kind: "scene", sceneId: rows[0].scene_id });
  if (!content || content.kind !== "scene") throw new RuntimeNotFound("场景素材不存在");
  const resources: SceneAssetManifest["resources"] = {};
  for (const resource of content.resources) {
    if (!resource.url) throw new RuntimeNotFound("场景资源文件缺失");
    if (!isSceneResourceKind(resource.file_type)) throw new RuntimeNotFound("场景素材类型不受支持");
    resources[resource.resource_alias] = { assetId: resource.asset_id, url: resource.url, kind: resource.file_type };
  }
  try {
    return compileSceneManifest(publicId, content.document, resources);
  } catch {
    throw new RuntimeNotFound("场景资源文件缺失");
  }
}

/** Direct QR preview: saved scene in an active team, without a map placement. */
export async function previewSceneManifest(sceneId: string, organizationId: string): Promise<SceneAssetManifest> {
  const visible = await db.selectFrom("scene as s").innerJoin("organization as o", "o.id", "s.organization_id")
    .select("s.id").where("s.id", "=", sceneId).where("s.organization_id", "=", organizationId)
    .where("s.state", "=", "active").where("o.archived_at", "is", null).executeTakeFirst();
  if (!visible) throw new RuntimeNotFound("场景不存在或已归档");
  const content = await resolvePlacementContent(db, { kind: "scene", sceneId });
  if (!content || content.kind !== "scene") throw new RuntimeNotFound("场景不存在");
  const resources: SceneAssetManifest["resources"] = {};
  for (const resource of content.resources) {
    if (!resource.url) throw new RuntimeNotFound("场景资源文件缺失");
    if (!isSceneResourceKind(resource.file_type)) throw new RuntimeNotFound("场景素材类型不受支持");
    resources[resource.resource_alias] = { assetId: resource.asset_id, url: resource.url, kind: resource.file_type };
  }
  return compileSceneManifest(sceneId, content.document, resources);
}

// ───────────────────────── anonymous text ─────────────────────────
