import { getSessionUser } from "@/lib/auth/server";
import { db, jsonObjectFrom } from "@/lib/db";
import { logErrorSafe } from "@/lib/log-error";
import { hasOrgPermission, isSuperAdmin } from "@/lib/permissions";
import { getUserContext } from "@/lib/permissions.server";
import { NextResponse } from "next/server";

// 获取 organization 的成员列表
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

    const { globalRole, orgRole } = await getUserContext(user.id, id);

    // super_admin or any org member can view members
    if (
      !isSuperAdmin(globalRole) &&
      !hasOrgPermission(orgRole, "org.members.view")
    ) {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const data = await db
      .selectFrom("organization_member")
      .select((eb) => [
        "organization_member.id",
        "organization_member.role",
        "organization_member.created_at",
        "organization_member.user_id",
        jsonObjectFrom(
          eb
            .selectFrom("users")
            .select(["users.user_id", "users.name", "users.email", "users.role"])
            .whereRef("users.user_id", "=", "organization_member.user_id"),
        ).as("users"),
      ])
      .where("organization_member.organization_id", "=", id)
      .orderBy("organization_member.created_at", "asc")
      .execute();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取组织成员失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/organizations/[id]/members",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取组织成员失败" }, { status: 500 });
  }
}

// 添加成员到 organization
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { globalRole, orgRole } = await getUserContext(user.id, id);

    if (
      !isSuperAdmin(globalRole) &&
      !hasOrgPermission(orgRole, "org.members.add")
    ) {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const body = await request.json();
    const { user_id, role = "member" } = body;

    if (!user_id) {
      return NextResponse.json({ error: "缺少 user_id" }, { status: 400 });
    }

    if (!["owner", "admin", "member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "无效的角色" }, { status: 400 });
    }

    // Only owner (or super_admin) can add owners
    if (role === "owner" && !isSuperAdmin(globalRole) && orgRole !== "owner") {
      return NextResponse.json(
        { error: "只有拥有者可以添加拥有者" },
        { status: 403 },
      );
    }

    // 检查是否已经是成员
    const existing = await db
      .selectFrom("organization_member")
      .select("id")
      .where("organization_id", "=", id)
      .where("user_id", "=", user_id)
      .executeTakeFirst();

    if (existing) {
      return NextResponse.json(
        { error: "该用户已经是此组织的成员" },
        { status: 400 },
      );
    }

    let data;
    try {
      data = await db
        .insertInto("organization_member")
        .values({
          organization_id: id,
          user_id,
          role,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (error) {
      // 唯一约束兜并发：撞重复视为「已是成员」
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "该用户已经是此组织的成员" },
          { status: 400 },
        );
      }
      throw error;
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error("添加组织成员失败:", error);
    await logErrorSafe({
      method: "POST",
      path: "/api/organizations/[id]/members",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "添加组织成员失败" }, { status: 500 });
  }
}

// 更新成员角色
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { globalRole, orgRole } = await getUserContext(user.id, id);

    if (
      !isSuperAdmin(globalRole) &&
      !hasOrgPermission(orgRole, "org.members.changeRole")
    ) {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const body = await request.json();
    const { member_id, role } = body;

    if (!member_id) {
      return NextResponse.json({ error: "缺少 member_id" }, { status: 400 });
    }

    if (!role || !["owner", "admin", "member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "无效的角色" }, { status: 400 });
    }

    // Get target member's current role
    const targetMember = await db
      .selectFrom("organization_member")
      .select(["role", "user_id"])
      .where("id", "=", member_id)
      .where("organization_id", "=", id)
      .executeTakeFirst();

    if (!targetMember) {
      return NextResponse.json({ error: "成员不存在" }, { status: 404 });
    }

    // Admin cannot modify owners
    if (
      targetMember.role === "owner" &&
      !isSuperAdmin(globalRole) &&
      orgRole !== "owner"
    ) {
      return NextResponse.json(
        { error: "无法修改拥有者角色" },
        { status: 403 },
      );
    }

    // Only owner (or super_admin) can set someone to owner
    if (role === "owner" && !isSuperAdmin(globalRole) && orgRole !== "owner") {
      return NextResponse.json(
        { error: "只有拥有者可以设置拥有者角色" },
        { status: 403 },
      );
    }

    // 不能把唯一的 owner 降级，否则组织将无人拥有
    if (targetMember.role === "owner" && role !== "owner") {
      const { count: ownerCount } = await db
        .selectFrom("organization_member")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("organization_id", "=", id)
        .where("role", "=", "owner")
        .executeTakeFirstOrThrow();

      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: "不能降级唯一的拥有者，请先转让所有权" },
          { status: 400 },
        );
      }
    }

    const data = await db
      .updateTable("organization_member")
      .set({ role })
      .where("id", "=", member_id)
      .where("organization_id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("更新成员角色失败:", error);
    await logErrorSafe({
      method: "PATCH",
      path: "/api/organizations/[id]/members",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "更新成员角色失败" }, { status: 500 });
  }
}

// 移除组织成员
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

    const { globalRole, orgRole } = await getUserContext(user.id, id);

    if (
      !isSuperAdmin(globalRole) &&
      !hasOrgPermission(orgRole, "org.members.remove")
    ) {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const member_id = searchParams.get("member_id");

    if (!member_id) {
      return NextResponse.json({ error: "缺少 member_id" }, { status: 400 });
    }

    // Get target member's role
    const targetMember = await db
      .selectFrom("organization_member")
      .select(["role", "user_id"])
      .where("id", "=", member_id)
      .where("organization_id", "=", id)
      .executeTakeFirst();

    // Admin cannot remove owners
    if (
      targetMember?.role === "owner" &&
      !isSuperAdmin(globalRole) &&
      orgRole !== "owner"
    ) {
      return NextResponse.json({ error: "无法移除拥有者" }, { status: 403 });
    }

    // 不能移除唯一的 owner，否则组织将无人拥有
    if (targetMember?.role === "owner") {
      const { count: ownerCount } = await db
        .selectFrom("organization_member")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("organization_id", "=", id)
        .where("role", "=", "owner")
        .executeTakeFirstOrThrow();

      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: "不能移除唯一的拥有者，请先转让所有权" },
          { status: 400 },
        );
      }
    }

    // 离开组织只影响身份与维护责任：团队内容权限随成员关系失效，维护的素材交由
    // owner/admin 接管（maintained_by 置空），素材内容保持不变。
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("organization_member")
        .where("id", "=", member_id)
        .where("organization_id", "=", id)
        .execute();
      if (targetMember?.user_id) {
        await trx
          .updateTable("asset")
          .set({ maintained_by: null })
          .where("organization_id", "=", id)
          .where("maintained_by", "=", targetMember.user_id)
          .execute();
        await trx
          .insertInto("content_audit_log")
          .values({
            organization_id: id,
            actor_id: user.id,
            action: "organization.member.remove",
            object_type: "organization_member",
            object_id: targetMember.user_id,
            details: JSON.stringify({ maintained_assets_released: true }),
          })
          .execute();
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("移除组织成员失败:", error);
    await logErrorSafe({
      method: "DELETE",
      path: "/api/organizations/[id]/members",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "移除组织成员失败" }, { status: 500 });
  }
}
