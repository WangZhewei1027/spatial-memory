import "server-only";
import type { Instrumentation } from "next";
import { logError } from "@/lib/log-error";
import { stripQuery } from "./describe";

type RequestErrorArgs = Parameters<Instrumentation.onRequestError>;

/**
 * Persist an error Next.js caught outside our route handlers: Server
 * Component renders, Server Actions, the proxy and uncaught route throws.
 * Handled route failures return a response and never reach this hook.
 */
export async function logRequestError(error: RequestErrorArgs[0], request: RequestErrorArgs[1], context: RequestErrorArgs[2]): Promise<void> {
  await logError({
    scope: "server",
    method: request.method,
    path: stripQuery(request.path),
    status: 500,
    error,
    context: {
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
      revalidateReason: context.revalidateReason,
    },
  });
}
