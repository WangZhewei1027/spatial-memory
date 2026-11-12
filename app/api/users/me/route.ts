import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { logErrorSafe } from "@/lib/log-error";

export async function GET() {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const data = await db
      .selectFrom("users")
      .select(["user_id", "name", "email", "role"])
      .where("user_id", "=", user.id)
      .executeTakeFirstOrThrow();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("获取个人信息失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/users/me",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取个人信息失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
    }

    if (name.length > 50) {
      return NextResponse.json(
        { error: "名称不能超过 50 个字符" },
        { status: 400 },
      );
    }

    const data = await db
      .updateTable("users")
      .set({ name })
      .where("user_id", "=", user.id)
      .returning(["user_id", "name", "email", "role"])
      .executeTakeFirstOrThrow();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("更新个人信息失败:", error);
    await logErrorSafe({
      method: "PATCH",
      path: "/api/users/me",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "更新个人信息失败" }, { status: 500 });
  }
}
