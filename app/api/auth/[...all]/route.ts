import { getAuth } from "@/lib/auth/server";
import { toNextJsHandler } from "better-auth/next-js";

// All Better Auth endpoints (/api/auth/sign-in/email, /api/auth/get-session, …).
// Resolved per request so the instance is created lazily (see lib/auth/server.ts).
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  const response = await toNextJsHandler(getAuth()).POST(request);
  if (["/api/auth/cli/authorize", "/api/auth/cli/exchange"].includes(new URL(request.url).pathname)) {
    // Include validation, origin, session and rate-limit failures rejected before the endpoint.
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Pragma", "no-cache");
  }
  return response;
}
