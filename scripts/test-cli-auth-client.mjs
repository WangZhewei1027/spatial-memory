// Explicit cross-repository check: build ../spatial-memory-web-cli before running.
// No live database, user credentials, project .env files or external services.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { cliLogin } from "../lib/auth/cli-login.server.ts";
import { parseCliLoginRequest } from "../lib/auth/cli-login.ts";

const cli = fileURLToPath(new URL("../../spatial-memory-web-cli/dist/cli.js", import.meta.url));
await access(cli).catch(() => { throw new Error("Build the sibling CLI first: npm --prefix ../spatial-memory-web-cli run build"); });
const directory = await mkdtemp(join(tmpdir(), "spatial-memory-auth-contract-"));
const config = join(directory, "sessions.json");
const db = { user: [], account: [], session: [], verification: [] };
const children = new Set();
const requests = [];
let auth;
const server = createServer(async (request, response) => {
  try {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === "/api/users/me") {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      if (!session) { response.statusCode = 401; response.end(JSON.stringify({ error: "Unauthorized" })); return; }
      response.end(JSON.stringify({ data: { user_id: session.user.id, name: session.user.name, email: session.user.email } }));
      return;
    }
    await toNodeHandler(auth)(request, response);
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Test server failure" }));
  }
});

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  auth = betterAuth({
    baseURL: origin, secret: "cross-cli-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
    database: memoryAdapter(db), emailAndPassword: { enabled: true },
    plugins: [cliLogin()], logger: { disabled: true }, rateLimit: { enabled: false },
  });
  const post = (path, body, cookie = "") => fetch(`${origin}/api/auth${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
    body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(5000),
  });
  const signup = await post("/sign-up/email", { name: "CLI smoke fixture", email: "cli-smoke@example.test", password: "test-only-password-123" });
  assert.equal(signup.status, 200);
  const browserCookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const browserUser = (await signup.json()).user;

  function invoke(args, onStderr = () => {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args, "--base-url", origin, "--config", config], {
        cwd: directory,
        env: { ...process.env, SPATIAL_MEMORY_PASSWORD: "", SPATIAL_MEMORY_CLI_CONFIG: config, SPATIAL_MEMORY_BASE_URL: origin },
        stdio: ["pipe", "pipe", "pipe"],
      });
      children.add(child);
      let stdout = "", stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      child.stdout.on("data", value => { stdout += value; });
      child.stderr.on("data", value => { stderr += value; onStderr(stderr); });
      child.once("error", error => { clearTimeout(timer); children.delete(child); reject(error); });
      child.once("close", code => { clearTimeout(timer); children.delete(child); resolve({ code, stdout, stderr }); });
      child.stdin.end();
    });
  }

  let announce;
  const authorizationUrl = new Promise(resolve => { announce = resolve; });
  const loggingIn = invoke(["auth", "login", "--provider", "google", "--no-browser", "--login-timeout", "10000"], stderr => {
    const match = stderr.match(/^http:\/\/127\.0\.0\.1:\d+\/auth\/cli\?\S+$/m);
    if (match) announce(match[0]);
  });
  const target = new URL(await Promise.race([
    authorizationUrl,
    loggingIn.then(result => { throw new Error(`CLI exited before authorization: ${result.stderr}`); }),
  ]));
  assert.equal(target.origin, origin);
  const request = parseCliLoginRequest({
    redirectUri: target.searchParams.get("redirect_uri"), codeChallenge: target.searchParams.get("code_challenge"), state: target.searchParams.get("state"),
  });
  assert.ok(request, "the real CLI must create a request accepted by the Web contract");
  const approved = await post("/cli/authorize", request, browserCookie);
  assert.equal(approved.status, 200);
  assert.equal(approved.headers.get("cache-control"), "no-store");
  const { redirectUrl } = await approved.json();
  const callback = await fetch(redirectUrl, { redirect: "error", signal: AbortSignal.timeout(5000) });
  assert.equal(callback.status, 200);
  assert.equal(callback.headers.get("cache-control"), "no-store");
  const login = await loggingIn;
  assert.equal(login.code, 0, login.stderr);
  const authenticated = JSON.parse(login.stdout);
  assert.equal(authenticated.success, true);
  assert.equal(authenticated.provider, "google");
  assert.equal(authenticated.user.id, browserUser.id);
  assert.equal(authenticated.user.email, browserUser.email);
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(config, "utf8"));
  assert.deepEqual(Object.keys(saved.sessions), [origin]);
  assert.ok(saved.sessions[origin].some(cookie => cookie.name.endsWith("session_token")));
  assert.equal(db.session.length, 2, "CLI receives an independent session");
  for (const session of db.session) assert.ok(!`${login.stdout}${login.stderr}`.includes(session.token), "session tokens must not appear in CLI output");
  assert.ok(requests.includes("POST /api/auth/cli/exchange"));
  assert.ok(requests.includes("GET /api/users/me"));

  const status = await invoke(["auth", "status"]);
  assert.equal(status.code, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).data.user_id, browserUser.id);
  const logout = await invoke(["auth", "logout"]);
  assert.equal(logout.code, 0, logout.stderr);
  assert.deepEqual(JSON.parse(await readFile(config, "utf8")).sessions, {});
  assert.equal(db.session.length, 1);
  const browser = await auth.api.getSession({ headers: new Headers({ cookie: browserCookie }) });
  assert.equal(browser.user.id, browserUser.id, "CLI logout must preserve the browser session");
  assert.notEqual((await invoke(["auth", "status"])).code, 0);
  console.log("PASS real CLI → browser authorization → PKCE exchange → cookie persistence (0600) → status/logout; browser session remains valid");
} finally {
  for (const child of children) child.kill("SIGKILL");
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
