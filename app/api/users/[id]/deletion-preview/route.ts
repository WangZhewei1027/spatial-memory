import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { logErrorSafe } from "@/lib/log-error";
import { computeUserDeletionPlan } from "@/lib/user-deletion.server";

// 删除用户的后果预览（仅 super_admin，只读）：
// 逐组织给出 none / promote（含继任者）/ delete（含 workspace、资产计数），
// 供确认弹窗渲染。被 self / super_admin 规则拦截时返回 blocked 而非报错。
export async function GET(
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
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    if (id === user.id) {
      return NextResponse.json({ data: { blocked: "self", orgs: [] } });
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
      return NextResponse.json({ data: { blocked: "super_admin", orgs: [] } });
    }

    const plan = await computeUserDeletionPlan(id);

    return NextResponse.json({ data: { blocked: null, orgs: plan.orgs } });
  } catch (error) {
    console.error("获取删除预览失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/users/[id]/deletion-preview",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取删除预览失败" }, { status: 500 });
  }
}
