import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Auth gate (this is the Next.js middleware; Next 16 names the file proxy.ts).
// It only checks that a Better Auth session cookie is present — no DB round
// trip — so logged-out visitors are sent to /auth/login. Every page and API
// route re-validates the session server-side; this is not a security boundary.

const PUBLIC_PREFIXES = [
  "/auth",
  "/login",
  "/invite",
  "/instructions",
  "/api/auth",
  "/api/errors",
  // anonymous endpoints for the WeChat mini-program (docs/miniapp-api.md)
  "/api/miniapp",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/" || pathname === "/api/templates" || pathname === "/api/templates/duplicate") return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Reference-feature endpoint is intentionally public.
  return /^\/api\/assets\/[^/]+\/matching$/.test(pathname);
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname) || getSessionCookie(request)) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/auth/login";
  url.search = "";
  if (!pathname.startsWith("/api/")) url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/upload (streams large files; route verifies its own session)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets - .svg, .png, .jpg, .jpeg, .gif, .webp, .hdr, .b3dm, .json, .glb
     */
    "/((?!api/upload/?$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|hdr|b3dm|json|glb|gltf|bin)$).*)",
  ],
};
