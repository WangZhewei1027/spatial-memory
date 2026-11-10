import {
  isSuperAdmin,
  orgRoleCanWrite,
  type OrgRole,
} from "@/lib/permissions";
import "server-only";
import type {
  AssetCapabilities,
  CollectionCapabilities,
  LibraryListQuery,
} from "./contracts";
import { nameContainsPattern } from "./input";
import { archived, forbidden, notFound } from "./errors";
import type { Executor, Trx } from "./tx.server";

/**
 * Shared server-side authorization (docs/team-workbench-backend-contract.md §1).
 * The organization (UI: 团队) is the only permission boundary: every member
 * reads all of its assets, scenes, collections and placements; owner, admin
 * and member write them; a viewer is read-only; ownership and team
 * administration stay with owner/admin. Workspace rows are map collections
 * that own placements. Asset visibility and maintained_by are metadata. Every route
 * resolves access through these helpers; UI capability flags are produced
 * from the same objects, never re-derived on the client.
 */

export interface Actor {
  userId: string;
  globalRole: string | null;
  superAdmin: boolean;
}

export async function loadActor(exec: Executor, userId: string): Promise<Actor> {
  const row = await exec.selectFrom("users").select("role").where("user_id", "=", userId).executeTakeFirst();
  const globalRole = row?.role ?? null;
  return { userId, globalRole, superAdmin: isSuperAdmin(globalRole) };
}

// ───────────────────────── organizations ─────────────────────────

export interface OrgInfo {
  id: string;
  name: string;
  archived_at: Date | null;
}

export interface OrgAccess {
  org: OrgInfo;
  orgRole: OrgRole | null;
  /** Any member (or super_admin): reads all team content. */
  canRead: boolean;
  /** Owner/admin (or super_admin): ownership and team administration. */
  canAdminister: boolean;
  /** Owner/admin/member (or super_admin): team content writer; viewer is read-only. */
  canWrite: boolean;
}

function asOrgRole(value: string | null | undefined): OrgRole | null {
  return value === "owner" || value === "admin" || value === "member" || value === "viewer" ? value : null;
}


function orgAccessFrom(actor: Actor, org: OrgInfo, role: string | null | undefined): OrgAccess {
  const orgRole = asOrgRole(role);
  return {
    org,
    orgRole,
    canRead: actor.superAdmin || orgRole !== null,
    canAdminister: actor.superAdmin || orgRole === "owner" || orgRole === "admin",
    canWrite: actor.superAdmin || orgRoleCanWrite(orgRole),
  };
}

export async function loadOrgAccess(exec: Executor, actor: Actor, orgId: string): Promise<OrgAccess | null> {
  const row = await exec
    .selectFrom("organization as o")
    .leftJoin("organization_member as m", (join) => join.onRef("m.organization_id", "=", "o.id").on("m.user_id", "=", actor.userId))
    .select(["o.id", "o.name", "o.archived_at", "m.role"])
    .where("o.id", "=", orgId)
    .executeTakeFirst();
  if (!row) return null;
  return orgAccessFrom(actor, {
    id: row.id,
    name: row.name,
    archived_at: row.archived_at,
  }, row.role);
}

export async function requireOrgRead(exec: Executor, actor: Actor, orgId: string): Promise<OrgAccess> {
  const access = await loadOrgAccess(exec, actor, orgId);
  if (!access) throw notFound("组织不存在");
  if (!access.canRead) throw forbidden();
  return access;
}

/** Writer role in an open organization; the content-model state is checked by the write transaction. */
export function assertOrgWritable(access: OrgAccess): void {
  if (access.org.archived_at) throw archived("组织已归档，内容只读");
  if (!access.canWrite) throw forbidden("组织查看者只能浏览团队内容");
}

export async function requireOrgWrite(exec: Executor, actor: Actor, orgId: string): Promise<OrgAccess> {
  const access = await requireOrgRead(exec, actor, orgId);
  assertOrgWritable(access);
  return access;
}

/** Short-lived share lock so a concurrent cutover/archive cannot interleave with a write. */
export async function lockOrgForWrite(trx: Trx, orgId: string): Promise<OrgInfo> {
  const row = await trx
    .selectFrom("organization")
    .select(["id", "name", "archived_at"])
    .where("id", "=", orgId)
    .forShare()
    .executeTakeFirst();
  if (!row) throw notFound("组织不存在");
  if (row.archived_at) throw archived("组织已归档，内容只读");
  return row;
}

// ───────────────────────── map collections (workspace rows) ─────────────────────────

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  create_date: Date | null;
  archived_at: Date | null;
  miniapp_config: unknown;
  config_lock_version: number;
}

export interface WorkspaceAccess extends OrgAccess {
  workspace: WorkspaceInfo;
  /** Team writer, collection and organization open: placements, tags, uploads into it, rename. */
  canEdit: boolean;
  /** Team writer in an open organization: archive and restore. */
  canManage: boolean;
  capabilities: CollectionCapabilities;
}

interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  create_date: Date | null;
  archived_at: Date | null;
  miniapp_config: unknown;
  config_lock_version: number;
  org_name: string;
  org_archived_at: Date | null;
  org_role: string | null;
}

function workspaceAccessFrom(actor: Actor, row: WorkspaceRow): WorkspaceAccess {
  const base = orgAccessFrom(actor, {
    id: row.organization_id,
    name: row.org_name,
    archived_at: row.org_archived_at,
  }, row.org_role);
  const canManage = base.canWrite && !row.org_archived_at;
  const canEdit = canManage && !row.archived_at;
  return {
    ...base,
    workspace: {
      id: row.id,
      name: row.name,
      description: row.description,
      organization_id: row.organization_id,
      create_date: row.create_date,
      archived_at: row.archived_at,
      miniapp_config: row.miniapp_config,
      config_lock_version: row.config_lock_version,
    },
    canEdit,
    canManage,
    capabilities: {
      can_read: base.canRead,
      can_edit: canEdit,
      can_archive: canManage,
    },
  };
}

function workspaceQuery(exec: Executor, actor: Actor) {
  return exec
    .selectFrom("workspace as w")
    .innerJoin("organization as o", "o.id", "w.organization_id")
    .leftJoin("organization_member as m", (join) => join.onRef("m.organization_id", "=", "o.id").on("m.user_id", "=", actor.userId))
    .select([
      "w.id",
      "w.name",
      "w.description",
      "w.organization_id",
      "w.create_date",
      "w.archived_at",
      "w.miniapp_config",
      "w.config_lock_version",
      "o.name as org_name",
      "o.archived_at as org_archived_at",
      "m.role as org_role",
    ]);
}

export async function loadWorkspaceAccess(exec: Executor, actor: Actor, workspaceId: string): Promise<WorkspaceAccess | null> {
  const row = await workspaceQuery(exec, actor).where("w.id", "=", workspaceId).executeTakeFirst();
  return row ? workspaceAccessFrom(actor, row) : null;
}

export async function loadWorkspaceAccessMany(exec: Executor, actor: Actor, workspaceIds: string[]): Promise<Map<string, WorkspaceAccess>> {
  const ids = [...new Set(workspaceIds)];
  if (!ids.length) return new Map();
  const rows = await workspaceQuery(exec, actor).where("w.id", "in", ids).execute();
  return new Map(rows.map((row) => [row.id, workspaceAccessFrom(actor, row)]));
}

/** Every collection of an organization with the caller's access (newest first). */
export async function loadOrgWorkspaceAccess(exec: Executor, actor: Actor, orgId: string, opts: LibraryListQuery = {}): Promise<WorkspaceAccess[]> {
  let query = workspaceQuery(exec, actor).where("w.organization_id", "=", orgId).orderBy("w.create_date", "desc").orderBy("w.id");
  if (opts.state === "active") query = query.where("w.archived_at", "is", null);
  if (opts.state === "archived") query = query.where("w.archived_at", "is not", null);
  if (opts.q) query = query.where("w.name", "ilike", nameContainsPattern(opts.q));
  if (opts.limit !== undefined) query = query.limit(opts.limit).offset(opts.offset ?? 0);
  const rows = await query.execute();
  return rows.map((row) => workspaceAccessFrom(actor, row));
}

function isWorkspaceAccess(access: OrgAccess): access is WorkspaceAccess {
  return "workspace" in access;
}

/** Outside the organization a collection looks missing (no existence oracle). */
export async function requireWorkspaceRead(exec: Executor, actor: Actor, workspaceId: string): Promise<WorkspaceAccess> {
  const access = await loadWorkspaceAccess(exec, actor, workspaceId);
  if (!access?.canRead) throw notFound("合集不存在");
  return access;
}

function explainEditDenied(access: WorkspaceAccess): never {
  if (access.org.archived_at) throw archived("组织已归档，内容只读");
  if (access.workspace.archived_at) throw archived("合集已归档，投放只读");
  throw forbidden("组织查看者只能浏览团队内容");
}

export async function requireWorkspaceEdit(exec: Executor, actor: Actor, workspaceId: string): Promise<WorkspaceAccess> {
  const access = await requireWorkspaceRead(exec, actor, workspaceId);
  if (!access.canEdit) explainEditDenied(access);
  return access;
}

/** Archive/restore rights; unlike requireWorkspaceEdit an archived collection qualifies. */
export async function requireWorkspaceManage(exec: Executor, actor: Actor, workspaceId: string): Promise<WorkspaceAccess> {
  const access = await requireWorkspaceRead(exec, actor, workspaceId);
  if (!access.canManage) {
    // The collection's own archived state is never the reason: restoring it is the point.
    if (access.org.archived_at) throw archived("组织已归档，内容只读");
    throw forbidden("组织查看者只能浏览团队内容");
  }
  return access;
}

