// Browser-side reporter for /api/errors. Fire-and-forget: reporting must
// never throw into the caller or cascade into another report.

import { APP_RELEASE, MAX_ERROR_MESSAGE, stripQuery, truncate } from "./describe";

export interface ClientErrorReport {
  /** Origin of the report, e.g. "window.error" or "fetch". */
  method: string;
  message: string;
  /** Defaults to the current page path. */
  path?: string;
  status?: number;
  context?: Record<string, unknown>;
}

export function reportClientError(report: ClientErrorReport): void {
  if (typeof window === "undefined") return;
  try {
    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: report.method,
        path: stripQuery(report.path ?? window.location.pathname),
        status: report.status ?? 0,
        message: truncate(report.message, MAX_ERROR_MESSAGE),
        release: APP_RELEASE,
        context: { ...report.context, ua: navigator.userAgent },
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
