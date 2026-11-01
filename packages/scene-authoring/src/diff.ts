import { hasOwn, isRecord, success } from './common';
import { validate } from './validation';
import type { Change, Result } from './types';

export function changesBetween(before: unknown, after: unknown, path = '$'): Change[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    // Stable IDs keep content diffs useful when a preceding track is inserted or removed.
    if ((path === '$.content.instances' || path === '$.content.groups') && [...before, ...after].every(item => isRecord(item) && typeof item.id === 'string')) {
      const left = new Map(before.map(item => [item.id, item])), right = new Map(after.map(item => [item.id, item]));
      const result: Change[] = [];
      for (const id of new Set([...left.keys(), ...right.keys()])) result.push(...changesBetween(left.get(id), right.get(id), `${path}[id=${JSON.stringify(id)}]`));
      if (JSON.stringify(before.map(item => item.id)) !== JSON.stringify(after.map(item => item.id))) result.push({ path: `${path}.$order`, kind: 'replace', before: before.map(item => item.id), after: after.map(item => item.id) });
      return result;
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [{ path, kind: 'replace', before: structuredClone(before), after: structuredClone(after) }];
  }
  if (isRecord(before) && isRecord(after)) {
    const result: Change[] = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) result.push(...changesBetween(hasOwn(before, key) ? before[key] : undefined, hasOwn(after, key) ? after[key] : undefined, `${path}.${key}`));
    return result;
  }
  return [{ path, kind: before === undefined ? 'add' : after === undefined ? 'remove' : 'replace', ...(before !== undefined ? { before: structuredClone(before) } : {}), ...(after !== undefined ? { after: structuredClone(after) } : {}) }];
}
export function diff(before: unknown, after: unknown): Result<{ changes: Change[] }> {
  const left = validate(before); if (!left.ok) return left;
  const right = validate(after); if (!right.ok) return right;
  return success({ changes: changesBetween(left.document, right.document) });
}