/** Inside a write transaction: block concurrent archival of the collection or its team. */
export async function lockWorkspaceForWrite(trx: Trx, access: WorkspaceAccess): Promise<void> {
  await lockOrgForWrite(trx, access.workspace.organization_id);
  const row = await trx.selectFrom("workspace").select(["archived_at"]).where("id", "=", access.workspace.id).forShare().executeTakeFirst();
  if (!row) throw notFound("合集不存在");
  if (row.archived_at) throw archived("合集已归档，投放只读");
}

// ───────────────────────── assets ─────────────────────────

export interface AssetIdentity {
  id: string;
  organization_id: string;
  name: string | null;
  file_type: string;
  visibility: string;
  state: string;
  origin: string;
  origin_workspace_id: string | null;
  maintained_by: string | null;
  lock_version: number;
  created_by: string | null;
}

export interface AssetAccess extends OrgAccess {
  asset: AssetIdentity;
  /** Team writer in an open organization: name, versions, archive/restore. */
  canMaintain: boolean;
  /** Owner/admin: change the responsible maintainer. */
  canTransfer: boolean;
}

const ASSET_COLUMNS = [
  "id",
  "organization_id",
  "name",
  "file_type",
  "visibility",
  "state",
  "origin",
  "origin_workspace_id",
  "maintained_by",
  "lock_version",
  "created_by",
] as const;

/** Team-owned asset identity. */
export async function loadAssetIdentity(exec: Executor, assetId: string, opts: { forUpdate?: boolean; forShare?: boolean } = {}): Promise<AssetIdentity | null> {
  let query = exec.selectFrom("asset").select(ASSET_COLUMNS).where("id", "=", assetId);
  if (opts.forUpdate) query = query.forUpdate();
  else if (opts.forShare) query = query.forShare();
  const row = await query.executeTakeFirst();
  if (!row || !row.organization_id) return null;
  return { ...row, organization_id: row.organization_id };
}

export function assetAccessFrom(org: OrgAccess, asset: AssetIdentity): AssetAccess {
  const open = !org.org.archived_at;
  return {
    ...org,
    asset,
    canMaintain: open && org.canWrite,
    canTransfer: open && org.canAdminister,
  };
}

export async function loadAssetAccess(
  exec: Executor,
  actor: Actor,
  assetId: string,
  opts: { forUpdate?: boolean; forShare?: boolean } = {},
): Promise<AssetAccess | null> {
  const asset = await loadAssetIdentity(exec, assetId, opts);
  if (!asset) return null;
  const org = await loadOrgAccess(exec, actor, asset.organization_id);
  return org ? assetAccessFrom(org, asset) : null;
}

export async function requireAssetRead(exec: Executor, actor: Actor, assetId: string, opts: { forUpdate?: boolean; forShare?: boolean } = {}): Promise<AssetAccess> {
  const access = await loadAssetAccess(exec, actor, assetId, opts);
  // Unreadable and missing look the same: no existence oracle across tenants.
  if (!access || !access.canRead) throw notFound("素材不存在");
  return access;
}

/** Edit the team asset (name, versions, archive/restore): any team writer, maintained_by is not checked. */
export async function requireAssetMaintain(exec: Executor, actor: Actor, assetId: string, opts: { forUpdate?: boolean } = {}): Promise<AssetAccess> {
  const access = await requireAssetRead(exec, actor, assetId, opts);
  if (!access.canMaintain) {
    if (access.org.archived_at) throw archived("组织已归档，内容只读");
    throw forbidden("组织查看者只能浏览团队内容");
  }
  return access;
}

export function assetCapabilities(access: AssetAccess, useInWorkspace?: boolean): AssetCapabilities {
  return {
    can_read: access.canRead,
    can_maintain: access.canMaintain,
    can_transfer_maintainer: access.canTransfer,
    ...(useInWorkspace === undefined ? {} : { can_use_in_workspace: useInWorkspace }),
  };
}

/**
 * Use of a team asset in new content (a scene draft, a placement, a reused
 * file). Must run inside the write transaction: the caller is a team writer
 * of the target organization, and the asset is re-read under a share lock —
 * the lock archiving takes FOR UPDATE — so a concurrent archive cannot slip
 * a new reference in. Grants are neither required nor created.
 *
 * `existingReference`: the exact version is already referenced by the
 * caller's draft/placement, so archived assets remain usable for that reference.
 */
export async function ensureAssetUse(
  trx: Trx,
  _actor: Actor,
  assetId: string,
  target: OrgAccess,
  opts: { existingReference?: boolean } = {},
): Promise<AssetIdentity> {
  assertOrgWritable(target);
  if (isWorkspaceAccess(target) && !target.canEdit) explainEditDenied(target);
  const asset = await loadAssetIdentity(trx, assetId, { forShare: true });
  if (!asset || asset.organization_id !== target.org.id) throw notFound("素材不存在或不属于该组织");
  if (asset.state !== "active" && !opts.existingReference) throw archived("素材已归档，不能新增引用");
  return asset;
}
