import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { sampleOpacity, sampleVolume } from '@spatial-memory/scene-core';
import { AUTOMATION_CHANNELS, TRANSFORM_CHANNELS, type AutomationChannel, type SceneDocument, type TransformKeyframe } from './protocol';
import { dangerousKey, fail, finite, hasOwn, isInstance, isRecord, nodeById, nodes } from './common';
import { decompose, localAt, matrixOf, worldMatrices } from './math';
import type { Diagnostic, Operation, SceneNode, Transform, TransformWrite, Vec3 } from './types';

export function patchObject(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  const pending = [{ target, patch }];
  while (pending.length) {
    const current = pending.pop()!;
    for (const [key, value] of Object.entries(current.patch)) {
      if (dangerousKey(key)) fail('UNSAFE_KEY', key, 'Reserved object key');
      if (isRecord(value) && isRecord(current.target[key])) pending.push({ target: current.target[key], patch: value });
      else current.target[key] = structuredClone(value);
    }
  }
}
/** RFC 6901 paths, relative to the selected node or scene content. Arrays are replaced as fields. */
export function unsetPaths(target: Record<string, unknown>, paths: string[] = []): void {
  for (const path of paths) {
    if (!path.startsWith('/') || /~(?![01])/u.test(path)) fail('INVALID_PATH', 'unset', `Expected a JSON Pointer: ${path}`);
    const keys = path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
    let parent: Record<string, unknown> = target;
    for (const key of keys.slice(0, -1)) {
      if (dangerousKey(key) || !hasOwn(parent, key) || !isRecord(parent[key])) fail('PATH_NOT_FOUND', path, 'The field does not exist or is inside an array');
      parent = parent[key];
    }
    const key = keys.at(-1)!;
    if (dangerousKey(key) || !hasOwn(parent, key)) fail('PATH_NOT_FOUND', path, 'The field does not exist');
    delete parent[key];
  }
}
export function channelFor(node: SceneNode, channel: unknown): AutomationChannel {
  if (typeof channel !== 'string' || !(isInstance(node) ? AUTOMATION_CHANNELS : TRANSFORM_CHANNELS).some(value => value === channel)) fail('INVALID_CHANNEL', 'channel', 'This node does not support the requested channel', node.id);
  return channel as AutomationChannel;
}
export function tracksOf(node: SceneNode): Partial<Record<AutomationChannel, TransformKeyframe[]>> { return node.tracks ?? (node.tracks = {}); }
export function setKey(node: SceneNode, channel: AutomationChannel, key: TransformKeyframe): void {
  const frames = [...(tracksOf(node)[channel] ?? [])], index = frames.findIndex(frame => frame.time === key.time);
  if (index < 0) frames.push(structuredClone(key)); else frames[index] = structuredClone(key);
  frames.sort((a, b) => a.time - b.time);
  tracksOf(node)[channel] = frames;
}
export function staticChannel(node: SceneNode, channel: AutomationChannel, value: number): void {
  if (channel === 'opacity') { if (!isInstance(node)) fail('INVALID_CHANNEL', 'channel', 'Groups have no opacity channel', node.id); node.opacity = value; return; }
  if (channel === 'volume') {
    if (!isInstance(node)) fail('INVALID_CHANNEL', 'channel', 'Groups have no volume channel', node.id);
    node.media = { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, loop: false, muted: false, ...node.media, volume: value }; return;
  }
  const [field, axis] = channel.split('.') as [keyof Transform, string];
  node[field]['xyz'.indexOf(axis)] = value;
}
export function sampleChannel(node: SceneNode, channel: AutomationChannel, time: number): number {
  if (channel === 'opacity') return isInstance(node) ? sampleOpacity(node, time) : 1;
  if (channel === 'volume') return isInstance(node) ? sampleVolume(node, time) : 1;
  const [field, axis] = channel.split('.') as [keyof Transform, string];
  return localAt(node, time)[field]['xyz'.indexOf(axis)];
}
export function writeTransform(node: SceneNode, value: Partial<Transform>, options: TransformWrite, warnings: Diagnostic[]): void {
  const write = options.write ?? 'base';
  if (write === 'key') finite(options.time, 'time', 0);
  for (const [field, values] of Object.entries(value) as [keyof Transform, Vec3][]) {
    if (!['position', 'rotation', 'scale'].includes(field) || !Array.isArray(values) || values.length !== 3) fail('INVALID_TRANSFORM', `value.${field}`, 'Expected a position, rotation or scale triple', node.id);
    values.forEach((component, axis) => finite(component, `value.${field}[${axis}]`));
    if (write === 'base') {
      node[field] = [...values];
      if ('xyz'.split('').some(axis => node.tracks?.[`${field}.${axis}` as keyof typeof node.tracks]?.length)) warnings.push({ code: 'BASE_SHADOWED_BY_TRACK', path: `nodes.${node.id}.${field}`, message: 'The base value was changed; existing keyframes still control the sampled value', nodeId: node.id, severity: 'warning' });
    } else values.forEach((component, index) => {
      const channel = `${field}.${'xyz'[index]}` as AutomationChannel;
      const previous = tracksOf(node)[channel]?.find(key => key.time === options.time);
      setKey(node, channel, { time: options.time!, value: component, handles: previous?.handles ?? [1 / 3, 1 / 3, 2 / 3, 2 / 3], connectedRight: previous?.connectedRight ?? true });
    });
  }
}
export function transform(document: SceneDocument, id: string, value: Partial<Transform>, options: TransformWrite, warnings: Diagnostic[]): void {
  const node = nodeById(document, id);
  if ((options.space ?? 'local') === 'local') { writeTransform(node, value, options, warnings); return; }
  const time = finite(options.time, 'time', 0), matrices = worldMatrices(document, time);
  const original = matrices.get(node.id)!;
  const positionOnly = !!value.position && !value.rotation && !value.scale;
  const affected = positionOnly ? ['position.x', 'position.y', 'position.z'] : TRANSFORM_CHANNELS;
  if ((options.write ?? 'base') === 'base' && affected.some(channel => node.tracks?.[channel as keyof typeof node.tracks]?.length)) fail('ANIMATED_WORLD_EDIT_REQUIRES_KEY', 'write', 'Use write="key" to set a world pose controlled by transform tracks', node.id);
  // A world-position edit is exactly representable even under a sheared parent.
  if (positionOnly) {
    const parent = node.parent ? matrices.get(node.parent)! : new Matrix4();
    if (parent.determinant() === 0) fail('SINGULAR_TRANSFORM', 'space', 'The parent world matrix cannot be inverted', node.id);
    const position = new Vector3(...value.position!).applyMatrix4(parent.clone().invert()).toArray() as Vec3;
    writeTransform(node, { position }, options, warnings); return;
  }
  const world = decompose(original);
  if (!world) fail('NON_TRS_WORLD_TRANSFORM', 'value', 'The sampled world matrix contains shear; use a position-only edit or change the hierarchy', node.id);
  const target = matrixOf({ ...world, ...value });
  if (node.parent) {
    const parent = matrices.get(node.parent)!;
    if (parent.determinant() === 0) fail('SINGULAR_TRANSFORM', 'space', 'The parent world matrix cannot be inverted', node.id);
    target.premultiply(parent.clone().invert());
  }
  const local = decompose(target);
  if (!local) fail('NON_TRS_LOCAL_TRANSFORM', 'value', 'The requested world transform cannot be represented by local position/rotation/scale', node.id);
  writeTransform(node, local, options, warnings);
}
export function lookAt(document: SceneDocument, operation: Extract<Operation, { type: 'transform.lookAt' }>, warnings: Diagnostic[]): void {
  const time = finite(operation.time, 'time', 0), node = nodeById(document, operation.id), matrix = worldMatrices(document, time).get(node.id)!;
  const position = new Vector3().setFromMatrixPosition(matrix), target = new Vector3(...operation.target), up = new Vector3(...(operation.up ?? [0, 1, 0]));
  const direction = target.clone().sub(position);
  if (direction.lengthSq() === 0) fail('DEGENERATE_LOOK_AT', 'target', 'The target must differ from the node world position', node.id);
  if (up.lengthSq() === 0 || new Vector3().crossVectors(direction, up).lengthSq() <= Number.EPSILON * direction.lengthSq() * up.lengthSq()) fail('DEGENERATE_LOOK_AT', 'up', 'The up vector must be nonzero and not parallel to the viewing direction', node.id);
  const forward = operation.forwardAxis ?? '+z', vector = new Vector3().setComponent('xyz'.indexOf(forward[1]), forward[0] === '-' ? -1 : 1);
  const correction = new Quaternion().setFromUnitVectors(vector, new Vector3(0, 0, 1));
  const orientation = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(target, position, up.normalize())).multiply(correction);
  const rotation = new Euler().setFromQuaternion(orientation, 'XYZ');
  transform(document, node.id, { rotation: [rotation.x, rotation.y, rotation.z] }, { space: 'world', time, write: operation.write }, warnings);
}
export function reparent(document: SceneDocument, id: string, parentId: string | null, preserve: 'local' | 'world', options: TransformWrite, warnings: Diagnostic[]): void {
  const node = nodeById(document, id);
  if (parentId !== null) {
    const parent = nodeById(document, parentId);
    if (isInstance(parent)) fail('INVALID_PARENT', 'parentId', 'Only groups can be transform parents', id);
    const visited = new Set<string>();
    for (let at: SceneNode | undefined = parent; at; at = at.parent ? nodeById(document, at.parent) : undefined) {
      if (at.id === id || visited.has(at.id)) fail('HIERARCHY_CYCLE', 'parentId', 'A node cannot be placed inside its descendant or a cyclic hierarchy', id);
      visited.add(at.id);
    }
  }
  let local: Transform | undefined;
  if (preserve === 'world') {
    const time = finite(options.time, 'time', 0), matrices = worldMatrices(document, time);
    const parent = parentId ? matrices.get(parentId)! : new Matrix4();
    if (parent.determinant() === 0) fail('SINGULAR_TRANSFORM', 'parentId', 'The parent world matrix cannot be inverted', id);
    local = decompose(parent.clone().invert().multiply(matrices.get(id)!));
    if (!local) fail('NON_TRS_LOCAL_TRANSFORM', 'parentId', 'Preserving this world pose would introduce local shear', id);
    if ((options.write ?? 'base') === 'base' && Object.keys(node.tracks ?? {}).some(channel => TRANSFORM_CHANNELS.some(value => value === channel))) fail('ANIMATED_REPARENT_REQUIRES_KEY', 'write', 'Use write="key" to preserve an animated pose at the requested time', id);
  }
  if (parentId === null) delete node.parent; else node.parent = parentId;
  if (local) writeTransform(node, local, options, warnings);
}
export function assertUniqueIds(document: SceneDocument, ids: string[]): void {
  const used = new Set(nodes(document).map(node => node.id));
  for (const id of ids) { if (used.has(id)) fail('DUPLICATE_ID', 'id', `Node ID already exists: ${id}`, id); used.add(id); }
}
