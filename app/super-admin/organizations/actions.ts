"use server";

import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { purgeOrganizations } from "@/lib/user-deletion.server";
import { revalidatePath } from "next/cache";

import type { OrgConfig } from "./types";

interface UpdateOrgPayload {
  name?: string;
  description?: string | null;
  map_center?: { lat: number; lng: number } | null;
  allowed_file_types?: string[] | null;
  config?: OrgConfig;
}

async function requireSuperAdmin() {
  const user = await getSessionUser();
  if (!user) throw new Error("未授权");

  const userData = await db
    .selectFrom("users")
    .select("role")
    .where("user_id", "=", user.id)
    .executeTakeFirst();

  if (userData?.role !== "super_admin") throw new Error("权限不足");
  return user;
}

export async function updateOrganization(
  id: string,
  payload: UpdateOrgPayload,
): Promise<{ error?: string }> {
  try {
    await requireSuperAdmin();
    const safePayload = { ...payload };
    // 未携带（undefined）的字段不更新；jsonb 列（map_center / config）以 JSON 字符串写入
    await db
      .updateTable("organization")
      .set({
        name: safePayload.name,
        description: safePayload.description,
        allowed_file_types: safePayload.allowed_file_types,
        map_center:
          safePayload.map_center === undefined
            ? undefined
            : safePayload.map_center === null
              ? null
              : JSON.stringify(safePayload.map_center),
        config:
          safePayload.config === undefined
            ? undefined
            : JSON.stringify(safePayload.config),
      })
      .where("id", "=", id)
      .execute();
    revalidatePath("/super-admin/organizations");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

export async function deleteOrganization(
  id: string,
): Promise<{ error?: string }> {
  try {
    await requireSuperAdmin();
    // 直接 delete organization 会被 workspace 的 NO ACTION 外键挡住；
    // 走完整清理器：先按引用计数删存储文件（去重共享的保留），
    // 再原子删除 组织内资产 / workspace / 组织（跨组织资产仅剥离本组织的 workspace）
    await purgeOrganizations([id]);
    revalidatePath("/super-admin/organizations");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}
