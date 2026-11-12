import { getSessionUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { logError } from "@/lib/log-error";
import { NextResponse } from "next/server";
import "server-only";
import { loadActor, type Actor } from "./access.server";
import { type ApiErrorBody } from "./contracts";
import { ContentError } from "./errors";
import { isRecord, type JsonRecord } from "./input";

const NO_STORE = { "Cache-Control": "no-store" };

export function ok<T>(data: T, status = 200, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ...extra, data }, { status, headers: NO_STORE });
}

export function errorJson(error: ContentError): NextResponse {
  const body: ApiErrorBody = { error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) };
  return NextResponse.json(body, { status: error.status, headers: NO_STORE });
}


export async function readJsonBody(request: Request): Promise<JsonRecord> {
  const body: unknown = await request.json().catch(() => undefined);
  if (!isRecord(body)) throw new ContentError("VALIDATION_FAILED", "请求体必须是 JSON 对象");
  return body;
}

export async function requireSessionUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new ContentError("UNAUTHENTICATED", "未授权");
  return user.id;
}

interface PgError {
  code?: string;
  message?: string;
  constraint?: string;
}

/** Database errors that are client conflicts rather than server faults. */
export function mapDatabaseError(error: unknown): ContentError | null {
  if (!error || typeof error !== "object") return null;
  const pg = error as PgError;
  const message = typeof pg.message === "string" ? pg.message : "";
  if (pg.code === "55000" && message.includes("immutable")) return new ContentError("VALIDATION_FAILED", "已发布版本不可修改");
  if (pg.code === "23503") return new ContentError("DEPENDENCY_CONFLICT", "仍有内容依赖该对象，操作被拒绝");
  if (pg.code === "23505") return new ContentError("LOCK_VERSION_CONFLICT", "内容已被并发修改，请重新载入后重试");
  if (pg.code === "40001" || pg.code === "40P01") return new ContentError("LOCK_VERSION_CONFLICT", "并发冲突，请重试");
  if (pg.code === "23514" || pg.code === "22P02" || pg.code === "22023") return new ContentError("VALIDATION_FAILED", "数据不符合约束");
  return null;
}

export interface RouteContext {
  method: string;
  path: string;
  userId?: string | null;
}

/** Map any failure to the shared error envelope; unexpected ones are logged as 500. */
export async function failure(error: unknown, ctx: RouteContext): Promise<NextResponse> {
  const known = error instanceof ContentError ? error : mapDatabaseError(error);
  if (known) {
    if (known.status === 403 && ctx.userId)
      await logError({ userId: ctx.userId, method: ctx.method, path: ctx.path, status: 403, message: known.message });
    return errorJson(known);
  }
  console.error(`[${ctx.method} ${ctx.path}]`, error);
  await logError({
    userId: ctx.userId ?? null,
    method: ctx.method,
    path: ctx.path,
    status: 500,
    error,
  });
  return errorJson(new ContentError("INTERNAL", "服务器错误"));
}

/**
 * Standard route body: session → handler → `{ data }`, errors mapped.
 * The handler returns either data (wrapped with `status`) or a NextResponse.
 */
export async function handleRoute<T>(
  request: Request,
  path: string,
  handler: (userId: string) => Promise<T | NextResponse>,
  status = 200,
): Promise<NextResponse> {
  let userId: string | null = null;
  try {
    userId = await requireSessionUserId();
    const result = await handler(userId);
    return result instanceof NextResponse ? result : ok(result, status);
  } catch (error) {
    return failure(error, { method: request.method, path, userId });
  }
}

/** handleRoute + the caller's global role resolved once. */
export async function handleActorRoute<T>(
  request: Request,
  path: string,
  handler: (actor: Actor) => Promise<T | NextResponse>,
  status = 200,
): Promise<NextResponse> {
  return handleRoute(request, path, async (userId) => handler(await loadActor(db, userId)), status);
}
