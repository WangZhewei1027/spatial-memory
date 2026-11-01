/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness loads real TypeScript modules in memory. */
// Run with: node --test scripts/test-sms-auth.cjs
// Transpile the real server actions in memory; account storage and Aliyun SDK are fakes; Better Auth endpoint tests use its memory adapter.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

process.env.SMS_TICKET_SECRET = "test-sms-ticket-secret";

function loader(mocks = {}) {
  // This harness intentionally executes server modules outside Next.js.
  mocks = { "server-only": {}, ...mocks };
  const cache = new Map();
  function load(relative) {
    const filename = path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module);
    cache.set(filename, mod);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    const standard = mod.require.bind(mod);
    mod.require = (name) => {
      if (name in mocks) return mocks[name];
      if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
      return standard(name);
    };
    mod._compile(
      ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
      filename,
    );
    return mod.exports;
  }
  return load;
}

const PHONE = "13800138000";
const EMAIL = `${PHONE}@phone.spatialmemory.local`;

test("migrated phone identities display as phone numbers", () => {
  const phoneEmail = loader()("lib/phone-email.ts");
  assert.equal(phoneEmail.PHONE_EMAIL_DOMAIN, "phone.spatialmemory.local");
  assert.equal(phoneEmail.displayAccount(EMAIL), PHONE);
  assert.equal(phoneEmail.displayAccount(EMAIL.toUpperCase()), PHONE);
  assert.equal(phoneEmail.displayAccount("retained@example.invalid"), "retained@example.invalid");
});

function loadSms({ users = [], verifyResult = "PASS" } = {}) {
  const calls = { findUser: [], setPassword: [], createUser: [], send: [], check: [] };
  class Request {
    constructor(value) { Object.assign(this, value); }
  }
  const load = loader({
    "@/lib/auth/users.server": {
      findAuthUserByEmail: async (email) => {
        calls.findUser.push(email);
        return users.find((user) => user.email === email) ?? null;
      },
      setUserPassword: async (id, password) => { calls.setPassword.push({ id, password }); },
      createUserWithPassword: async (attrs) => {
        calls.createUser.push(attrs);
        return { id: "new-user" };
      },
      UserExistsError: class extends Error {},
    },
    "@alicloud/dypnsapi20170525": {
      __esModule: true,
      default: class {
        async sendSmsVerifyCodeWithOptions(request) {
          calls.send.push(request);
          return { body: { code: "OK" } };
        }
        async checkSmsVerifyCodeWithOptions(request) {
          calls.check.push(request);
          return { body: { code: "OK", model: { verifyResult } } };
        }
      },
      SendSmsVerifyCodeRequest: Request,
      CheckSmsVerifyCodeRequest: Request,
    },
    "@alicloud/openapi-client": { Config: Request },
    "@alicloud/tea-util": { RuntimeOptions: Request },
    "@alicloud/credentials": { __esModule: true, default: class {} },
  });
  return { sms: load("lib/auth/sms.ts"), ticket: load("lib/auth/sms-ticket.server.ts"), calls };
}

test("ticket verifies only for the same account before expiry", () => {
  const { ticket } = loadSms();
  const now = 1_700_000_000_000;
  const issued = ticket.issueSmsTicket(EMAIL, now);
  assert.equal(ticket.verifySmsTicket(issued, EMAIL, now + 60_000), true);
  assert.equal(ticket.verifySmsTicket(issued, `13900139000@phone.spatialmemory.local`, now), false);
  assert.equal(ticket.verifySmsTicket(issued, EMAIL, now + 10 * 60 * 1000), false);
});

test("forged, tampered and malformed tickets are rejected", () => {
  const { ticket } = loadSms();
  const issued = ticket.issueSmsTicket("13900139000@phone.spatialmemory.local");
  const [, signature] = issued.split(".");
  const forgedPayload = Buffer.from(`${EMAIL}|${Date.now() + 60_000}`).toString("base64url");
  assert.equal(ticket.verifySmsTicket(`${forgedPayload}.${signature}`, EMAIL), false);
  for (const bad of [undefined, null, 42, "", "abc", "a.b", `${issued}.x`]) {
    assert.equal(ticket.verifySmsTicket(bad, EMAIL), false);
  }
});

test("ticket signed with another key is rejected", () => {
  const { ticket } = loadSms();
  process.env.SMS_TICKET_SECRET = "other-key";
  const foreign = ticket.issueSmsTicket(EMAIL);
  process.env.SMS_TICKET_SECRET = "test-sms-ticket-secret";
  assert.equal(ticket.verifySmsTicket(foreign, EMAIL), false);
});

test("CheckSmsVerifyCode issues a ticket only when the code passes", async () => {
  const passed = loadSms();
  const ok = await passed.sms.CheckSmsVerifyCode(PHONE, "123456");
  assert.equal(ok.success, true);
  assert.equal(passed.ticket.verifySmsTicket(ok.ticket, EMAIL), true);

  const failed = loadSms({ verifyResult: "UNKNOWN" });
  const bad = await failed.sms.CheckSmsVerifyCode(PHONE, "000000");
  assert.equal(bad.success, false);
  assert.equal(bad.ticket, undefined);
});

