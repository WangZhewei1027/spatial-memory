// Validation for browser reports posted to the public /api/errors sink.
// Pure: the route adds the session user, symbolication and the insert.

import { MAX_ERROR_MESSAGE, stripQuery, truncate } from "./describe";

const MAX_METHOD = 64;
const MAX_PATH = 500;
const MAX_RELEASE = 64;
/** Reports are anonymous; bound what one request can store. */
export const MAX_CLIENT_CONTEXT_BYTES = 16_000;

export interface ClientErrorRecord {
  method: string | null;
  path: string | null;
  status: number | null;
  message: string | null;
  context: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whitelist and bound an untrusted report body. */
export function parseClientErrorReport(body: unknown, serverRelease: string): ClientErrorRecord {
  const input = isRecord(body) ? body : {};
  const release = typeof input.release === "string" && input.release ? truncate(input.release, MAX_RELEASE) : serverRelease;
  let context: Record<string, unknown> = isRecord(input.context) ? { ...input.context } : {};
  if (JSON.stringify(context).length > MAX_CLIENT_CONTEXT_BYTES) {
    context = { truncated: true, ...(typeof context.stack === "string" ? { stack: truncate(context.stack, MAX_CLIENT_CONTEXT_BYTES / 2) } : {}) };
  }
  context.release = release;
  if (release !== serverRelease) context.server_release = serverRelease;
  return {
    method: typeof input.method === "string" ? truncate(input.method, MAX_METHOD) : null,
    path: typeof input.path === "string" ? truncate(stripQuery(input.path), MAX_PATH) : null,
    status: Number.isInteger(input.status) ? (input.status as number) : null,
    message: typeof input.message === "string" ? truncate(input.message, MAX_ERROR_MESSAGE) : null,
    context,
  };
}
