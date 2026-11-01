import type { ValidationIssue } from "./protocol";

/**
 * Shared helpers for the pure scene validators (validate-content.ts). No DB, no server-only imports: safe to use from
 * Client Components for instant feedback before upload.
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aliases and instance ids: letter first, then [A-Za-z0-9_-], max 32. */
export const ALIAS_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;

/** Collects issues while a validator walks a document. */
export class IssueList {
  readonly issues: ValidationIssue[] = [];

  error(path: string, message: string): void {
    this.issues.push({ path, message, severity: "error" });
  }

  get hasErrors(): boolean {
    return this.issues.some((i) => i.severity === "error");
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Strict mode: every key must be in the allowed list. */
export function rejectUnknownKeys(
  issues: IssueList,
  path: string,
  obj: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      issues.error(`${path}.${key}`, `未知字段 "${key}"`);
    }
  }
}

/**
 * Require `obj[key]` to be a plain object; report and return null otherwise.
 * `path` already includes the key.
 */
export function requireObject(
  issues: IssueList,
  path: string,
  value: unknown,
): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    issues.error(path, "必须是对象");
    return null;
  }
  return value;
}

/** Fixed-length tuple of finite numbers; returns null (after reporting) if not. */
export function requireNumberTuple(
  issues: IssueList,
  path: string,
  value: unknown,
  length: number,
): number[] | null {
  if (!Array.isArray(value) || value.length !== length) {
    issues.error(path, `必须是长度为 ${length} 的数字数组`);
    return null;
  }
  if (!value.every(isFiniteNumber)) {
    issues.error(path, "每个分量必须是有限数字");
    return null;
  }
  return value as number[];
}

export function requireBoolean(
  issues: IssueList,
  path: string,
  value: unknown,
): boolean {
  if (typeof value !== "boolean") {
    issues.error(path, "必须是布尔值");
    return false;
  }
  return true;
}

/** Finite number within [min, max] (bounds optional, inclusive). */
export function requireNumberInRange(
  issues: IssueList,
  path: string,
  value: unknown,
  opts: { min?: number; max?: number; exclusiveMin?: number },
): value is number {
  if (!isFiniteNumber(value)) {
    issues.error(path, "必须是有限数字");
    return false;
  }
  if (opts.exclusiveMin !== undefined && value <= opts.exclusiveMin) {
    issues.error(path, `必须大于 ${opts.exclusiveMin}`);
    return false;
  }
  if (opts.min !== undefined && value < opts.min) {
    issues.error(path, `不能小于 ${opts.min}`);
    return false;
  }
  if (opts.max !== undefined && value > opts.max) {
    issues.error(path, `不能大于 ${opts.max}`);
    return false;
  }
  return true;
}
