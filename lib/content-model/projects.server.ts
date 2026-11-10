import { db, sql } from "@/lib/db";
import "server-only";
import {
  loadOrgWorkspaceAccess,
  requireOrgRead,
  requireOrgWrite,
  requireWorkspaceEdit,
  requireWorkspaceManage,
  requireWorkspaceRead,
  type Actor,
  type OrgInfo,
  type WorkspaceAccess
} from "./access.server";
import {
  type CollectionDto,
  type LibraryListQuery
} from "./contracts";
import { archived, checkLockVersion, notFound } from "./errors";
import { optionalInt, optionalString, rejectUnknown, requireString, type JsonRecord } from "./input";
import { parseCollectionMiniappConfig } from "./collection-config";
import { audit, toIso, type Trx } from "./tx.server";

// Map collections (workspace rows): create, rename, archive, and the
// archive state. Collections own placements
// only; they carry no membership and never contain or change team assets or
// scenes. Every team writer manages them (team workbench contract §1).

export function workspaceDto(access: WorkspaceAccess): CollectionDto {
  return {
    id: access.workspace.id,
    name: access.workspace.name,
    description: access.workspace.description,
    organization_id: access.workspace.organization_id,
    create_date: toIso(access.workspace.create_date),
    archived_at: toIso(access.workspace.archived_at),
    capabilities: access.capabilities,
    miniapp_config: parseCollectionMiniappConfig(access.workspace.miniapp_config),
    config_lock_version: access.workspace.config_lock_version,
  };
}

// ───────────────────────── collections ─────────────────────────

/** Serialize collection writes against team archival. */
async function lockOrgForCollections(trx: Trx, organizationId: string): Promise<OrgInfo> {
  const row = await trx
    .selectFrom("organization")
    .select(["id", "name", "archived_at"])
    .where("id", "=", organizationId)
    .forShare()
    .executeTakeFirst();
  if (!row) throw notFound("组织不存在");
  if (row.archived_at) throw archived("组织已归档，内容只读");
  return row;
}

function parseCollectionFields(body: JsonRecord, requireName: boolean): { name?: string; description?: string | null } {
  rejectUnknown(body, requireName ? ["name", "description"] : ["name", "description", "miniappConfig", "expectedLockVersion"]);
  const name = body.name === undefined && !requireName ? undefined : requireString(body.name, "name", { max: 200 });
  const description = optionalString(body.description, "description", { max: 1000 });
  return { name, description };
}

/** GET /api/organizations/[id]/collections: every collection of the team (newest first). */
export async function listCollections(actor: Actor, organizationId: string, opts: LibraryListQuery = {}): Promise<CollectionDto[]> {
  await requireOrgRead(db, actor, organizationId);
  const rows = await loadOrgWorkspaceAccess(db, actor, organizationId, { ...opts, state: opts.state ?? "active" });
  return rows.map(workspaceDto);
}

export async function getCollection(actor: Actor, workspaceId: string): Promise<CollectionDto> {
  return workspaceDto(await requireWorkspaceRead(db, actor, workspaceId));
}

/** POST /api/organizations/[id]/collections { name, description? } (any team writer). */
export async function createCollection(actor: Actor, organizationId: string, body: JsonRecord): Promise<CollectionDto> {
  const fields = parseCollectionFields(body, true);
  await requireOrgWrite(db, actor, organizationId);
  const id = await db.transaction().execute(async (trx) => {
    await lockOrgForCollections(trx, organizationId);
    const row = await trx
      .insertInto("workspace")
      .values({ name: fields.name!, description: fields.description ?? null, organization_id: organizationId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await audit(trx, { organizationId, actorId: actor.userId, action: "workspace.create", objectType: "workspace", objectId: row.id, workspaceId: row.id });
    return row.id;
  });
  return getCollection(actor, id);
}

/** PATCH an open collection. Settings require their own optimistic configuration version. */
export async function updateCollection(actor: Actor, workspaceId: string, body: JsonRecord): Promise<CollectionDto> {
  const fields = parseCollectionFields(body, false);
  const config = body.miniappConfig === undefined ? undefined : parseCollectionMiniappConfig(body.miniappConfig);
  const expected = optionalInt(body.expectedLockVersion, "expectedLockVersion", 1);
  const access = await requireWorkspaceEdit(db, actor, workspaceId);
  const changes: { name?: string; description?: string | null; miniapp_config?: string; config_lock_version?: number } = {};
  if (fields.name !== undefined && fields.name !== access.workspace.name) changes.name = fields.name;
  if (fields.description !== undefined && fields.description !== access.workspace.description) changes.description = fields.description;
  if (Object.keys(changes).length || config) {
    await db.transaction().execute(async (trx) => {
      await lockOrgForCollections(trx, access.workspace.organization_id);
      const row = await trx.selectFrom("workspace").select(["archived_at", "miniapp_config", "config_lock_version"]).where("id", "=", workspaceId).forUpdate().executeTakeFirst();
      if (!row) throw notFound("合集不存在");
      if (row.archived_at) throw archived("合集已归档，请先恢复");
      if (config) {
        checkLockVersion(expected, row.config_lock_version, "地图设置");
        changes.miniapp_config = JSON.stringify(config);
        changes.config_lock_version = row.config_lock_version + 1;
      }
      await trx.updateTable("workspace").set(changes).where("id", "=", workspaceId).execute();
      await audit(trx, {
        organizationId: access.workspace.organization_id,
        actorId: actor.userId,
        action: "workspace.update",
        objectType: "workspace",
        objectId: workspaceId,
        workspaceId,
        details: { changes, before: { name: access.workspace.name, description: access.workspace.description, ...(config ? { miniapp_config: row.miniapp_config } : {}) } },
      });
    });
  }
  return getCollection(actor, workspaceId);
}

/**
 * Archive (the default "delete" of a collection) or restore; any team
 * writer. Archiving only freezes the collection's placements and stops their
 * public entries; team assets and scenes are untouched.
 */
export async function setWorkspaceArchived(actor: Actor, workspaceId: string, archive: boolean): Promise<CollectionDto> {
  const access = await requireWorkspaceManage(db, actor, workspaceId);
  await db.transaction().execute(async (trx) => {
    await lockOrgForCollections(trx, access.workspace.organization_id);
    const row = await trx.selectFrom("workspace").select("archived_at").where("id", "=", workspaceId).forUpdate().executeTakeFirst();
    if (!row) throw notFound("合集不存在");
    if (!!row.archived_at === archive) return;
    await trx
      .updateTable("workspace")
      .set(archive ? { archived_at: sql<Date>`now()`, archived_by: actor.userId } : { archived_at: null, archived_by: null })
      .where("id", "=", workspaceId)
      .execute();
    await audit(trx, {
      organizationId: access.workspace.organization_id,
      actorId: actor.userId,
      action: archive ? "workspace.archive" : "workspace.restore",
      objectType: "workspace",
      objectId: workspaceId,
      workspaceId,
    });
  });
  return getCollection(actor, workspaceId);
}
