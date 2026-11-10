import { NextResponse } from "next/server";
import { db, sql } from "@/lib/db";
import { isUuid } from "@/lib/content-model/input";
import { getSessionUser } from "@/lib/auth/server";
import { getUserContext } from "@/lib/permissions.server";
import { hasOrgPermission, isSuperAdmin } from "@/lib/permissions";
import { logError } from "@/lib/log-error";

// 获取单个 organization 详情
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

    // 仅组织成员（或 super_admin）可读组织详情
    const { globalRole, orgRole } = await getUserContext(user.id, id);
    if (!isSuperAdmin(globalRole) && !orgRole) {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const data = await db
      .selectFrom("organization")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取 organization 失败:", error);
    return NextResponse.json({ error: "获取组织失败" }, { status: 500 });
  }
}

// 更新 organization（需 org.settings：owner 或 super_admin）
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { globalRole, orgRole } = await getUserContext(user.id, id);

    if (!isSuperAdmin(globalRole) && !hasOrgPermission(orgRole, "org.settings")) {
      await logError({
        userId: user.id,
        method: "PUT",
        path: `/api/organizations/${id}`,
        status: 403,
        message: "权限不足: org.settings",
        context: { orgRole },
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, map_center, allowed_file_types, config } = body;

    // jsonb 列（map_center / config）以 JSON 字符串写入；值为 undefined 的键不会被更新
    const updatePayload: {
      name?: string;
      description?: string | null;
      map_center?: string | null;
      allowed_file_types?: string[] | null;
      config?: string;
    } = { name, description };

    // 组织配置字段（与 super-admin 的 updateOrganization action 同语义）：
    // 仅在请求携带时更新，且做形状校验，防止写入脏数据
    if (map_center !== undefined) {
      const validCenter =
        map_center === null ||
        (typeof map_center?.lat === "number" &&
          typeof map_center?.lng === "number");
      if (!validCenter) {
        return NextResponse.json(
          { error: "无效的地图中心坐标" },
          { status: 400 },
        );
      }
      updatePayload.map_center =
        map_center === null
          ? null
          : JSON.stringify({ lat: map_center.lat, lng: map_center.lng });
    }

    if (allowed_file_types !== undefined) {
      const validTypes =
        allowed_file_types === null ||
        (Array.isArray(allowed_file_types) &&
          allowed_file_types.every((t: unknown) => typeof t === "string"));
      if (!validTypes) {
        return NextResponse.json(
          { error: "无效的文件类型配置" },
          { status: 400 },
        );
      }
      updatePayload.allowed_file_types = allowed_file_types;
    }

    if (config !== undefined) {
      if (typeof config !== "object" || config === null) {
        return NextResponse.json({ error: "无效的组织配置" }, { status: 400 });
      }
      const safeConfig = { ...config };
      updatePayload.config = JSON.stringify(safeConfig);
    }

    const data = await db
      .updateTable("organization")
      .set(updatePayload)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("更新 organization 失败:", error);
    await logError({
      method: "PUT",
      path: `/api/organizations/${id}`,
      status: 500,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "更新组织失败" }, { status: 500 });
  }
}

// 删除 organization（需 org.delete：owner 或 super_admin；只能删除没有合集、素材、场景和投放的空团队）
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    if (!isUuid(id)) return NextResponse.json({ error: "组织不存在" }, { status: 404 });

    const { globalRole, orgRole } = await getUserContext(user.id, id);

    if (!isSuperAdmin(globalRole) && !hasOrgPermission(orgRole, "org.delete")) {
      await logError({
        userId: user.id,
        method: "DELETE",
        path: `/api/organizations/${id}`,
        status: 403,
        message: "权限不足: org.delete",
        context: { orgRole },
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    // 只能删除空团队：仍有合集、团队素材、场景或投放时拒绝（409），绝不级联删除团队内容。
    // 在组织行锁内复核，避免与并发创建内容交错；外键（scene/asset → organization）兜底。
    const blocked = await db.transaction().execute(async (trx) => {
      const org = await trx.selectFrom("organization").select("id").where("id", "=", id).forUpdate().executeTakeFirst();
      if (!org) return null;
      const { rows } = await sql<{ workspaces: number; assets: number; scenes: number; placements: number; activities: number; activity_records: number }>`
        select
          (select count(*) from workspace where organization_id = ${id}::uuid)::int as workspaces,
          (select count(*) from asset where organization_id = ${id}::uuid)::int as assets,
          (select count(*) from scene where organization_id = ${id}::uuid)::int as scenes,
          (select count(*) from placement where organization_id = ${id}::uuid)::int as placements,
          (select count(*) from activity where organization_id = ${id}::uuid)::int as activities,
          (select count(*) from activity_record where organization_id = ${id}::uuid)::int as activity_records
      `.execute(trx);
      const counts = rows[0];
      if (counts.workspaces + counts.assets + counts.scenes + counts.placements + counts.activities + counts.activity_records > 0) return counts;
      await trx.deleteFrom("organization").where("id", "=", id).execute();
      return false;
    });
    if (blocked === null) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
    if (blocked) {
      return NextResponse.json(
        {
          error: `无法删除：该团队仍保留内容（合集 ${blocked.workspaces}、素材 ${blocked.assets}、场景 ${blocked.scenes}、投放 ${blocked.placements}、活动 ${blocked.activities}、活动记录 ${blocked.activity_records}）。归档内容也会阻止删除。`,
          code: "DEPENDENCY_CONFLICT",
          details: { counts: blocked },
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    // A concurrent content write that committed first still trips the tenant FKs.
    if ((error as { code?: string }).code === "23503") {
      return NextResponse.json({ error: "无法删除：该团队仍保留内容。归档内容也会阻止删除。", code: "DEPENDENCY_CONFLICT" }, { status: 409 });
    }
    console.error("删除 organization 失败:", error);
    await logError({
      method: "DELETE",
      path: `/api/organizations/${id}`,
      status: 500,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "删除组织失败" }, { status: 500 });
  }
}
