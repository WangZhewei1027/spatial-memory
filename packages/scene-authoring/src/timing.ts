import type { SceneDocument } from './protocol';
import { fail, finite, isInstance, nodes, positive, selected } from './common';
import { localAt, worldMatrices } from './math';
import { regionOf } from './sampling';
import { transform } from './editing';
import type { AuthoringOptions, Diagnostic, Operation, SceneNode, TimeScope, TransformWrite, Vec3 } from './types';

const ALL_SCOPE: TimeScope = ['timing', 'animation', 'tracks'];
function retimeNode(document: SceneDocument, node: SceneNode, change: (time: number) => number, factor: number, scope: TimeScope, options: AuthoringOptions): void {
  if (scope.includes('tracks')) for (const keys of Object.values(node.tracks ?? {})) for (const key of keys) key.time = change(key.time);
  if (!isInstance(node)) return;
  if (scope.includes('timing')) {
    const range = regionOf(document, node, options);
    const timing = node.timing ?? { startSeconds: range.start, endSeconds: range.end, fadeInSeconds: 0, fadeOutSeconds: 0 };
    node.timing = { startSeconds: change(timing.startSeconds), endSeconds: timing.endSeconds === null ? null : change(timing.endSeconds), fadeInSeconds: timing.fadeInSeconds * factor, fadeOutSeconds: timing.fadeOutSeconds * factor };
  }
  if (scope.includes('animation') && node.animation) node.animation.startSeconds = change(node.animation.startSeconds);
}
export function shift(document: SceneDocument, ids: string[], seconds: number, includeDescendants = true, scope: TimeScope = ALL_SCOPE, options: AuthoringOptions = {}): void {
  finite(seconds, 'seconds');
  for (const node of selected(document, ids, includeDescendants)) retimeNode(document, node, time => time + seconds, 1, scope, options);
}
export function stretch(document: SceneDocument, operation: Extract<Operation, { type: 'time.stretch' }>, warnings: Diagnostic[], options: AuthoringOptions): void {
  const factor = positive(operation.factor, 'factor'), origin = finite(operation.origin ?? 0, 'origin', 0), scope = operation.scope ?? ALL_SCOPE;
  for (const node of selected(document, operation.ids, operation.includeDescendants ?? true)) {
    retimeNode(document, node, time => origin + (time - origin) * factor, factor, scope, options);
    if (!isInstance(node)) continue;
    if (factor !== 1 && node.animation && scope.includes('animation')) warnings.push({ code: 'GLB_SPEED_UNCHANGED', path: `nodes.${node.id}.animation`, message: 'Scheduling was stretched; the document has no GLB clip-speed parameter, so the internal clip speed is unchanged', nodeId: node.id, severity: 'warning' });
  }
}
export function sequence(document: SceneDocument, operation: Extract<Operation, { type: 'time.sequence' }>, options: AuthoringOptions): void {
  let cursor = finite(operation.start ?? 0, 'start', 0);
  const gap = finite(operation.gap ?? 0, 'gap'), roots = selected(document, operation.ids), include = operation.includeDescendants ?? true;
  const seen = new Set<string>();
  const regions = roots.map(root => {
    if (!isInstance(root) && !include) fail('INVALID_SEQUENCE', 'includeDescendants', 'Sequencing a group requires its descendants', root.id);
    for (const node of selected(document, [root.id], include)) {
      if (seen.has(node.id)) fail('OVERLAPPING_SELECTION', 'ids', 'Sequence items cannot contain one another', node.id);
      seen.add(node.id);
    }
    const range = regionOf(document, root, options);
    if (range.end === null || range.end <= range.start) fail('UNBOUNDED_REGION', 'ids', 'Give each sequence item a finite positive timing interval', root.id);
    return { id: root.id, start: range.start, duration: range.end - range.start };
  });
  for (const region of regions) {
    shift(document, [region.id], cursor - region.start, include, ALL_SCOPE, options);
    cursor += region.duration + gap;
  }
}
export function layout(document: SceneDocument, operation: Extract<Operation, { type: 'layout' }>, warnings: Diagnostic[]): void {
  const list = selected(document, operation.ids), origin = operation.origin ?? [0, 0, 0], step = operation.step ?? [1, 0, 0], rowStep = operation.rowStep ?? [0, 0, 1];
  const columns = operation.columns ?? Math.max(1, Math.ceil(Math.sqrt(list.length))), radius = operation.radius ?? 1, angle = operation.startAngle ?? 0;
  if (!Number.isInteger(columns) || columns <= 0) fail('INVALID_NUMBER', 'columns', 'Grid columns must be a positive integer');
  positive(radius, 'radius'); finite(angle, 'startAngle');
  const positions = new Map(list.map((node, index) => {
    let position: Vec3;
    if (operation.pattern === 'circle') {
      const axes = operation.plane === 'xy' ? [0, 1] : operation.plane === 'yz' ? [1, 2] : [0, 2];
      const at = angle + index * Math.PI * 2 / list.length;
      position = [...origin]; position[axes[0]] += Math.cos(at) * radius; position[axes[1]] += Math.sin(at) * radius;
    } else {
      const column = operation.pattern === 'grid' ? index % columns : index, row = operation.pattern === 'grid' ? Math.floor(index / columns) : 0;
      position = origin.map((value, axis) => value + column * step[axis] + row * rowStep[axis]) as Vec3;
    }
    return [node.id, position];
  }));
  // Parent edits must precede children so every final world-space target remains exact.
  placePositions(document, list, positions, operation, warnings);
}
function placePositions(document: SceneDocument, list: SceneNode[], positions: Map<string, Vec3>, options: TransformWrite, warnings: Diagnostic[]): void {
  const all = new Map(nodes(document).map(node => [node.id, node]));
  const depth = (id: string) => { let value = 0; const visited = new Set<string>(); for (let at = all.get(id)?.parent; at; at = all.get(at)?.parent) { if (visited.has(at)) fail('HIERARCHY_CYCLE', 'ids', 'The hierarchy contains a cycle', id); visited.add(at); value++; } return value; };
  const order = options.space === 'world' ? [...list].sort((a, b) => depth(a.id) - depth(b.id)) : list;
  for (const node of order) transform(document, node.id, { position: positions.get(node.id)! }, options, warnings);
}
export function arrange(document: SceneDocument, operation: Extract<Operation, { type: 'layout.align' | 'layout.distribute' }>, warnings: Diagnostic[]): void {
  const list = selected(document, operation.ids), time = operation.time === undefined ? 0 : finite(operation.time, 'time', 0), axis = 'xyz'.indexOf(operation.axis);
  if (operation.space === 'world' || operation.write === 'key') finite(operation.time, 'time', 0);
  const matrices = operation.space === 'world' ? worldMatrices(document, time) : undefined;
  const positions = new Map(list.map(node => [node.id, matrices ? [matrices.get(node.id)!.elements[12], matrices.get(node.id)!.elements[13], matrices.get(node.id)!.elements[14]] as Vec3 : operation.write === 'key' ? localAt(node, time).position : [...node.position] as Vec3]));
  const values = [...positions.values()].map(position => position[axis]);
  const minimum = values.reduce((result, value) => Math.min(result, value), Infinity), maximum = values.reduce((result, value) => Math.max(result, value), -Infinity);
  if (operation.type === 'layout.align') {
    const at = operation.value ?? (operation.mode === 'min' ? minimum : operation.mode === 'max' ? maximum : minimum + (maximum - minimum) / 2);
    finite(at, 'value'); for (const position of positions.values()) position[axis] = at;
  } else {
    if (list.length < 2) fail('INSUFFICIENT_NODES', 'ids', 'Distribution requires at least two node origins');
    const start = finite(operation.start ?? minimum, 'start'), end = finite(operation.end ?? maximum, 'end');
    list.forEach((node, index) => { positions.get(node.id)![axis] = start + (end - start) * index / (list.length - 1); });
  }
  placePositions(document, list, positions, operation, warnings);
}
