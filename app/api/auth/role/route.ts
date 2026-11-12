import { NextResponse, connection } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { logErrorSafe } from "@/lib/log-error";

export async function GET() {
  await connection();
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const userData = await db
      .selectFrom("users")
      .select(["user_id", "role"])
      .where("user_id", "=", user.id)
      .executeTakeFirst();

    if (!userData) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    return NextResponse.json({
      userId: userData.user_id,
      role: userData.role,
    });
  } catch (error) {
    console.error("获取用户角色失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/auth/role",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取用户角色失败" }, { status: 500 });
  }
}
