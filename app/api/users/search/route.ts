import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { getUserContext } from "@/lib/permissions.server";
import { hasOrgPermission, isSuperAdmin } from "@/lib/permissions";
import { logError } from "@/lib/log-error";
import { PHONE_EMAIL_DOMAIN } from "@/lib/phone-email";

// org 范围内的用户搜索（供成员页邀请/添加）。
// 必须带 organization_id 且调用者对该 org 有 org.members.add；查询用邮箱精确
// 或 name/email ≥3 字符前缀（非全表模糊），降低用户枚举面。
export async function GET(request: Request) {
  // 会话读取放在 try 外：构建期预渲染靠它的拒绝来判定路由为动态，
  // 被 catch 吞掉会打出一条无意义的失败日志
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organization_id");
    const q = (searchParams.get("q") ?? "").trim();

    if (!organizationId) {
      return NextResponse.json(
        { error: "缺少 organization_id" },
        { status: 400 },
      );
    }

    const { globalRole, orgRole } = await getUserContext(
      user.id,
      organizationId,
    );
    if (!isSuperAdmin(globalRole) && !hasOrgPermission(orgRole, "org.members.add")) {
      await logError({
        userId: user.id,
        method: "GET",
        path: "/api/users/search",
        status: 403,
        message: "权限不足: org.members.add",
        context: { orgRole, organizationId },
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    // 精确邮箱 或 ≥3 字符前缀；否则返回空，避免枚举
    let query = db
      .selectFrom("users")
      .select(["user_id", "name", "email"])
      .limit(20);

    if (q.includes("@")) {
      query = query.where("email", "=", q);
    } else if (/^\d{11}$/.test(q)) {
      // 完整手机号 → 精确匹配对应的虚拟邮箱（手机号注册用户）
      query = query.where("email", "=", `${q}@${PHONE_EMAIL_DOMAIN}`);
    } else if (q.length >= 3) {
      // 转义 LIKE 通配符（Postgres 默认转义符为反斜杠）
      const pattern = `${q.replace(/[%_\\]/g, "\\$&")}%`;
      query = query.where((eb) =>
        eb.or([eb("name", "ilike", pattern), eb("email", "ilike", pattern)]),
      );
    } else {
      return NextResponse.json({ data: [] });
    }

    const data = await query.execute();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("搜索用户失败:", error);
    await logError({
      method: "GET",
      path: "/api/users/search",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "搜索用户失败" }, { status: 500 });
  }
}
