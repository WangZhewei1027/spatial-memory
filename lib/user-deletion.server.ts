import { db, sql } from "@/lib/db";
import { releaseObjectsIfUnreferenced } from "@/lib/storage/retention.server";
import "server-only";

/**
 * 删除用户的服务端编排（仅服务端）。
 *
 * 用户删除只影响身份与维护责任：维护者字段随 users 外键置空，团队文件绝不按
 * OSS 路径删除。只有整组织清除时，组织自有的版本文件、回执和旧行文件才成为
 * 回收候选，并且逐个经过 retention 协议的加锁复核（迁移期默认只报告）。
 *
 * 策略：用户是某组织唯一 owner 时——
 * - 组织还有其他成员 → 晋升最合适的成员为 owner（admin 优先，其次加入最早）；
 * - 只剩他一人 → 连同 workspace、资产、存储文件整体删除该组织。
 *
 * computeUserDeletionPlan 是预览 GET 与 DELETE 的单一事实来源；
 * purgeOrganizations 先调 purge_organizations 函数原子删行，再清理行删除后已无
 * 任何引用的存储文件（内容 hash 去重会让多个资产跨组织共享同一文件，行删完后
 * 仍被引用的 URL 一律保留）。失败方向只留孤儿文件，由 /api/admin/clean 全局
 * 清扫兜底，不会出现死链。
 */

export type OrgDeletionAction = "none" | "promote" | "delete";

export interface OrgDeletionPlanItem {
  id: string;
  name: string;
  memberCount: number;
  action: OrgDeletionAction;
  successor?: {
    user_id: string;
    name: string | null;
    email: string | null;
    role: string;
  };
  workspaceCount?: number;
  assetCount?: number;
  /** Content model rows removed with the organization (preview only). */
  sceneCount?: number;
  placementCount?: number;
  activityCount?: number;
  activityRecordCount?: number;
}

export interface UserDeletionPlan {
  orgs: OrgDeletionPlanItem[];
  promoteOrgIds: string[];
  deleteOrgIds: string[];
}

interface MemberRow {
  organization_id: string;
  user_id: string;
  role: string;
  user_name: string | null;
  user_email: string | null;
}

export async function computeUserDeletionPlan(
  targetUserId: string,
): Promise<UserDeletionPlan> {
  const ownerRows = await db
    .selectFrom("organization_member")
    .leftJoin(
      "organization",
      "organization.id",
      "organization_member.organization_id",
    )
    .select(["organization_member.organization_id", "organization.name as org_name"])
    .where("organization_member.user_id", "=", targetUserId)
    .where("organization_member.role", "=", "owner")
    .execute();

  const orgIds = ownerRows.map((r) => r.organization_id);
  if (orgIds.length === 0) {
    return { orgs: [], promoteOrgIds: [], deleteOrgIds: [] };
  }

  const orgNames = new Map<string, string>();
  for (const row of ownerRows) {
    orgNames.set(row.organization_id, row.org_name ?? "");
  }

  const memberRows: MemberRow[] = await db
    .selectFrom("organization_member")
    .leftJoin("users", "users.user_id", "organization_member.user_id")
    .select([
      "organization_member.organization_id",
      "organization_member.user_id",
      "organization_member.role",
      "users.name as user_name",
      "users.email as user_email",
    ])
    .where("organization_member.organization_id", "in", orgIds)
    // 与 promote_owner_successors 的排序保持一致：加入最早优先，同一时刻按 id
    .orderBy("organization_member.created_at", "asc")
    .orderBy("organization_member.id", "asc")
    .execute();

  const byOrg = new Map<string, MemberRow[]>();
  for (const row of memberRows) {
    const list = byOrg.get(row.organization_id) ?? [];
    list.push(row);
    byOrg.set(row.organization_id, list);
  }

  const orgs: OrgDeletionPlanItem[] = [];
  const promoteOrgIds: string[] = [];
  const deleteOrgIds: string[] = [];

  for (const orgId of orgIds) {
    const members = byOrg.get(orgId) ?? [];
    const others = members.filter((m) => m.user_id !== targetUserId);
    const item: OrgDeletionPlanItem = {
      id: orgId,
      name: orgNames.get(orgId) ?? "",
      memberCount: members.length,
      action: "none",
    };

    if (others.length === 0) {
      item.action = "delete";
      deleteOrgIds.push(orgId);
    } else if (others.some((m) => m.role === "owner")) {
      item.action = "none";
    } else {
      // admin 优先，其次加入最早（memberRows 已按 created_at 升序）
      const successor = others.find((m) => m.role === "admin") ?? others[0];
      item.action = "promote";
      item.successor = {
        user_id: successor.user_id,
        name: successor.user_name,
        email: successor.user_email,
        role: successor.role,
      };
      promoteOrgIds.push(orgId);
    }
    orgs.push(item);
  }

  // 为将被删除的组织补充 workspace / 资产计数（预览用）
  if (deleteOrgIds.length > 0) {
    const wsRows = await db
      .selectFrom("workspace")
      .select(["id", "organization_id"])
      .where("organization_id", "in", deleteOrgIds)
      .execute();

    for (const orgId of deleteOrgIds) {
      const wsIds = wsRows
        .filter((w) => w.organization_id === orgId)
        .map((w) => w.id);
      const item = orgs.find((o) => o.id === orgId)!;
      item.workspaceCount = wsIds.length;
      const assets = await db.selectFrom("asset").select(({ fn }) => fn.countAll<number>().as("n")).where("organization_id", "=", orgId).executeTakeFirstOrThrow();
      item.assetCount = Number(assets.n);
      const [scenes, placements, activities, activityRecords] = await Promise.all([
        db.selectFrom("scene").select(({ fn }) => fn.countAll<number>().as("n")).where("organization_id", "=", orgId).executeTakeFirstOrThrow(),
        db.selectFrom("placement").select(({ fn }) => fn.countAll<number>().as("n")).where("organization_id", "=", orgId).executeTakeFirstOrThrow(),
        db.selectFrom("activity").select(({ fn }) => fn.countAll<number>().as("n")).where("organization_id", "=", orgId).executeTakeFirstOrThrow(),
        db.selectFrom("activity_record").select(({ fn }) => fn.countAll<number>().as("n")).where("organization_id", "=", orgId).executeTakeFirstOrThrow(),
      ]);
      item.activityCount = Number(activities.n);
      item.activityRecordCount = Number(activityRecords.n);
      item.sceneCount = Number(scenes.n);
      item.placementCount = Number(placements.n);
    }
  }

  return { orgs, promoteOrgIds, deleteOrgIds };
}

