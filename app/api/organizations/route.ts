import { getSessionUser } from "@/lib/auth/server";
import { db, sql } from "@/lib/db";
import { logErrorSafe } from "@/lib/log-error";
import { DEFAULT_UPLOAD_TYPES } from "@/lib/upload/types";
import { NextResponse } from "next/server";

// get_user_organizations(p_user_id) 的返回行（db/schema.sql）
interface UserOrganizationRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  role: string;
  map_center: { lat: number; lng: number } | null;
  allowed_file_types: string[] | null;
  pinned_at: Date | null;
}

// 获取用户可访问的所有 organization
export async function GET() {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { rows: data } = await sql<UserOrganizationRow>`
      select teams.*, organization.archived_at from public.get_user_organizations(${user.id}::uuid) teams
      join organization on organization.id = teams.id
    `.execute(db);

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取 organization 失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/organizations",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取组织失败" }, { status: 500 });
  }
}

// 创建新的 organization（仅 admin）
export async function POST(request: Request) {
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
        method: "POST",
        path: "/api/organizations",
        status: 403,
        message: "权限不足: 仅 super_admin 可创建组织",
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
    }

    // 新组织的默认文件类型来自全局配置（app_config）；配置缺失时兜底为代码默认集合
    const cfg = await db
      .selectFrom("app_config")
      .select("value")
      .where("key", "=", "default_allowed_file_types")
      .executeTakeFirst();
    const defaultFileTypes = Array.isArray(cfg?.value)
      ? (cfg.value as string[])
      : DEFAULT_UPLOAD_TYPES;

    // 创建 organization（团队），并将创建者设为 owner（同一事务，避免留下无主组织）。
    // 素材与场景属于团队，地图合集按需创建。
    const org = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto("organization")
        .values({
          name,
          description: description || null,
          created_by: user.id,
          allowed_file_types: defaultFileTypes,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("organization_member")
        .values({
          organization_id: created.id,
          user_id: user.id,
          role: "owner",
        })
        .execute();

      return created;
    });

    return NextResponse.json({ data: org }, { status: 201 });
  } catch (error) {
    console.error("创建 organization 失败:", error);
    await logErrorSafe({
      method: "POST",
      path: "/api/organizations",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "创建组织失败" }, { status: 500 });
  }
}
