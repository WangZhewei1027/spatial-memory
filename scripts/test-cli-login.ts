import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { cliLogin } from "../lib/auth/cli-login.server";
import { googleRelay } from "../lib/auth/google-relay.server";
import { cliLoginCallbackUrl, isCliLoginToken, parseCliLoginRequest, parseCliLoginRedirectUri } from "../lib/auth/cli-login";
import { safeNext } from "../lib/safe-next";

const site = "https://app.example";
const token = () => randomBytes(32).toString("base64url");
const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const cookieHeader = (response: Response) => response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
const request = () => {
  const verifier = token();
  return { verifier, body: { redirectUri: "http://127.0.0.1:43210/callback", codeChallenge: challenge(verifier), state: token() } };
};

async function fixture(rateLimit = false) {
  const db: Record<string, Record<string, unknown>[]> = { user: [], account: [], session: [], verification: [] };
  const auth = betterAuth({
    baseURL: site, secret: "cli-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz", database: memoryAdapter(db),
    emailAndPassword: { enabled: true }, session: { cookieCache: { enabled: true } },
    plugins: [cliLogin()], rateLimit: { enabled: rateLimit }, logger: { disabled: true },
  });
  const post = (path: string, body: unknown, cookie = "", origin: string | null = site, ip = "192.0.2.15") => auth.handler(new Request(`${site}/api/auth${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  }));
  const signup = await post("/sign-up/email", { name: "CLI test", email: `${token()}@example.test`, password: "test-password-123" });
  assert.equal(signup.status, 200);
  const browserCookie = cookieHeader(signup);
  const grant = async () => {
    const input = request();
    const response = await post("/cli/authorize", input.body, browserCookie);
    assert.equal(response.status, 200, await response.clone().text());
    const { redirectUrl } = await response.json();
    const url = new URL(redirectUrl);
    assert.equal(url.origin + url.pathname, input.body.redirectUri);
    assert.equal(url.searchParams.get("state"), input.body.state);
    const code = url.searchParams.get("code");
    assert.ok(isCliLoginToken(code));
    return { ...input, code, response, exchange: { code, codeVerifier: input.verifier, redirectUri: input.body.redirectUri } };
  };
  return { auth, db, post, browserCookie, grant };
}

test("CLI callback parameters reject noncanonical and non-loopback destinations", () => {
  const input = request();
  assert.deepEqual(parseCliLoginRequest(input.body), input.body);
  const next = `/auth/cli?${new URLSearchParams({ redirect_uri: input.body.redirectUri, code_challenge: input.body.codeChallenge, state: input.body.state })}`;
  assert.equal(safeNext(next), next, "encoded loopback destination stays inside the same-origin Google return path");
  for (const redirectUri of [
    "http://127.0.0.1:80/callback", "http://127.0.0.1:65536/callback", "http://127.0.0.1:043210/callback",
    "http://localhost:43210/callback", "https://127.0.0.1:43210/callback", "http://[::1]:43210/callback",
    "http://127.1:43210/callback", "http://2130706433:43210/callback", "http://127.0.0.1:43210/other",
    "http://127.0.0.1:43210/callback?x=1", "http://127.0.0.1:43210/callback#fragment",
    "http://user@127.0.0.1:43210/callback", "http://127.0.0.1:43210/path/../callback",
    " http://127.0.0.1:43210/callback", "http://127.0.0.1:43210/callback\n", "https://evil.example/callback",
  ]) {
    assert.equal(parseCliLoginRedirectUri(redirectUri), null, redirectUri);
    assert.equal(parseCliLoginRequest({ ...input.body, redirectUri }), null, redirectUri);
  }
  for (const field of ["codeChallenge", "state"]) {
    for (const value of [null, "", "a".repeat(42), "a".repeat(44), "+".repeat(43)]) assert.equal(parseCliLoginRequest({ ...input.body, [field]: value }), null);
  }
  assert.equal(parseCliLoginRequest({ ...input.body, extra: true }), null);
  const denied = new URL(cliLoginCallbackUrl(input.body, { error: "access_denied" }));
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("state"), input.body.state);
});

test("Google OAuth callback completes the approved browser-to-CLI handoff", async t => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "cli-google-test", alg: "RS256", use: "sig" };
  const idToken = await new SignJWT({ email: "google-cli@example.test", email_verified: true, name: "Google CLI" })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setSubject("google-cli-subject")
    .setIssuer("https://accounts.google.com").setAudience("cli-google-client").setIssuedAt().setExpirationTime("1h").sign(privateKey);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://cli-google-relay.example");
    return Response.json(url.pathname === "/jwks" ? { keys: [jwk] } : { access_token: "google-access-secret", id_token: idToken, expires_in: 3600 });
  });
  const db: Record<string, Record<string, unknown>[]> = { user: [], account: [], session: [], verification: [] };
  const auth = betterAuth({
    baseURL: site, secret: "cli-google-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz", database: memoryAdapter(db),
    socialProviders: { google: { clientId: "cli-google-client", clientSecret: "google-client-secret" } },
    plugins: [googleRelay("https://cli-google-relay.example", "test-relay-secret-".repeat(4)), cliLogin()],
    rateLimit: { enabled: false }, logger: { disabled: true },
  });
  const post = (path: string, body: unknown, cookie = "") => auth.handler(new Request(`${site}/api/auth${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: site, cookie }, body: JSON.stringify(body),
  }));
  const input = request();
  const next = `/auth/cli?${new URLSearchParams({ redirect_uri: input.body.redirectUri, code_challenge: input.body.codeChallenge, state: input.body.state })}`;
  const start = await post("/sign-in/social", { provider: "google", callbackURL: next, errorCallbackURL: `${next}&error=google` });
  assert.equal(start.status, 200);
  const authorization = new URL((await start.json()).url);
  assert.equal(authorization.searchParams.get("redirect_uri"), `${site}/api/auth/callback/google`);
  const callback = await auth.handler(new Request(`${site}/api/auth/callback/google?code=google-auth-code&state=${authorization.searchParams.get("state")}`, { headers: { cookie: cookieHeader(start) } }));
  assert.equal(callback.status, 302);
  assert.equal(new URL(callback.headers.get("location")!, site).pathname + new URL(callback.headers.get("location")!, site).search, next);
  assert.equal(db.account[0].providerId, "google");
  const approved = await post("/cli/authorize", input.body, cookieHeader(callback));
  assert.equal(approved.status, 200);
  const redirect = new URL((await approved.json()).redirectUrl);
  assert.equal(redirect.searchParams.get("state"), input.body.state);
  const exchanged = await post("/cli/exchange", { code: redirect.searchParams.get("code"), codeVerifier: input.verifier, redirectUri: input.body.redirectUri });
  assert.equal(exchanged.status, 200);
  const result = await exchanged.json();
  assert.equal(result.user.email, "google-cli@example.test");
  assert.doesNotMatch(JSON.stringify(result), /google-access-secret|google-client-secret|session|token/i);
  const session = await auth.handler(new Request(`${site}/api/auth/get-session`, { headers: { cookie: cookieHeader(exchanged) } }));
  assert.equal((await session.json()).user.id, db.user[0].id);
  assert.equal(db.session.length, 2, "the browser and CLI get separate sessions");
});

