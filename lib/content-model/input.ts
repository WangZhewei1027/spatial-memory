import { invalid } from "./errors";

// Small strict readers for request bodies. Each throws VALIDATION_FAILED with
// the field name; none of them coerce types silently.

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) throw invalid(`${field} 必须是对象`);
  return value;
}

export function rejectUnknown(body: JsonRecord, allowed: readonly string[], field = "请求"): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw invalid(`${field}包含未知字段: ${unknown.join(", ")}`);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw invalid(`${field} 必须是 UUID`);
  return value.toLowerCase();
}

export function optionalUuid(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireUuid(value, field);
}

export function requireUuidList(value: unknown, field: string, max = 100): string[] {
  if (!Array.isArray(value)) throw invalid(`${field} 必须是数组`);
  if (value.length > max) throw invalid(`${field} 最多 ${max} 项`);
  return [...new Set(value.map((item) => requireUuid(item, field)))];
}

export function requireString(value: unknown, field: string, opts: { max?: number; min?: number; trim?: boolean } = {}): string {
  if (typeof value !== "string") throw invalid(`${field} 必须是字符串`);
  const text = opts.trim === false ? value : value.trim();
  if (text.length < (opts.min ?? 1)) throw invalid(`${field} 不能为空`);
  if (text.length > (opts.max ?? 200)) throw invalid(`${field} 不能超过 ${opts.max ?? 200} 个字符`);
  return text;
}

export function optionalString(value: unknown, field: string, opts: { max?: number } = {}): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireString(value, field, { ...opts, min: 0 }) || null;
}

export function requireInt(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw invalid(`${field} 必须是 ${min}–${max} 之间的整数`);
  return value;
}

export function optionalInt(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return value === undefined ? undefined : requireInt(value, field, min, max);
}

export function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw invalid(`${field} 必须是 ${min}–${max} 之间的数字`);
  return value;
}

export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw invalid(`${field} 必须是 ${allowed.join(" / ")}`);
  return value as T;
}

export function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  return value === undefined ? undefined : requireEnum(value, field, allowed);
}

/** Client-chosen key for retry-safe create commands. */
export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(value))
    throw invalid("idempotencyKey 必须是 8–128 位的字母、数字或 ._:-");
  return value;
}

export function optionalIdempotencyKey(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : requireIdempotencyKey(value);
}

/** Query-string integer with bounds and default. */
export function queryInt(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw invalid(`${name} 必须是 ${min}–${max} 之间的整数`);
  return value;
}

/** PostgreSQL ILIKE substring search, treating user-entered %, _ and backslashes literally. */
export function nameContainsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}