export interface PurgeResult {
  deletedAssets: number;
  deletedWorkspaces: number;
  deletedOrgs: number;
  deletedFiles: number;
  /** Unreferenced keys left for the collector while object deletion is disabled. */
  deferredFiles: number;
}

/**
 * 整体删除组织：先原子删行（purge_organizations 函数），再删除已无引用的存储文件。
 * 行先删意味着任何失败只会留下孤儿文件（由 /api/admin/clean 全局清扫兜底），
 * 而不会留下指向已删文件的死链行。
 */
export async function purgeOrganizations(orgIds: string[]): Promise<PurgeResult> {
  if (orgIds.length === 0) {
    return { deletedAssets: 0, deletedWorkspaces: 0, deletedOrgs: 0, deletedFiles: 0, deferredFiles: 0 };
  }

  const candidateKeys = new Set<string>();
  const [resources, receipts, covers] = await Promise.all([
    db
      .selectFrom("asset_resource as r")
      .innerJoin("asset as v", "v.id", "r.asset_id")
      .select("r.storage_key")
      .where("v.organization_id", "in", orgIds)
      .where("r.storage_key", "is not", null)
      .execute(),
    db.selectFrom("upload_receipt").select("storage_key").where("organization_id", "in", orgIds).execute(),
    db.selectFrom("template_preview as p").leftJoin("asset as a", "a.id", "p.asset_id")
      .leftJoin("scene as s", "s.id", "p.scene_id").leftJoin("workspace as w", "w.id", "p.workspace_id")
      .select("p.storage_key").where(eb => eb.or([eb("a.organization_id", "in", orgIds), eb("s.organization_id", "in", orgIds), eb("w.organization_id", "in", orgIds)])).execute(),
  ]);
  for (const row of covers) if (row.storage_key) candidateKeys.add(row.storage_key);
  for (const row of resources) if (row.storage_key) candidateKeys.add(row.storage_key);
  for (const row of receipts) candidateKeys.add(row.storage_key);

  const { rows: purgedRows } = await sql<{
    v: Record<string, number> | null;
  }>`select public.purge_organizations(${orgIds}::uuid[]) as v`.execute(db);

  // 行已删完：逐个 key 加锁复核；仍被任一来源（含其他组织）引用的保留。
  const report = await releaseObjectsIfUnreferenced(candidateKeys, { method: "PURGE", path: "purgeOrganizations" });

  const counts = purgedRows[0]?.v ?? {};
  return {
    deletedAssets: counts.deleted_assets ?? 0,
    deletedWorkspaces: counts.deleted_workspaces ?? 0,
    deletedOrgs: counts.deleted_orgs ?? 0,
    deletedFiles: report.removed.length,
    deferredFiles: report.candidates.length,
  };
}
