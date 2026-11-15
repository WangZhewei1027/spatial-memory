import type { TFunction } from "i18next";
import { reportClientError } from "@/lib/errors/client-report";

// 统一把登录/注册/重置密码流程中的各种错误翻译成用户可读的 i18n 文案。
// 覆盖三类来源：
// 1. Better Auth 客户端返回的 error（{ code / status / message }，见 lib/auth/client.ts）
// 2. 浏览器网络层错误（fetch 失败、server action 调用失败）
// 3. 服务端 server action 返回的机器码（lib/auth/sms.ts 的 code 字段）
//
// UI 上永远只显示映射后的文案，绝不透出原始英文报错；
// 未识别的错误原文通过 /api/errors 静默上报到 error_log 供排查。

// 网络层失败的常见报错：Chrome "Failed to fetch"、Node/undici "fetch failed"、
// Safari "Load failed"、Firefox "NetworkError..."、server action 请求失败
// "An unexpected response was received from the server"、超时/中断等。
const NETWORK_MESSAGE_RE =
  /failed to fetch|fetch failed|fail to fetch|network|load failed|unexpected response|timed? ?out|aborted|ERR_(NETWORK|CONNECTION|INTERNET)/i;

function messageToKey(msg: string): string | null {
  if (NETWORK_MESSAGE_RE.test(msg)) return "auth.errors.network";
  if (/invalid (login credentials|email or password|password)/i.test(msg)) {
    return "auth.errors.invalidCredentials";
  }
  if (/already (been )?registered|already exists/i.test(msg)) {
    return "auth.errors.userExists";
  }
  if (/email not (confirmed|verified)/i.test(msg)) {
    return "auth.errors.emailNotConfirmed";
  }
  if (/rate limit|too many/i.test(msg)) return "auth.errors.rateLimited";
  if (/password.*(weak|short|at least)/i.test(msg)) {
    return "auth.errors.weakPassword";
  }
  if (/invalid token|token expired/i.test(msg)) {
    return "auth.errors.resetLinkInvalid";
  }
  return null;
}

/** 根据错误对象推断 i18n key（auth.errors.* 或已有的 auth.* key） */
export function authErrorKey(error: unknown): string {
  if (typeof error === "string") {
    return messageToKey(error) ?? "auth.errors.unknown";
  }
  if (!error || typeof error !== "object") {
    return "auth.errors.unknown";
  }

  const { status, code, message } = error as {
    status?: number;
    code?: string;
    message?: string;
  };

  // 网络层失败：fetch 本身抛出的 TypeError，或 server action 请求本身失败
  if (status === 0 || error instanceof TypeError) {
    return "auth.errors.network";
  }

  // Better Auth 的限流只返回 429，没有稳定的 code
  if (status === 429) return "auth.errors.rateLimited";

  // Better Auth 的 BASE_ERROR_CODES（@better-auth/core/error）
  switch (code) {
    case "PROVIDER_NOT_FOUND":
      return "auth.errors.googleUnavailable";
    case "EMAIL_PASSWORD_SIGN_UP_DISABLED":
      return "auth.errors.emailSignUpDisabled";
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "USER_NOT_FOUND":
      return "auth.errors.invalidCredentials";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "auth.errors.userExists";
    case "EMAIL_NOT_VERIFIED":
      return "auth.errors.emailNotConfirmed";
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
      return "auth.errors.weakPassword";
    case "INVALID_EMAIL":
      return "auth.errors.invalidEmail";
    // 邮件重置链接里的 token 无效 / 过期
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "auth.errors.resetLinkInvalid";
    case "SESSION_EXPIRED":
    case "SESSION_NOT_FRESH":
      return "auth.errors.sessionExpired";
  }

  // 没有 code 的边缘路径，按 message 兜底匹配
  return messageToKey(message ?? "") ?? "auth.errors.unknown";
}

/** 未识别的错误静默上报到 error_log（复用公开的 /api/errors 通道），不打扰用户 */
function reportUnknownAuthError(raw: string): void {
  if (!raw) return;
  reportClientError({ method: "auth.unknown", message: raw });
}

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return "";
}

/**
 * 把错误翻译成给用户看的文案。UI 只显示干净的 i18n 文案；
 * 未识别的错误显示通用提示，原文上报到 error_log。
 */
export function formatAuthError(t: TFunction, error: unknown): string {
  const key = authErrorKey(error);
  if (key === "auth.errors.unknown") {
    console.error("[auth] unrecognized error:", error);
    reportUnknownAuthError(rawMessage(error));
  }
  return t(key);
}

/** 服务端 server action 返回的机器码 → i18n key（见 lib/auth/sms.ts） */
const SERVER_CODE_KEYS: Record<string, string> = {
  sms_rate_limited: "auth.errors.smsRateLimited",
  invalid_phone: "auth.errors.invalidPhone",
  sms_send_failed: "auth.errors.smsSendFailed",
  code_invalid: "auth.invalidOtpCode",
  code_expired: "auth.otpExpired",
  user_exists: "auth.errors.userExists",
  user_not_found: "auth.errors.phoneNotRegistered",
  unauthorized: "auth.errors.sessionExpired",
  password_too_short: "auth.errors.weakPassword",
};

/**
 * 翻译 server action 的失败结果。优先用机器码；没有匹配时尝试按
 * 原始 message 识别，仍未识别则显示通用提示并上报原文。
 */
export function formatServerAuthError(
  t: TFunction,
  result: { code?: string; error?: string },
  fallbackKey = "auth.errors.unknown",
): string {
  let key = result.code ? SERVER_CODE_KEYS[result.code] : undefined;
  if (!key && result.error) key = messageToKey(result.error) ?? undefined;
  if (!key) key = fallbackKey;
  if (key === "auth.errors.unknown") {
    console.error("[auth] unrecognized server error:", result);
    reportUnknownAuthError(result.error ?? result.code ?? "");
  }
  return t(key);
}