test("resetPasswordByPhone refuses without a valid ticket for that phone", async () => {
  const { sms, ticket, calls } = loadSms({ users: [{ id: "victim", email: EMAIL }] });
  const otherPhoneTicket = ticket.issueSmsTicket("13900139000@phone.spatialmemory.local");
  for (const t of [undefined, "", "forged.ticket", otherPhoneTicket]) {
    const result = await sms.resetPasswordByPhone({ phone: PHONE, newPassword: "hacked123", ticket: t });
    assert.equal(result.success, false);
    assert.equal(result.code, "code_expired");
  }
  assert.equal(calls.findUser.length, 0);
  assert.equal(calls.setPassword.length, 0);
});

test("resetPasswordByPhone looks up the verified account directly", async () => {
  const users = Array.from({ length: 1500 }, (_, i) => ({ id: `u${i}`, email: `${i}@example.com` }));
  users[1234] = { id: "target", email: EMAIL };
  const { sms, ticket, calls } = loadSms({ users });
  const result = await sms.resetPasswordByPhone({
    phone: PHONE,
    newPassword: "new-password",
    ticket: ticket.issueSmsTicket(EMAIL),
  });
  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls.findUser, [EMAIL]);
  assert.deepEqual(calls.setPassword, [{ id: "target", password: "new-password" }]);
});

test("resetPasswordByPhone reports an unregistered phone", async () => {
  const users = Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, email: `${i}@example.com` }));
  const { sms, ticket, calls } = loadSms({ users });
  const result = await sms.resetPasswordByPhone({
    phone: PHONE,
    newPassword: "new-password",
    ticket: ticket.issueSmsTicket(EMAIL),
  });
  assert.equal(result.code, "user_not_found");
  assert.deepEqual(calls.findUser, [EMAIL]);
  assert.equal(calls.setPassword.length, 0);
});

test("createUserByPhone requires a valid ticket for that phone", async () => {
  const { sms, ticket, calls } = loadSms();
  const rejected = await sms.createUserByPhone({ phone: PHONE, password: "password1", ticket: "" });
  assert.equal(rejected.userId, null);
  assert.equal(rejected.code, "code_expired");
  assert.equal(calls.createUser.length, 0);

  const created = await sms.createUserByPhone({
    phone: PHONE,
    password: "password1",
    ticket: ticket.issueSmsTicket(EMAIL),
  });
  assert.equal(created.userId, "new-user");
  assert.equal(calls.createUser.length, 1);
  assert.equal(calls.createUser[0].email, EMAIL);
});


test("only mainland China numbers are accepted before any SMS or account operation", async () => {
  const { sms, calls } = loadSms();
  for (const phone of ["", "1234567", "12800138000", "+12025550123", "+85291234567", "+886912345678", "138001380001", "abc13800138000", "legacy@example.com", null]) {
    assert.equal((await sms.SendSmsVerifyCode(phone)).code, "invalid_phone");
    assert.equal((await sms.CheckSmsVerifyCode(phone, "123456")).code, "invalid_phone");
    assert.equal((await sms.createUserByPhone({ phone, password: "password1", ticket: "" })).code, "invalid_phone");
    assert.equal((await sms.resetPasswordByPhone({ phone, newPassword: "password1", ticket: "" })).code, "invalid_phone");
  }
  for (const entries of Object.values(calls)) assert.equal(entries.length, 0);
});

test("+86 inputs use the same SMS destination, ticket and account as domestic inputs", async () => {
  const { sms, calls, ticket } = loadSms({ users: [{ id: "existing", email: EMAIL }] });
  for (const phone of [PHONE, `86${PHONE}`, `+86 ${PHONE}`, "138 0013-8000"]) {
    assert.equal((await sms.SendSmsVerifyCode(phone)).success, true);
    const checked = await sms.CheckSmsVerifyCode(phone, "123456");
    assert.equal(ticket.verifySmsTicket(checked.ticket, EMAIL), true);
    const created = await sms.createUserByPhone({ phone, password: "password1", ticket: checked.ticket });
    assert.equal(created.email, EMAIL);
    assert.equal((await sms.resetPasswordByPhone({ phone, newPassword: "password2", ticket: checked.ticket })).success, true);
  }
  assert.ok(calls.send.every((request) => request.phoneNumber === PHONE && request.countryCode === "86"));
  assert.ok(calls.check.every((request) => request.phoneNumber === PHONE && request.countryCode === "86"));
  assert.ok(calls.createUser.every((user) => user.email === EMAIL && user.emailVerified));
});

test("malformed codes and weak passwords cannot bypass phone verification rules", async () => {
  const { sms, calls, ticket } = loadSms();
  for (const code of ["123", "abcdef", "1234567", null]) {
    assert.equal((await sms.CheckSmsVerifyCode(PHONE, code)).code, "code_invalid");
  }
  const verified = ticket.issueSmsTicket(EMAIL);
  assert.equal((await sms.createUserByPhone({ phone: PHONE, password: "short", ticket: verified })).code, "password_too_short");
  assert.equal((await sms.resetPasswordByPhone({ phone: PHONE, newPassword: "short", ticket: verified })).code, "password_too_short");
  assert.equal(calls.check.length + calls.createUser.length + calls.setPassword.length, 0);
});

