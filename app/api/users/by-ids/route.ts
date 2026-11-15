import { NextResponse, connection } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { logErrorSafe } from "@/lib/log-error";

// GET /api/users/by-ids?ids=a,b,c
// 按用户ID批量解析 name/email。用于资产过滤器展示创建者——创建者ID由前端从
// 已加载的资产列表里去重得到，这里只负责把这批ID解析成显示名，结果集很小。
export async function GET(request: Request) {
  // 会话依赖 cookies()，必须请求时渲染。connection() 要放在 try 之外：
  // build 预渲染的退出信号若被 catch 截获，会误写一条 500 错误日志
  await connection();
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const ids = (searchParams.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const data = await db
      .selectFrom("users")
      .select(["user_id", "name", "email"])
      .where("user_id", "in", ids)
      .execute();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("查询用户信息失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/users/by-ids",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
