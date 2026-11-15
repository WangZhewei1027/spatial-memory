import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { getUserContext, getWorkspaceOrgId } from "@/lib/permissions.server";
import { hasOrgPermission, isSuperAdmin } from "@/lib/permissions";
import { logError } from "@/lib/log-error";

// 链接邀请可授予的角色（不含 owner —— 防泄露提权，授 owner 走直接添加）
const LINK_ROLES = ["admin", "member", "viewer"] as const;

async function requireInviteAccess(
  orgId: string,
  method: string,
): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未授权" }, { status: 401 }),
    };
  }

  const { globalRole, orgRole } = await getUserContext(user.id, orgId);
  if (!isSuperAdmin(globalRole) && !hasOrgPermission(orgRole, "org.members.add")) {
    await logError({
      userId: user.id,
      method,
      path: `/api/organizations/${orgId}/invitations`,
      status: 403,
      message: "权限不足: org.members.add",
      context: { orgRole },
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "权限不足" }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id };
}

// 列出该 org 未撤销的邀请
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const auth = await requireInviteAccess(id, "GET");
    if (!auth.ok) return auth.response;

    const data = await db
      .selectFrom("organization_invitation")
      .select([
        "id",
        "token",
        "role",
        "workspace_id",
        "expires_at",
        "use_count",
        "created_at",
        "created_by",
      ])
      .where("organization_id", "=", id)
      .where("revoked", "=", false)
      .orderBy("created_at", "desc")
      .execute();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取邀请列表失败:", error);
    await logError({
      method: "GET",
      path: `/api/organizations/${id}/invitations`,
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取邀请列表失败" }, { status: 500 });
  }
}

// 创建邀请链接
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const auth = await requireInviteAccess(id, "POST");
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const { role = "member", workspace_id = null, expires_at = null } = body;

    if (!LINK_ROLES.includes(role)) {
      return NextResponse.json(
        { error: "邀请链接不支持该角色（不可授予 owner）" },
        { status: 400 },
      );
    }

    // workspace_id 必须属于本 org
    if (workspace_id) {
      const wsOrg = await getWorkspaceOrgId(workspace_id);
      if (wsOrg !== id) {
        return NextResponse.json(
          { error: "workspace 不属于该组织" },
          { status: 400 },
        );
      }
    }

    const token = crypto.randomUUID();

    const data = await db
      .insertInto("organization_invitation")
      .values({
        organization_id: id,
        workspace_id,
        token,
        role,
        expires_at,
        created_by: auth.userId,
      })
      .returning(["id", "token", "role", "workspace_id", "expires_at"])
      .executeTakeFirstOrThrow();

    // 应用跑在反向代理之后，request.url 的 origin 是内网地址；
    // 邀请链接以站点公网地址为准，仅在未配置时退回请求 origin
    const origin = (
      process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
    ).replace(/\/+$/, "");
    return NextResponse.json(
      { data: { ...data, url: `${origin}/invite/${token}` } },
      { status: 201 },
    );
  } catch (error) {
    console.error("创建邀请失败:", error);
    await logError({
      method: "POST",
      path: `/api/organizations/${id}/invitations`,
      status: 500,
      error,
    });
    return NextResponse.json({ error: "创建邀请失败" }, { status: 500 });
  }
}

// 撤销邀请
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const auth = await requireInviteAccess(id, "DELETE");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const invitationId = searchParams.get("invitation_id");
    if (!invitationId) {
      return NextResponse.json(
        { error: "缺少 invitation_id" },
        { status: 400 },
      );
    }

    await db
      .updateTable("organization_invitation")
      .set({ revoked: true })
      .where("id", "=", invitationId)
      .where("organization_id", "=", id)
      .execute();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("撤销邀请失败:", error);
    await logError({
      method: "DELETE",
      path: `/api/organizations/${id}/invitations`,
      status: 500,
      error,
    });
    return NextResponse.json({ error: "撤销邀请失败" }, { status: 500 });
  }
}