test("CLI exchange creates a separate cookie session and exposes no bearer token", async () => {
  const f = await fixture(), grant = await f.grant();
  assert.equal(grant.response.headers.get("cache-control"), "no-store");
  assert.ok(!JSON.stringify(f.db.verification).includes(grant.code), "only the code hash is stored");
  assert.ok(!JSON.stringify(f.db.verification).includes(grant.verifier), "verifier stays on the CLI");
  const result = await f.post("/cli/exchange", grant.exchange);
  assert.equal(result.status, 200, await result.clone().text());
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(await result.json()), ["user"]);
  const cliCookie = cookieHeader(result);
  assert.ok(cliCookie.includes("session_token="));
  assert.notEqual(cliCookie, f.browserCookie);
  assert.equal(f.db.session.length, 2);
  const getSession = (cookie: string) => f.auth.handler(new Request(`${site}/api/auth/get-session`, { headers: { cookie } }));
  const cli = await (await getSession(cliCookie)).json(), browser = await (await getSession(f.browserCookie)).json();
  assert.equal(cli.user.id, browser.user.id);
  assert.notEqual(cli.session.token, browser.session.token);
  assert.equal((await f.post("/sign-out", {}, cliCookie)).status, 200);
  assert.ok((await (await getSession(f.browserCookie)).json()).user, "CLI logout preserves browser login");
  assert.equal((await f.post("/cli/exchange", grant.exchange)).status, 400, "code cannot be replayed");
});

