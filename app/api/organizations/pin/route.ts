import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { getUserContext } from "@/lib/permissions.server";
import { isSuperAdmin } from "@/lib/permissions";
import { logErrorSafe } from "@/lib/log-error";

// 置顶/取消置顶组织。用户级偏好，写 user_organization_pin。
// 没有 RLS 兜底，所有写入都显式限定为当前用户的 user_id。
export async function POST(request: Request) {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const organizationId =
      typeof body?.organizationId === "string" ? body.organizationId : null;
    const pinned = typeof body?.pinned === "boolean" ? body.pinned : null;

    if (!organizationId || pinned === null) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }

    // 只能置顶自己可见的组织：本组织成员，或 super_admin（可见全部）
    const { globalRole, orgRole } = await getUserContext(
      user.id,
      organizationId,
    );
    if (!isSuperAdmin(globalRole) && !orgRole) {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    if (pinned) {
      // 已置顶时保持原 pinned_at（置顶顺序不变），因此忽略冲突而非更新
      await db
        .insertInto("user_organization_pin")
        .values({ user_id: user.id, organization_id: organizationId })
        .onConflict((oc) =>
          oc.columns(["user_id", "organization_id"]).doNothing(),
        )
        .execute();
    } else {
      await db
        .deleteFrom("user_organization_pin")
        .where("user_id", "=", user.id)
        .where("organization_id", "=", organizationId)
        .execute();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("组织置顶操作失败:", error);
    await logErrorSafe({
      method: "POST",
      path: "/api/organizations/pin",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "操作失败" }, { status: 500 });
  }
}
