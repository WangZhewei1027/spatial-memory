import type { SceneDocument } from './protocol';
import type { Diagnostic, Failure, Result, SceneNode, Success } from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const dangerousKey = (key: string) => ['__proto__', 'prototype', 'constructor'].includes(key);
export const hasOwn = (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key);
export class OperationError extends Error {
  constructor(public readonly code: string, public readonly path: string, message: string, public readonly nodeId?: string) { super(message); }
}
export function fail(code: string, path: string, message: string, nodeId?: string): never { throw new OperationError(code, path, message, nodeId); }
export const diagnostic = (code: string, path: string, message: string, nodeId?: string): Diagnostic => ({ code, path, message, severity: 'error', ...(nodeId ? { nodeId } : {}) });
export const failure = (errors: Diagnostic[]): Failure => ({ ok: false, errors, diagnostics: errors });
export const success = <T>(value: T, warnings: Diagnostic[] = []): Success<T> => ({ ok: true, ...value, warnings, diagnostics: warnings });
export function catchResult<T>(work: () => Result<T>): Result<T> {
  try { return work(); } catch (error) {
    return failure([error instanceof OperationError ? diagnostic(error.code, error.path, error.message, error.nodeId) : diagnostic('INVALID_INPUT', '$', error instanceof Error ? error.message : String(error))]);
  }
}
export const nodes = (document: SceneDocument): SceneNode[] => [...(document.content.groups ?? []), ...document.content.instances];
export const isInstance = (node: SceneNode): node is SceneDocument['content']['instances'][number] => 'animation' in node;
export function nodeById(document: SceneDocument, id: unknown): SceneNode {
  if (typeof id !== 'string') fail('INVALID_OPERATION', 'id', 'A node ID is required');
  const node = nodes(document).find(item => item.id === id);
  if (!node) fail('NODE_NOT_FOUND', 'id', `Unknown node: ${id}`, id);
  return node;
}
export function finite(value: unknown, path: string, minimum?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) fail('INVALID_NUMBER', path, minimum === undefined ? 'Expected a finite number' : `Expected a finite number >= ${minimum}`);
  return value;
}
export function positive(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number <= 0) fail('INVALID_NUMBER', path, 'Expected a positive number');
  return number;
}
export function selected(document: SceneDocument, ids: unknown, includeDescendants = false): SceneNode[] {
  if (!Array.isArray(ids) || !ids.length) fail('INVALID_OPERATION', 'ids', 'Provide at least one node ID');
  const all = nodes(document), byId = new Map(all.map(node => [node.id, node]));
  const result = new Set<string>();
  for (const id of ids) { if (typeof id !== 'string' || !byId.has(id)) fail('NODE_NOT_FOUND', 'ids', `Unknown node: ${String(id)}`); if (result.has(id)) fail('DUPLICATE_ID', 'ids', `Repeated node ID: ${id}`, id); result.add(id); }
  if (includeDescendants) {
    const children = new Map<string, SceneNode[]>();
    for (const node of all) if (node.parent) { const values = children.get(node.parent) ?? []; values.push(node); children.set(node.parent, values); }
    const queue = [...result];
    for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) if (!result.has(child.id)) { result.add(child.id); queue.push(child.id); }
  }
  return [...result].map(id => byId.get(id)!);
}
/** Validate JSON values before cloning: no coerced NaN, functions, cycles or class instances. */
export function jsonIssue(value: unknown): Diagnostic | undefined {
  const ancestors = new Set<object>();
  const stack: { value: unknown; path: string; leave?: boolean }[] = [{ value, path: '$' }];
  while (stack.length) {
    const item = stack.pop()!, current = item.value;
    if (item.leave) { ancestors.delete(current as object); continue; }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number' && Number.isFinite(current)) continue;
    if (typeof current !== 'object') return diagnostic('INVALID_JSON', item.path, 'Expected a finite JSON value');
    if (ancestors.has(current)) return diagnostic('CYCLIC_INPUT', item.path, 'JSON data cannot contain cycles');
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return diagnostic('INVALID_JSON', item.path, 'Expected a plain JSON object');
    ancestors.add(current); stack.push({ ...item, leave: true });
    for (const [key, child] of Object.entries(current)) {
      if (dangerousKey(key)) return diagnostic('UNSAFE_KEY', `${item.path}.${key}`, `Reserved object key: ${key}`);
      stack.push({ value: child, path: `${item.path}.${key}` });
    }
  }
  return undefined;
}