test("authorization requires an authoritative session and exact same origin", async () => {
  const f = await fixture(), input = request();
  assert.equal((await f.post("/cli/authorize", input.body)).status, 401);
  assert.equal((await f.post("/cli/authorize", input.body, f.browserCookie, "https://evil.example")).status, 403);
  assert.equal((await f.post("/cli/authorize", input.body, f.browserCookie, null)).status, 403);
  f.db.session.splice(0);
  assert.equal((await f.post("/cli/authorize", input.body, f.browserCookie)).status, 401, "cached cookie cannot authorize after session revocation");
  assert.equal(f.db.verification.length, 0);
});

test("invalid verifier, redirect binding and cross-origin exchange cannot consume the code", async () => {
  const f = await fixture(), grant = await f.grant();
  assert.equal((await f.post("/cli/exchange", { ...grant.exchange, codeVerifier: token() })).status, 400);
  assert.equal((await f.post("/cli/exchange", { ...grant.exchange, redirectUri: "http://127.0.0.1:43211/callback" })).status, 400);
  assert.equal((await f.post("/cli/exchange", grant.exchange, "", "https://evil.example")).status, 403);
  assert.equal((await f.post("/cli/exchange", grant.exchange, "", null)).status, 403);
  assert.equal(f.db.verification.length, 1);
  assert.equal((await f.post("/cli/exchange", grant.exchange)).status, 200);
});

test("expired grants and deleted accounts cannot create a CLI session", async () => {
  const expired = await fixture(), oldGrant = await expired.grant();
  expired.db.verification[0].expiresAt = new Date(Date.now() - 1000);
  assert.equal((await expired.post("/cli/exchange", oldGrant.exchange)).status, 400);
  assert.equal(expired.db.session.length, 1);
  const removed = await fixture(), grant = await removed.grant();
  removed.db.user.splice(0);
  assert.equal((await removed.post("/cli/exchange", grant.exchange)).status, 400);
  assert.equal(removed.db.session.length, 1);
});

test("concurrent exchanges redeem exactly once", async () => {
  const f = await fixture(), grant = await f.grant();
  const results = await Promise.all(Array.from({ length: 6 }, () => f.post("/cli/exchange", grant.exchange)));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 400).length, 5);
  assert.equal(f.db.session.length, 2);
});

test("authorization and exchange reject malformed requests and apply dedicated rate limits", async () => {
  const f = await fixture();
  for (const body of [{}, { ...request().body, state: "bad" }, { ...request().body, redirectUri: "https://evil.example/callback" }]) assert.equal((await f.post("/cli/authorize", body, f.browserCookie)).status, 400);
  for (const body of [{}, { code: token(), codeVerifier: "bad", redirectUri: request().body.redirectUri }]) assert.equal((await f.post("/cli/exchange", body)).status, 400);
  const limited = await fixture(true), input = request();
  const responses = [];
  for (let index = 0; index < 11; index++) responses.push(await limited.post("/cli/authorize", input.body, limited.browserCookie, site, "198.51.100.50"));
  assert.equal(responses.filter(response => response.status === 200).length, 10);
  assert.equal(responses.at(-1)?.status, 429);
  const exchanges = [];
  for (let index = 0; index < 31; index++) exchanges.push(await limited.post("/cli/exchange", { code: token(), codeVerifier: token(), redirectUri: input.body.redirectUri }, "", site, "198.51.100.51"));
  assert.equal(exchanges.filter(response => response.status === 400).length, 30);
  assert.equal(exchanges.at(-1)?.status, 429);
});
