import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { sendMail, isMailConfigured } from "@/lib/email";
import { googleRelay } from "@/lib/auth/google-relay.server";

// Better Auth is the session + email/password provider that replaced Supabase
// Auth. Tables live in the `auth` schema (db/schema.sql); the `fields` maps
// below translate Better Auth's camelCase field names onto those snake_case
// columns, so both sides must change together.
//
// Password hashes are bcrypt so the hashes exported from Supabase keep
// working unchanged — users did not have to reset their passwords.
//
// Phone-number accounts are ordinary email/password accounts under a virtual
// email (lib/phone-email.ts); their creation and password reset bypass the
// HTTP endpoints and go through lib/auth/users.server.ts after the Aliyun SMS
// check, exactly like the Supabase admin API was used before.

const BCRYPT_ROUNDS = 10;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Built lazily: `next build` imports every route module without the runtime
// env (no BETTER_AUTH_SECRET / DATABASE_URL), and betterAuth() validates the
// secret eagerly.
function createAuth() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return betterAuth({
    appName: "Spatial Memory",
    baseURL: siteUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    // Password recovery is SMS-only, including for previously issued email tokens.
    disabledPaths: ["/request-password-reset", "/reset-password"],
    socialProviders: {
      ...(googleClientId && googleClientSecret
        ? {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            },
          }
        : {}),
    },
    trustedOrigins: [
      siteUrl,
      ...(process.env.AUTH_TRUSTED_ORIGINS?.split(",") ?? []),
    ]
      .map((s) => s.trim())
      .filter(Boolean),
    database: { db, type: "postgres", schemaName: "auth" },
    advanced: {
      database: {
        generateId: "uuid",
        // The runtime schema check introspects the connection's search_path
        // and reports our `auth.*` tables as missing although every query is
        // schema-qualified and works; db/schema.sql is the source of truth.
        validateSchema: false,
      },
      // Running behind Caddy, which terminates TLS and forwards X-Forwarded-*.
      useSecureCookies: siteUrl.startsWith("https://"),
    },
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "session",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: {
      modelName: "account",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    emailAndPassword: {
      enabled: true,
      // Keep password login for existing accounts and SMS-created users.
      // New users must register through Google or verified phone server actions.
      disableSignUp: true,
      minPasswordLength: 6,
      // Only enforce confirmation when we can actually send the mail.
      requireEmailVerification:
        process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true" &&
        isMailConfigured(),
      password: {
        hash: (password) => bcrypt.hash(password, BCRYPT_ROUNDS),
        verify: ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },
    emailVerification: {
      sendOnSignUp: isMailConfigured(),
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "确认邮箱 / Confirm your email",
          text: `点击以下链接完成邮箱确认：\n${url}`,
        });
      },
    },
    plugins: [
      ...(process.env.GOOGLE_RELAY_URL
        ? [googleRelay(process.env.GOOGLE_RELAY_URL, process.env.GOOGLE_RELAY_SECRET ?? "")]
        : []),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | null = null;

/** The Better Auth instance (created on first use). */
export function getAuth(): Auth {
  return (instance ??= createAuth());
}

export type SessionUser = Auth["$Infer"]["Session"]["user"];

/**
 * The signed-in user for the current request, or null. Replaces
 * `supabase.auth.getUser()` in route handlers, server components and server
 * actions. Reads cookies via next/headers, so it must be awaited inside a
 * request scope (in `cacheComponents` mode: inside a Suspense boundary or a
 * route handler).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Opt the caller out of build-time prerendering (cacheComponents): a session
  // lookup is always per-request, and this keeps `next build` from touching
  // Better Auth / the database at all.
  await connection();
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}
