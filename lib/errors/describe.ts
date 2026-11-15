// Error description shared by the browser reporters and the server error log.
// Pure and client-safe: no Node, DOM or database access.

export const MAX_ERROR_MESSAGE = 2000;
export const MAX_ERROR_STACK = 4000;

/** Build identifier inlined by next.config.ts; "dev" outside production builds. */
export const APP_RELEASE = process.env.NEXT_PUBLIC_APP_RELEASE || "dev";

export interface ErrorDescription {
  message: string;
  name?: string;
  stack?: string;
  /** Driver or domain code, e.g. a PostgreSQL SQLSTATE. */
  code?: string;
  cause?: string;
  /** Next.js digest linking a server render failure to the browser boundary. */
  digest?: string;
}

export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Normalize any thrown value into bounded, JSON-safe fields. */
export function describeError(error: unknown): ErrorDescription {
  if (!(error instanceof Error)) {
    return { message: truncate(stringify(error), MAX_ERROR_MESSAGE) };
  }
  const description: ErrorDescription = {
    message: truncate(error.message || error.name, MAX_ERROR_MESSAGE),
    name: error.name,
  };
  if (error.stack) description.stack = truncate(error.stack, MAX_ERROR_STACK);
  const { code, digest } = error as { code?: unknown; digest?: unknown };
  if (typeof code === "string" || typeof code === "number") description.code = String(code);
  if (typeof digest === "string") description.digest = digest;
  if (error.cause !== undefined) {
    const cause = error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : stringify(error.cause);
    description.cause = truncate(cause, MAX_ERROR_MESSAGE);
  }
  return description;
}

/** Drop query and fragment: they can carry invitation tokens or user input. */
export function stripQuery(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}
