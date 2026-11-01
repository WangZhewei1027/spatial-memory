import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { type CompositionContent, type CompositionGroup, type CompositionInstance, type TransformNode } from './protocol';

type Content = Pick<CompositionContent, 'instances' | 'groups' | 'assets'>;
export type SceneNode = CompositionInstance | CompositionGroup;
export interface TrackRow { id: string; kind: 'group' | 'instance'; depth: number; node: SceneNode; children: number }
export const isGroup = (node: SceneNode): node is CompositionGroup => !('animation' in node);
export const findNode = (content: Content, id: string): SceneNode | undefined => content.instances.find(item => item.id === id) ?? content.groups?.find(item => item.id === id);

/**
 * Timeline order, Logic track-stack style: a group header sits right above its members.
 * Sibling order follows each subtree's first instance in `instances`, so the flat
 * instance list stays the single source of track order.
 */
export function trackRows(content: Content): TrackRow[] {
  const groups = content.groups ?? [];
  const children = new Map<string | undefined, SceneNode[]>();
  const add = (node: SceneNode) => { const list = children.get(node.parent) ?? []; list.push(node); children.set(node.parent, list); };
  groups.forEach(add); content.instances.forEach(add);
  const first = new Map<string, number>();
  const nodes = new Map([...groups, ...content.instances].map(node => [node.id, node]));
  content.instances.forEach((instance, index) => {
    const visited = new Set<string>();
    for (let node: SceneNode | undefined = instance; node && !visited.has(node.id); node = node.parent ? nodes.get(node.parent) : undefined) {
      visited.add(node.id);
      first.set(node.id, Math.min(index, first.get(node.id) ?? Infinity));
    }
  });
  const ordered = (parent: string | undefined) => [...(children.get(parent) ?? [])].sort((a, b) => (first.get(a.id) ?? Infinity) - (first.get(b.id) ?? Infinity));
  const rows: TrackRow[] = [], visited = new Set<string>();
  const pending = ordered(undefined).reverse().map(node => ({ node, depth: 0 }));
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    rows.push({ id: node.id, kind: isGroup(node) ? 'group' : 'instance', depth, node, children: children.get(node.id)?.length ?? 0 });
    if (isGroup(node)) for (const child of ordered(node.id).reverse()) pending.push({ node: child, depth: depth + 1 });
  }
  return rows;
}

/** Reorder instances to track order and drop groups left without instances. */
export function normalizeHierarchy<T extends Content>(content: T): T {
  const rows = trackRows(content);
  const used = new Set<string>();
  for (const row of rows) if (row.kind === 'instance') for (let at = row.node.parent; at && !used.has(at); at = findNode(content, at)?.parent) used.add(at);
  const groups = (content.groups ?? []).filter(group => used.has(group.id));
  const instances = rows.flatMap(row => row.kind === 'instance' ? [row.node as CompositionInstance] : []);
  const { groups: _groups, ...rest } = content;
  return { ...rest, instances, ...(groups.length ? { groups } : {}) } as T;
}

export const descendants = (content: Content, id: string): Set<string> => {
  const found = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const node of [...content.instances, ...(content.groups ?? [])]) if (!found.has(node.id) && node.parent && (node.parent === id || found.has(node.parent))) { found.add(node.id); grew = true; }
  }
  return found;
};
// Static transforms only: reparenting keeps the resting pose in place; keyed channels stay local.
const matrixOf = (node: TransformNode) => new Matrix4().compose(new Vector3(...node.position), new Quaternion().setFromEuler(new Euler(...node.rotation, 'XYZ')), new Vector3(...node.scale));
function worldOf(content: Content, parent: string | undefined) {
  const matrix = new Matrix4();
  const visited = new Set<string>();
  for (let at = parent; at && !visited.has(at);) { visited.add(at); const group = findNode(content, at); if (!group) break; matrix.premultiply(matrixOf(group)); at = group.parent; }
  return matrix;
}
// `|| 0` drops the -0 that decomposition produces; JSON would turn it into 0 on save.
const round = (value: number) => Number(value.toPrecision(15)) || 0;
function reparented<T extends SceneNode>(content: Content, node: T, parent: string | undefined): T {
  if (node.parent === parent) return node;
  const local = worldOf(content, parent).invert().multiply(worldOf(content, node.parent)).multiply(matrixOf(node));
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
  local.decompose(position, quaternion, scale);
  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ');
  const { parent: _parent, ...rest } = node;
  return {
    ...rest, ...(parent ? { parent } : {}),
    position: [round(position.x), round(position.y), round(position.z)],
    rotation: [round(rotation.x), round(rotation.y), round(rotation.z)],
    scale: [round(scale.x), round(scale.y), round(scale.z)],
  } as T;
}
function withParents<T extends Content>(content: T, parents: Map<string, string | undefined>, extra: CompositionGroup[] = []): T {
  const source = { ...content, groups: [...(content.groups ?? []), ...extra] };
  const move = <N extends SceneNode>(node: N) => parents.has(node.id) ? reparented(source, node, parents.get(node.id)) : node;
  return { ...content, instances: content.instances.map(move), groups: source.groups.map(move) };
}

