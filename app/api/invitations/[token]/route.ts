import { NextResponse } from "next/server";
import { db, sql, jsonObjectFrom } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { logError } from "@/lib/log-error";

interface InvitationRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  role: string;
  revoked: boolean;
  expires_at: Date | null;
  use_count: number;
}

function invalidReason(inv: InvitationRow | null): string | null {
  if (!inv) return "邀请无效";
  if (inv.revoked) return "邀请已撤销";
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now())
    return "邀请已过期";
  return null;
}

// 预览邀请（不写库，供 /invite 页展示；无需登录）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    const inv = await db
      .selectFrom("organization_invitation")
      .select((eb) => [
        "organization_invitation.id",
        "organization_invitation.organization_id",
        "organization_invitation.workspace_id",
        "organization_invitation.role",
        "organization_invitation.revoked",
        "organization_invitation.expires_at",
        "organization_invitation.use_count",
        jsonObjectFrom(
          eb
            .selectFrom("organization")
            .select("organization.name")
            .whereRef("organization.id", "=", "organization_invitation.organization_id"),
        ).as("organization"),
      ])
      .where("organization_invitation.token", "=", token)
      .executeTakeFirst();

    const reason = invalidReason(inv ?? null);

    return NextResponse.json({
      data: {
        valid: reason === null,
        reason,
        role: inv?.role ?? null,
        organization_name: inv?.organization?.name ?? null,
        has_workspace: Boolean(inv?.workspace_id),
      },
    });
  } catch (error) {
    console.error("预览邀请失败:", error);
    return NextResponse.json({ error: "预览邀请失败" }, { status: 500 });
  }
}

// 接受邀请（自动同意）：加入 org；workspace_id 只作为加入后的跳转目标返回
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const inv = await db
      .selectFrom("organization_invitation")
      .select([
        "id",
        "organization_id",
        "workspace_id",
        "role",
        "revoked",
        "expires_at",
        "use_count",
      ])
      .where("token", "=", token)
      .executeTakeFirst();

    const invitation: InvitationRow | null = inv ?? null;
    const reason = invalidReason(invitation);
    if (reason || !invitation) {
      return NextResponse.json({ error: reason ?? "邀请无效" }, { status: 400 });
    }

    // ① org 强制：先写成员行（幂等）
    await db
      .insertInto("organization_member")
      .values({
        organization_id: invitation.organization_id,
        user_id: user.id,
        role: invitation.role,
      })
      .onConflict((oc) =>
        oc.columns(["organization_id", "user_id"]).doNothing(),
      )
      .execute();

    // ② workspace 仅用于加入后的跳转：合集没有成员关系，团队角色即可访问全部合集，
    //    不再写入 workspace_assignment。

    // 使用计数仅作展示；加入已完成，计数写入失败不影响结果（沿用原实现：忽略该错误）
    await db
      .updateTable("organization_invitation")
      .set({ use_count: sql<number>`use_count + 1` })
      .where("id", "=", invitation.id)
      .execute()
      .catch(() => undefined);

    return NextResponse.json({
      data: {
        organization_id: invitation.organization_id,
        workspace_id: invitation.workspace_id,
      },
    });
  } catch (error) {
    console.error("接受邀请失败:", error);
    await logError({
      method: "POST",
      path: `/api/invitations/${token}`,
      status: 500,
      error,
    });
    return NextResponse.json({ error: "接受邀请失败" }, { status: 500 });
  }
}
