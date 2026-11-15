import { getSessionUser } from "@/lib/auth/server";
import {
  createUserWithPassword,
  deleteAuthUser,
  UserExistsError,
} from "@/lib/auth/users.server";
import { db } from "@/lib/db";
import { logErrorSafe } from "@/lib/log-error";
import { connection, NextResponse } from "next/server";

export async function GET() {
  await connection();
  try {
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
        method: "GET",
        path: "/api/users",
        status: 403,
        message: "权限不足: 仅 super_admin",
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    // 获取所有用户及其 workspace 分配情况（last_sign_in_at 由 auth.session
    // 触发器维护在 public.users 上）
    const data = await db
      .selectFrom("users")
      .select(["user_id", "name", "email", "role", "created_at", "last_sign_in_at"])
      .orderBy("created_at", "desc")
      .execute();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取用户列表失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/users",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取用户列表失败" }, { status: 500 });
  }
}

// 手动注册用户（仅 super_admin）。直接写入 auth.users / auth.account，
// 触发器 handle_new_user() 同步 public.users；邮箱自动确认，无需验证流程。
export async function POST(request: Request) {
  try {
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
        method: "POST",
        path: "/api/users",
        status: 403,
        message: "权限不足: 仅 super_admin 可创建用户",
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role: "user" | "super_admin" = body.role ?? "user";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "邮箱格式无效" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "密码长度至少 6 位" },
        { status: 400 },
      );
    }
    if (!["user", "super_admin"].includes(role)) {
      return NextResponse.json({ error: "无效的角色" }, { status: 400 });
    }

    let userId: string;
    try {
      ({ id: userId } = await createUserWithPassword({
        email,
        password,
        name,
        emailVerified: true,
      }));
    } catch (createError) {
      if (createError instanceof UserExistsError) {
        return NextResponse.json({ error: "该邮箱已被注册" }, { status: 400 });
      }
      throw createError;
    }

    // public.users 行已由触发器创建，这里只补写 name / role
    try {
      await db
        .updateTable("users")
        .set({ name: name || null, role })
        .where("user_id", "=", userId)
        .execute();
    } catch (updateError) {
      // 同步 public.users 失败则回滚 auth 用户，保证接口可重试
      await deleteAuthUser(userId);
      throw updateError;
    }

    return NextResponse.json({ data: { user_id: userId, email, name, role } });
  } catch (error) {
    console.error("创建用户失败:", error);
    await logErrorSafe({
      method: "POST",
      path: "/api/users",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "创建用户失败" }, { status: 500 });
  }
}
