import { getSessionUser } from "@/lib/auth/server";
import { db, sql } from "@/lib/db";
import { logErrorSafe } from "@/lib/log-error";
import { isSuperAdmin } from "@/lib/permissions";
import { getUserContext } from "@/lib/permissions.server";
import { ASSETS_PREFIX, headObject, listObjects } from "@/lib/storage/oss";
import { collectProtectedKeys, releaseObjectsIfUnreferenced } from "@/lib/storage/retention.server";
import { NextResponse } from "next/server";

/**
 * 存储/数据库一致性清扫（仅 super_admin）：
 *
 * - clean-rows：按合集（workspace）检查旧资产行，以及该合集投放直接或经
 *   场景发布版本固定的素材内容文件（另含历史授权素材的版本），报告存储对象已
 *   不存在的记录（需要 workspaceId）。只报告、不删行：缺文件的版本不可发布，
 *   素材身份与引用必须保留，由团队成员上传新版本修复。
 * - clean-files：遍历 OSS assets/ 下全部对象，与全局保留集合（版本资源、旧行
 *   引用、匹配点参考图、有效上传回执、.webm↔.m4a 派生文件）对比；候选逐个在
 *   对象 key 锁内复核后才回收。迁移期间实际删除关闭
 *   （app_config.managed_object_deletion），只返回候选。24 小时内的新对象跳过。
 */

const ORPHAN_FILE_MIN_AGE_MS = 24 * 60 * 60 * 1000;

interface CleanResult {
  orphanedRows: {
    id: string;
    file_url: string;
    reason: string;
  }[];
  orphanedFiles: {
    path: string;
    name: string;
  }[];
  deletedRows: string[];
  deletedFiles: string[];
  errors: string[];
  deletionEnabled?: boolean;
}

/**
 * Managed objects a collection depends on: the versions its
 * placements pin (directly or through their scene revisions) and, as
 * history, versions of assets once granted to it.
 */
async function workspaceObjects(workspaceId: string): Promise<{ id: string; url: string; key: string; reason: string }[]> {
  const versionIds = sql<string>`(
    select p.asset_id from placement p where p.workspace_id = ${workspaceId}::uuid and p.asset_id is not null
    union
    select ra.asset_id from placement p join scene_asset_ref ra on ra.scene_id = p.scene_id where p.workspace_id = ${workspaceId}::uuid

  )`;
  const versions = await db
    .selectFrom("asset as v")
    .innerJoin("asset_resource as r", "r.asset_id", "v.id")
    .select(["v.id", "r.storage_key", "r.role"])
    .where(sql<boolean>`v.id in ${versionIds}`)
    .where("r.storage_key", "is not", null)
    .orderBy("v.id")
    .execute();
  const out: { id: string; url: string; key: string; reason: string }[] = [];
  for (const row of versions) {
    if (row.storage_key) out.push({ id: row.id, url: row.storage_key, key: row.storage_key, reason: `素材的 ${row.role} 文件不存在（不可发布，请编辑素材文件）` });
  }
  return out;
}

export async function POST(request: Request) {
  try {
    // 验证用户权限
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { globalRole } = await getUserContext(user.id);

    if (!isSuperAdmin(globalRole)) {
      await logErrorSafe({
        method: "POST",
        path: "/api/admin/clean",
        status: 403,
        message: "权限不足: 仅 super_admin 可清理",
      });
      return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
    }

    // 解析请求体
    const body = await request.json();
    const { workspaceId, action } = body;
    // action: "clean-rows" | "clean-files" | "both"

    const wantRows = action === "clean-rows" || action === "both";
    const wantFiles = action === "clean-files" || action === "both";

    if (wantRows && !workspaceId) {
      return NextResponse.json({ error: "请选择工作空间" }, { status: 400 });
    }

    const result: CleanResult = {
      orphanedRows: [],
      orphanedFiles: [],
      deletedRows: [],
      deletedFiles: [],
      errors: [],
    };

    // 1. 报告文件已不存在的记录（按 workspace；不删行）
    if (wantRows) {
      try {
        for (const item of await workspaceObjects(workspaceId)) {
          try {
            // headObject 仅在对象确实不存在时返回 null，其余故障抛错
            if ((await headObject(item.key)) === null) {
              result.orphanedRows.push({ id: item.id, file_url: item.url, reason: item.reason });
            }
          } catch (headError) {
            // 查询失败 ≠ 文件不存在
            result.errors.push(
              `检查文件 ${item.key} 失败: ${headError instanceof Error ? headError.message : "未知错误"}`,
            );
          }
        }
      } catch (err) {
        result.errors.push(
          `检查数据库记录时出错: ${err instanceof Error ? err.message : "未知错误"}`,
        );
      }
    }

    // 2. 全桶清扫：快照预筛 + 逐个加锁复核（删除关闭时只报告候选）
    if (wantFiles) {
      try {
        // 先列对象、后取保留集合；最终判定在 retention 的对象锁内完成
        const files: { key: string; lastModified: Date }[] = [];
        for await (const obj of listObjects(ASSETS_PREFIX)) {
          files.push({ key: obj.key, lastModified: obj.lastModified });
        }
        const protectedKeys = await collectProtectedKeys();

        const now = Date.now();
        const candidates: string[] = [];
        for (const file of files) {
          if (protectedKeys.has(file.key)) continue;
          // 新文件跳过：可能是进行中的上传（对象只写一次，lastModified 即上传时间）
          const age = now - file.lastModified.getTime();
          if (Number.isFinite(age) && age < ORPHAN_FILE_MIN_AGE_MS) continue;
          candidates.push(file.key);
        }

        const report = await releaseObjectsIfUnreferenced(candidates, {
          userId: user.id,
          method: "POST",
          path: "/api/admin/clean",
        });
        result.deletionEnabled = report.deletionEnabled;
        for (const key of [...report.removed, ...report.candidates]) {
          result.orphanedFiles.push({ path: key, name: key.split("/").pop() ?? key });
        }
        result.deletedFiles.push(...report.removed);
        for (const key of report.failed) result.errors.push(`回收文件 ${key} 失败`);
      } catch (err) {
        result.errors.push(
          `清理存储文件时出错: ${
            err instanceof Error ? err.message : "未知错误"
          }`,
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: result,
      summary: {
        orphanedRowsFound: result.orphanedRows.length,
        orphanedFilesFound: result.orphanedFiles.length,
        rowsDeleted: result.deletedRows.length,
        filesDeleted: result.deletedFiles.length,
        errorsCount: result.errors.length,
      },
    });
  } catch (error) {
    console.error("清理操作失败:", error);
    await logErrorSafe({
      method: "POST",
      path: "/api/admin/clean",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
