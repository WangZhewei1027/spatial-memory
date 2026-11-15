import "server-only";
import { db } from "@/lib/db";
import { APP_RELEASE, describeError, MAX_ERROR_MESSAGE, truncate } from "@/lib/errors/describe";

export interface LogErrorEntry {
  userId?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  /** Summary; defaults to the message of `error`. */
  message?: unknown;
  /** The thrown value: its stack, code and cause are kept in `context`. */
  error?: unknown;
  /** "api" for handled route failures, "server" for Next.js request errors. */
  scope?: "api" | "server";
  context?: Record<string, unknown> | null;
}

/** Row values for error_log; exported for tests. */
export function errorLogValues(entry: LogErrorEntry) {
  const { message: errorMessage, ...error } = entry.error === undefined ? { message: undefined } : describeError(entry.error);
  const message = entry.message ?? errorMessage;
  return {
    user_id: entry.userId ?? null,
    scope: entry.scope ?? "api",
    method: entry.method ?? null,
    path: entry.path ?? null,
    status: entry.status ?? null,
    message: message == null ? null : truncate(String(message), MAX_ERROR_MESSAGE),
    context: JSON.stringify({ ...entry.context, ...error, release: APP_RELEASE }),
  };
}

/**
 * Record a server-side failure into public.error_log. Fire-and-forget: it
 * never throws, so callers can `await logError(...)` safely without a
 * try/catch — a logging failure must never affect the main response.
 */
export async function logError(entry: LogErrorEntry): Promise<void> {
  try {
    await db.insertInto("error_log").values(errorLogValues(entry)).execute();
  } catch {
    // swallow — logging must not break the request
  }
}

/** Alias kept for call sites written against the Supabase-era API. */
export const logErrorSafe = logError;
