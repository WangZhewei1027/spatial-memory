import { NextResponse, connection } from "next/server";
import { db, sql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { getUserContext } from "@/lib/permissions.server";
import { isSuperAdmin } from "@/lib/permissions";
import { logErrorSafe } from "@/lib/log-error";

const MAX_LIMIT = 200;

/**
 * Super-admin Error Log query endpoint. Verifies the caller is super_admin,
 * then delegates filtering + pagination + aggregation to the `error_log_query`
 * Postgres function (error_log is only ever touched from the server).
 * Returns { total, rows, stats } for the analysis page.
 *
 * Query params: scope, statusClass ('zero'|'4xx'|'5xx'), q, from, to, limit,
 * offset. All optional.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { globalRole } = await getUserContext(user.id);

    if (!isSuperAdmin(globalRole)) {
      await logErrorSafe({
        userId: user.id,
        method: "GET",
        path: "/api/errors/logs",
        status: 403,
        message: "权限不足: 仅 super_admin",
      });
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const statusClass = url.searchParams.get("statusClass");
    const q = url.searchParams.get("q");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const rawOffset = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
      : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const pScope = scope === "client" || scope === "api" || scope === "server" ? scope : null;
    const pStatusClass =
      statusClass === "zero" || statusClass === "4xx" || statusClass === "5xx"
        ? statusClass
        : null;
    const pQ = q && q.trim() ? q.trim() : null;
    const pFrom = from || null;
    const pTo = to || null;

    const { rows } = await sql<{ v: unknown }>`
      select public.error_log_query(
        ${pScope}, ${pStatusClass}, ${pQ}, ${pFrom}, ${pTo}, ${limit}, ${offset}
      ) as v
    `.execute(db);

    return NextResponse.json(rows[0].v);
  } catch (error) {
    console.error("获取错误日志失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/errors/logs",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取错误日志失败" }, { status: 500 });
  }
}
