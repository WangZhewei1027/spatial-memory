import { NextResponse } from "next/server";
import { logError } from "@/lib/log-error";

// Helpers shared by the public /api/miniapp/* routes. These endpoints are
// called anonymously by the WeChat mini-program (no session), so every input
// is validated here and responses are never cached.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_IDS = 50;

export class MiniappError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "MiniappError";
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Required UUID body/query field. */
export function requireUuid(value: unknown, name: string): string {
  if (!isUuid(value)) throw new MiniappError(`Invalid ${name}`);
  return value;
}

/** Optional UUID: null/undefined/"" → null; anything else must be a UUID. */
export function optionalUuid(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requireUuid(value, name);
}

export function finiteNumber(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
    throw new MiniappError(`Invalid ${name}`);
  return n;
}

/** `?ids=a,b,c` → distinct UUID list (1..MAX_IDS). */
export function parseIds(request: Request): string[] {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  if (ids.length === 0 || ids.length > MAX_IDS)
    throw new MiniappError(`ids must contain 1–${MAX_IDS} values`);
  for (const id of ids) requireUuid(id, "ids");
  return ids;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new MiniappError("Request body must be a JSON object");
  return body as Record<string, unknown>;
}

/** Client address as seen behind Caddy (X-Forwarded-For), for rate limiting. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Per-device key for rate limiting. The mini-program sends a random id it
 * keeps in local storage (`X-Client-Id`), because many visitors can share
 * one public IP (venue Wi-Fi, carrier NAT). Without a well-formed id the
 * client IP is used. The id is self-asserted: rotating it escapes the
 * per-device limit, so every route that uses this also keeps a shared cap.
 */
export function clientKey(request: Request): string {
  const id = request.headers.get("x-client-id");
  return id && CLIENT_ID_RE.test(id) ? `id:${id}` : `ip:${clientIp(request)}`;
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Uniform error mapping for the miniapp routes; unexpected failures are logged. */
export async function errorResponse(error: unknown, request: Request, fallback = "服务暂不可用"): Promise<NextResponse> {
  if (error instanceof MiniappError) {
    return json({ error: error.message }, error.status);
  }
  const path = new URL(request.url).pathname;
  console.error(`[miniapp ${request.method} ${path}]`, error);
  await logError({ method: request.method, path, status: 503, error });
  return json({ error: fallback }, 503);
}
