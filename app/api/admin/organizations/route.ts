import { NextResponse, connection } from "next/server";
import { db, jsonArrayFrom, jsonObjectFrom } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { logErrorSafe } from "@/lib/log-error";

// GET all organizations with members (super_admin only)
export async function GET() {
  // 会话依赖 cookies()，必须请求时渲染。connection() 要放在 try 之外：
  // build 预渲染的退出信号若被 catch 截获，会误写一条 500 错误日志
  await connection();
  try {
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
        method: "GET",
        path: "/api/admin/organizations",
        status: 403,
        message: "权限不足: 仅 super_admin",
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const data = await db
      .selectFrom("organization")
      .select((eb) => [
        "organization.id",
        "organization.name",
        "organization.description",
        "organization.created_at",
        "organization.created_by",
        "organization.map_center",
        "organization.allowed_file_types",
        "organization.config",
        jsonArrayFrom(
          eb
            .selectFrom("organization_member")
            .select((eb2) => [
              "organization_member.id",
              "organization_member.role",
              "organization_member.user_id",
              jsonObjectFrom(
                eb2
                  .selectFrom("users")
                  .select(["users.user_id", "users.name", "users.email"])
                  .whereRef("users.user_id", "=", "organization_member.user_id"),
              ).as("users"),
            ])
            .whereRef(
              "organization_member.organization_id",
              "=",
              "organization.id",
            ),
        ).as("organization_member"),
      ])
      .orderBy("organization.created_at", "desc")
      .execute();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取所有组织失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/admin/organizations",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取组织失败" }, { status: 500 });
  }
}
