import { NextResponse } from "next/server";
import { db, sql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { deleteAuthUser } from "@/lib/auth/users.server";
import { logErrorSafe } from "@/lib/log-error";
import {
  computeUserDeletionPlan,
  purgeOrganizations,
} from "@/lib/user-deletion.server";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // 检查权限
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const userData = await db
      .selectFrom("users")
      .select("role")
      .where("user_id", "=", user.id)
      .executeTakeFirst();

    if (userData?.role !== "super_admin") {
      await logErrorSafe({
        userId: user.id,
        method: "PUT",
        path: `/api/users/${id}`,
        status: 403,
        message: "权限不足: 仅 super_admin 可改用户角色",
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const body = await request.json();
    const role: "super_admin" | "user" | undefined = body.role;

    if (!role || !["super_admin", "user"].includes(role)) {
      return NextResponse.json({ error: "无效的角色" }, { status: 400 });
    }

    // 不能修改自己的角色
    if (id === user.id) {
      return NextResponse.json(
        { error: "不能修改自己的角色" },
        { status: 400 },
      );
    }

    const data = await db
      .updateTable("users")
      .set({ role })
      .where("user_id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("更新用户角色失败:", error);
    await logErrorSafe({
      method: "PUT",
      path: "/api/users/[id]",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "更新用户角色失败" }, { status: 500 });
  }
}

// 删除用户（仅 super_admin）。对他是唯一 owner 的组织：
// 有其他成员 → 晋升继任者；只剩他一人 → 连同 workspace/资产/存储文件删除组织。
// 执行顺序保证任一步失败后系统仍可恢复、整个接口可重试：
// 先晋升 → 再清空组织 → 最后删 auth 用户（外键级联收尾）。
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const callerData = await db
      .selectFrom("users")
      .select("role")
      .where("user_id", "=", user.id)
      .executeTakeFirst();

    if (callerData?.role !== "super_admin") {
      await logErrorSafe({
        userId: user.id,
        method: "DELETE",
        path: `/api/users/${id}`,
        status: 403,
        message: "权限不足: 仅 super_admin 可删除用户",
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    if (id === user.id) {
      return NextResponse.json({ error: "不能删除自己" }, { status: 400 });
    }

    const target = await db
      .selectFrom("users")
      .select("role")
      .where("user_id", "=", id)
      .executeTakeFirst();

    if (!target) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    if (target.role === "super_admin") {
      return NextResponse.json(
        { error: "不能删除超级管理员，请先将其降级" },
        { status: 400 },
      );
    }

    const plan = await computeUserDeletionPlan(id);

    if (plan.promoteOrgIds.length > 0) {
      await sql`select public.promote_owner_successors(${plan.promoteOrgIds}::uuid[], ${id}::uuid)`.execute(
        db,
      );
    }

    const purge = await purgeOrganizations(plan.deleteOrgIds);

    // 删除 auth.users 行，外键级联清掉 public.users / 成员关系 / 分配
    const deleted = await deleteAuthUser(id);
    if (!deleted) throw new Error(`auth user not found: ${id}`);

    return NextResponse.json({
      success: true,
      summary: {
        promotedOrgIds: plan.promoteOrgIds,
        deletedOrgIds: plan.deleteOrgIds,
        deletedAssets: purge.deletedAssets,
        deletedFiles: purge.deletedFiles,
      },
    });
  } catch (error) {
    console.error("删除用户失败:", error);
    await logErrorSafe({
      method: "DELETE",
      path: "/api/users/[id]",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "删除用户失败" }, { status: 500 });
  }
}
