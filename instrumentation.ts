import type { Instrumentation } from "next";

// Next.js calls this for errors it catches while serving a request (render,
// Server Action, proxy, uncaught route throws) — they would otherwise reach
// only stdout. The error log writes through pg, so it runs in Node only.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logRequestError } = await import("@/lib/errors/request-error.server");
  await logRequestError(error, request, context);
};
