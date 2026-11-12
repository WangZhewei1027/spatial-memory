import { toast } from "sonner";
import i18n from "@/lib/i18n/config";
import { reportClientError } from "@/lib/errors/client-report";

/** Thrown by fetchJson on any non-2xx response or network failure. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Unified client-side fetch for write/mutation calls.
 * - Parses JSON, returns the body on success.
 * - On failure: shows a toast (server's `error` message, or a fallback) and
 *   throws an ApiError so callers can still branch/await.
 * - Network failures (no response) are additionally reported to /api/errors;
 *   4xx/5xx are already logged server-side, so we don't double-log them.
 */
export async function fetchJson<T = unknown>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const method = init?.method ?? "GET";

  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (e) {
    const message = i18n.t("errors.network", "Network error, please try again later");
    toast.error(message);
    reportClientError({
      method,
      path: input,
      status: 0,
      message: e instanceof Error ? e.message : message,
    });
    throw new ApiError(message, 0);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ||
      i18n.t("errors.requestFailed", "Request failed ({{status}})", {
        status: res.status,
      });
    toast.error(message);
    throw new ApiError(message, res.status);
  }

  return body as T;
}
