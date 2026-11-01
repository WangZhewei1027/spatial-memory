/** The browser and server share the exact CLI handoff parameters. */
export const CLI_LOGIN_LIFETIME_SECONDS = 120;

export interface CliLoginRequest {
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

export function isCliLoginToken(value: unknown): value is string {
  return typeof value === "string" && value.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Only canonical IPv4 loopback callbacks on unprivileged ports are allowed. */
export function parseCliLoginRedirectUri(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() !== value) return null;
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{3,4})\/callback$/.exec(value);
  if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535) return null;
  return value;
}

export function parseCliLoginRequest(value: unknown): CliLoginRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !["redirectUri", "codeChallenge", "state"].includes(key))) return null;
  const redirectUri = parseCliLoginRedirectUri(record.redirectUri);
  if (!redirectUri || !isCliLoginToken(record.codeChallenge) || !isCliLoginToken(record.state)) return null;
  return { redirectUri, codeChallenge: record.codeChallenge, state: record.state };
}

export function cliLoginCallbackUrl(request: CliLoginRequest, result: { code: string } | { error: "access_denied" }): string {
  const url = new URL(request.redirectUri);
  if ("code" in result) url.searchParams.set("code", result.code);
  else url.searchParams.set("error", result.error);
  url.searchParams.set("state", request.state);
  return url.toString();
}
