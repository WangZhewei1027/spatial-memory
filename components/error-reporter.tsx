"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/errors/client-report";
import { describeError } from "@/lib/errors/describe";

/**
 * Global client-side error capture. Mounted once in the root layout.
 * Reports uncaught runtime errors and unhandled promise rejections to
 * /api/errors so they land in error_log alongside API/fetch failures.
 *
 * Note: console.error is intentionally NOT hooked — thrown errors already
 * surface via the `error` event, and React funnels render errors to
 * console.error too, so hooking it would double-log and add noise.
 */
export function ErrorReporter() {
  useEffect(() => {
    // dedup identical errors within this session to avoid floods
    const seen = new Set<string>();
    const once = (key: string) => {
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > 100) seen.clear();
      return true;
    };

    const onError = (e: ErrorEvent) => {
      const error = e.error === undefined ? undefined : describeError(e.error);
      const message = e.message || error?.message || "unknown error";
      if (!once(`${message}|${e.filename}|${e.lineno}`)) return;
      reportClientError({
        method: "window.error",
        message,
        context: {
          stack: error?.stack,
          name: error?.name,
          filename: e.filename,
          line: e.lineno,
          col: e.colno,
        },
      });
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const { message, ...error } = describeError(e.reason);
      if (!once(`rejection|${message}`)) return;
      reportClientError({ method: "unhandledrejection", message, context: error });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