async function loadAuth({ google = true } = {}) {
  process.env.BETTER_AUTH_SECRET = "test-auth-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  process.env.GOOGLE_CLIENT_ID = google ? "test-client.apps.googleusercontent.com" : "";
  process.env.GOOGLE_CLIENT_SECRET = google ? "test-client-secret" : "";
  const sentMail = [];
  const load = loader({
    "server-only": {},
    "better-auth": { betterAuth: (options) => options },
    "better-auth/next-js": { nextCookies: () => ({ id: "test-next-cookies" }) },
    "next/headers": {},
    "next/server": {},
    "@/lib/db": { db: {} },
    "@/lib/email": { isMailConfigured: () => false, sendMail: async (mail) => { sentMail.push(mail); } },
  });
  const options = load("lib/auth/server.ts").getAuth();
  const { betterAuth } = await import("better-auth");
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const database = { users: [], account: [], session: [], verification: [] };
  const auth = betterAuth({ ...options, database: memoryAdapter(database), plugins: [], logger: { disabled: true }, rateLimit: { enabled: false } });
  const request = (route, body) => auth.handler(new Request(`http://localhost:3000/api/auth/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(body),
  }));
  return { auth, options, database, sentMail, request };
}

test("email self-sign-up is rejected by the real Better Auth endpoint", async () => {
  const { request, database } = await loadAuth();
  for (const email of ["new@example.com", EMAIL]) {
    const response = await request("sign-up/email", { email, password: "password1", name: "" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
  }
  assert.equal(database.users.length, 0);
});

test("existing email and phone accounts retain password login", async () => {
  const { auth, options, request } = await loadAuth();
  const context = await auth.$context;
  for (const email of ["legacy@example.com", EMAIL]) {
    const user = await context.internalAdapter.createUser({ email, name: "Existing user", emailVerified: true });
    await context.internalAdapter.createAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: await options.emailAndPassword.password.hash("old123") });
    const response = await request("sign-in/email", { email, password: "old123" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, user.id);
    assert.match(response.headers.get("set-cookie"), /session_token/);
    const failed = await request("sign-in/email", { email, password: "wrong-password" });
    assert.equal(failed.status, 401);
  }
});

test("email password recovery is disabled even for existing accounts and valid old tokens", async () => {
  const { auth, options, request, sentMail, database } = await loadAuth();
  const context = await auth.$context;
  assert.equal(options.emailAndPassword.sendResetPassword, undefined);
  for (const email of ["legacy@example.com", EMAIL]) {
    const user = await context.internalAdapter.createUser({ email, name: "Existing user", emailVerified: true });
    await context.internalAdapter.createAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: await options.emailAndPassword.password.hash("old123") });
    const before = database.verification.length;
    const reset = await request("request-password-reset", { email, redirectTo: "/auth/update-password" });
    assert.equal(reset.status, 404);
    assert.equal(database.verification.length, before);
    const token = `previously-issued-${user.id}`;
    await context.internalAdapter.createVerificationValue({ identifier: `reset-password:${token}`, value: user.id, expiresAt: new Date(Date.now() + 60000) });
    for (const [route, body] of [
      ["reset-password", { token, newPassword: "new-password" }],
      [`reset-password?token=${token}`, { newPassword: "new-password" }],
      ["reset-password/", { token, newPassword: "new-password" }],
    ]) {
      assert.equal((await request(route, body)).status, 404);
    }
    assert.equal((await request("sign-in/email", { email, password: "old123" })).status, 200);
    assert.equal((await request("sign-in/email", { email, password: "new-password" })).status, 401);
  }
  assert.equal(sentMail.length, 0);
});

test("Google OAuth starts with the configured callback and allows new registrations", async () => {
  const { auth, options, request } = await loadAuth();
  assert.deepEqual(Object.keys(options.socialProviders), ["google"]);
  assert.equal(options.socialProviders.google.disableSignUp, undefined);
  const response = await request("sign-in/social", { provider: "google", callbackURL: "/invite/test", errorCallbackURL: "/auth/login?next=%2Finvite%2Ftest&error=google" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const url = new URL(payload.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "test-client.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/callback/google");
  assert.ok(url.searchParams.get("state"));
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const cancelled = await auth.handler(new Request(`http://localhost:3000/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(url.searchParams.get("state"))}`, { headers: { cookie } }));
  assert.equal(cancelled.status, 302);
  const location = new URL(cancelled.headers.get("location"), "http://localhost:3000");
  assert.equal(location.pathname, "/auth/login");
  assert.equal(location.searchParams.get("next"), "/invite/test");
});

test("missing Google credentials return a known error without disabling password auth", async () => {
  const { request, options } = await loadAuth({ google: false });
  const response = await request("sign-in/social", { provider: "google", callbackURL: "/" });
  assert.equal((await response.json()).code, "PROVIDER_NOT_FOUND");
  assert.equal(options.emailAndPassword.enabled, true);
});