export type HierarchyFailure = 'cycle';
type Result<T> = { ok: true; content: T } | { ok: false; reason: HierarchyFailure };

/** Wrap the selected tracks in a new identity group placed where the first of them is. */
export function groupNodes<T extends Content>(content: T, ids: string[], group: { id: string; name: string }): Result<T> {
  const order = trackRows(content).map(row => row.id);
  const picked = ids.filter(id => findNode(content, id)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const top = picked.filter(id => !picked.some(other => other !== id && descendants(content, other).has(id)));
  if (!top.length) return { ok: true, content };
  const parent = findNode(content, top[0])!.parent;
  const created: CompositionGroup = { id: group.id, name: group.name, ...(parent ? { parent } : {}), position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const next = withParents(content, new Map(top.map(id => [id, group.id])), [created]);
  // Pull the new members together at the first member's position.
  const members = new Set(top.flatMap(id => [id, ...descendants(next, id)]));
  const at = next.instances.findIndex(item => members.has(item.id));
  const moved = next.instances.filter(item => members.has(item.id));
  const rest = next.instances.filter(item => !members.has(item.id));
  const before = next.instances.slice(0, at).filter(item => !members.has(item.id)).length;
  return { ok: true, content: normalizeHierarchy({ ...next, instances: [...rest.slice(0, before), ...moved, ...rest.slice(before)] }) };
}

/** Move a group's members up one level, keeping their resting pose, and remove the group. */
export function ungroup<T extends Content>(content: T, id: string): T {
  const group = content.groups?.find(item => item.id === id);
  if (!group) return content;
  const members = [...content.instances, ...(content.groups ?? [])].filter(node => node.parent === id);
  const next = withParents(content, new Map(members.map(node => [node.id, group.parent])));
  return normalizeHierarchy({ ...next, groups: next.groups!.filter(item => item.id !== id) });
}

/** Move a track (with its members) into `parent`, before track `before` or at the end of that level. */
export function moveNode<T extends Content>(content: T, id: string, target: { parent?: string; before?: string }): Result<T> {
  const node = findNode(content, id);
  if (!node || target.before === id) return { ok: true, content };
  const inside = descendants(content, id);
  if (target.parent === id || (target.parent && inside.has(target.parent))) return { ok: false, reason: 'cycle' };
  const next = withParents(content, new Map([[id, target.parent]]));
  const members = new Set([id, ...inside]);
  const moved = next.instances.filter(item => members.has(item.id));
  const rest = next.instances.filter(item => !members.has(item.id));
  let at: number;
  if (target.before) {
    const block = new Set([target.before, ...descendants(next, target.before)]);
    at = rest.findIndex(item => block.has(item.id));
  } else {
    const level = target.parent ? descendants(next, target.parent) : null;
    at = level ? rest.findLastIndex(item => level.has(item.id)) + 1 : rest.length;
  }
  if (at < 0) at = rest.length;
  return { ok: true, content: normalizeHierarchy({ ...next, instances: [...rest.slice(0, at), ...moved, ...rest.slice(at)] }) };
}

/** Delete tracks; a group takes its members with it. Unreferenced asset aliases are dropped. */
export function removeNodes<T extends Content>(content: T, ids: string[]): T {
  const gone = new Set(ids.flatMap(id => [id, ...descendants(content, id)]));
  const instances = content.instances.filter(item => !gone.has(item.id));
  const assets = Object.fromEntries(Object.entries(content.assets).filter(([alias]) => instances.some(item => item.asset === alias)));
  return normalizeHierarchy({ ...content, instances, assets, groups: content.groups?.filter(item => !gone.has(item.id)) });
}

export function editNode<T extends Content>(content: T, id: string, edit: <N extends SceneNode>(node: N) => N): T {
  return { ...content, instances: content.instances.map(item => item.id === id ? edit(item) : item), groups: content.groups?.map(item => item.id === id ? edit(item) : item) };
}

/** An empty instance name falls back to its asset name; groups always keep a name. */
export function renameNode<T extends Content>(content: T, id: string, name: string): T {
  const trimmed = name.trim();
  return editNode(content, id, node => {
    if (trimmed) return { ...node, name: trimmed };
    if (isGroup(node)) return node;
    const { name: _name, ...rest } = node as CompositionInstance;
    return rest as typeof node;
  });
}
