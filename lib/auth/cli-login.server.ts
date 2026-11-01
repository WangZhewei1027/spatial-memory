import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAuthEndpoint, sensitiveSessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { CLI_LOGIN_LIFETIME_SECONDS, cliLoginCallbackUrl, isCliLoginToken, parseCliLoginRedirectUri, parseCliLoginRequest, type CliLoginRequest } from "./cli-login";

interface ExchangeRequest { code: string; codeVerifier: string; redirectUri: string }
interface Grant extends CliLoginRequest { userId: string }
interface ParsedBody<T> {
  "~standard": {
    version: 1; vendor: string; types?: { input: T; output: T };
    validate(input: unknown): { value: T } | { issues: { message: string }[] };
  };
}
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const identifier = (code: string) => `cli-login:${digest(code)}`;

function parseExchange(value: unknown): ExchangeRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["code", "codeVerifier", "redirectUri"].includes(key))) return null;
  const redirectUri = parseCliLoginRedirectUri(body.redirectUri);
  if (!redirectUri || !isCliLoginToken(body.code) || !isCliLoginToken(body.codeVerifier)) return null;
  return { code: body.code, codeVerifier: body.codeVerifier, redirectUri };
}

/** Standard Schema keeps HTTP bodies unknown until the shared parser accepts them. */
function bodySchema<T>(parse: (value: unknown) => T | null): ParsedBody<T> {
  return { "~standard": {
    version: 1 as const, vendor: "spatial-memory",
    validate(input: unknown) {
      const value = parse(input);
      return value ? { value } : { issues: [{ message: "Invalid CLI login parameters" }] };
    },
  } };
}

function parseGrant(value: string): Grant | null {
  try {
    const body: unknown = JSON.parse(value);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const { userId, ...parameters } = body as Record<string, unknown>;
    const request = parseCliLoginRequest(parameters);
    return request && typeof userId === "string" && userId ? { ...request, userId } : null;
  } catch { return null; }
}

function matchesGrant(grant: Grant | null, request: ExchangeRequest): grant is Grant {
  return !!grant && grant.redirectUri === request.redirectUri
    && timingSafeEqual(Buffer.from(grant.codeChallenge), Buffer.from(digest(request.codeVerifier)));
}

/** Browser consent issues a short-lived PKCE grant; only its CLI can create a new session. */
export function cliLogin() {
  return {
    id: "cli-login",
    endpoints: {
      authorizeCliLogin: createAuthEndpoint("/cli/authorize", {
        method: "POST", body: bodySchema(parseCliLoginRequest), use: [sensitiveSessionMiddleware],
        metadata: { noStore: true },
      }, async ctx => {
        if (ctx.request?.headers.get("origin") !== new URL(ctx.context.baseURL).origin) throw ctx.error("FORBIDDEN", { code: "INVALID_ORIGIN", message: "A same-origin browser request is required" });
        const code = randomBytes(32).toString("base64url");
        await ctx.context.internalAdapter.createVerificationValue({
          identifier: identifier(code), value: JSON.stringify({ ...ctx.body, userId: ctx.context.session.user.id }),
          expiresAt: new Date(Date.now() + CLI_LOGIN_LIFETIME_SECONDS * 1000),
        });
        return ctx.json({ redirectUrl: cliLoginCallbackUrl(ctx.body, { code }) });
      }),
      exchangeCliLogin: createAuthEndpoint("/cli/exchange", {
        method: "POST", body: bodySchema(parseExchange), metadata: { noStore: true },
      }, async ctx => {
        if (ctx.request?.headers.get("origin") !== new URL(ctx.context.baseURL).origin) throw ctx.error("FORBIDDEN", { code: "INVALID_ORIGIN", message: "A same-origin request is required" });
        const key = identifier(ctx.body.code);
        const record = await ctx.context.internalAdapter.findVerificationValue(key);
        const invalid = () => ctx.error("BAD_REQUEST", { code: "INVALID_CLI_GRANT", message: "CLI login code is invalid or expired" });
        // Check PKCE before consuming: a wrong verifier must not invalidate a real login.
        if (!record || !matchesGrant(parseGrant(record.value), ctx.body)) throw invalid();
        const consumed = await ctx.context.internalAdapter.consumeVerificationValue(key);
        const grant = consumed ? parseGrant(consumed.value) : null;
        if (!matchesGrant(grant, ctx.body)) throw invalid();
        const user = await ctx.context.internalAdapter.findUserById(grant.userId);
        if (!user) throw invalid();
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) throw ctx.error("INTERNAL_SERVER_ERROR", { code: "CLI_SESSION_FAILED", message: "Unable to create CLI session" });
        await setSessionCookie(ctx, { session, user }, false);
        return ctx.json({ user: { id: user.id, name: user.name, email: user.email } });
      }),
    },
    rateLimit: [
      { pathMatcher: (path: string) => path === "/cli/authorize", window: 60, max: 10 },
      { pathMatcher: (path: string) => path === "/cli/exchange", window: 60, max: 30 },
    ],
  };
}
