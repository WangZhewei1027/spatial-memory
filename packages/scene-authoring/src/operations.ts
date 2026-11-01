import { AUTOMATION_CHANNELS, type CompositionGroup, type CompositionInstance, type SceneDocument } from './protocol';
import { assertUniqueIds, channelFor, lookAt, patchObject, reparent, sampleChannel, setKey, staticChannel, tracksOf, transform, unsetPaths } from './editing';
import { changesBetween } from './diff';
import { dangerousKey, diagnostic, fail, failure, finite, hasOwn, isInstance, isRecord, jsonIssue, nodeById, nodes, OperationError, selected, success } from './common';
import { arrange, layout, sequence, shift, stretch } from './timing';
import { validate } from './validation';
import type { ApplyResult, AuthoringOptions, Diagnostic, Operation } from './types';

const fields: Record<Operation['type'], { required: string[]; optional?: string[] }> = {
  'document.replace': { required: ['document'] }, 'scene.update': { required: ['patch'], optional: ['unset'] },
  'asset.set': { required: ['alias', 'assetId'] }, 'asset.remove': { required: ['alias'] },
  'node.add': { required: ['kind', 'node'], optional: ['beforeId'] }, 'node.update': { required: ['id', 'patch'], optional: ['unset'] },
  'node.remove': { required: ['id'], optional: ['descendants'] }, 'node.duplicate': { required: ['id', 'idMap'] },
  'node.reparent': { required: ['id', 'parentId', 'preserve'], optional: ['time', 'write'] }, 'node.reorder': { required: ['ids'] },
  'transform.set': { required: ['id', 'value'], optional: ['space', 'write', 'time'] },
  'transform.lookAt': { required: ['id', 'target', 'time'], optional: ['up', 'forwardAxis', 'write'] },
  'track.set': { required: ['id', 'channel', 'keys'] }, 'track.remove': { required: ['id', 'channel'], optional: ['retainAt'] },
  'key.set': { required: ['id', 'channel', 'key'] }, 'key.remove': { required: ['id', 'channel', 'time'] }, 'key.move': { required: ['id', 'channel', 'from', 'to'] },
  'time.shift': { required: ['ids', 'seconds'], optional: ['includeDescendants', 'scope'] },
  'time.stretch': { required: ['ids', 'factor'], optional: ['origin', 'includeDescendants', 'scope'] },
  'time.sequence': { required: ['ids'], optional: ['start', 'gap', 'includeDescendants'] },
  layout: { required: ['ids', 'pattern'], optional: ['origin', 'step', 'rowStep', 'columns', 'radius', 'plane', 'startAngle', 'space', 'write', 'time'] },
  'layout.align': { required: ['ids', 'axis'], optional: ['value', 'mode', 'space', 'write', 'time'] },
  'layout.distribute': { required: ['ids', 'axis'], optional: ['start', 'end', 'space', 'write', 'time'] },
};
export const operationTypes: readonly Operation['type'][] = Object.keys(fields) as Operation['type'][];

function operation(value: unknown): Operation {
  if (!isRecord(value) || typeof value.type !== 'string' || !hasOwn(fields, value.type)) fail('UNKNOWN_OPERATION', 'type', 'Unknown or missing operation type');
  const definition = fields[value.type as Operation['type']];
  for (const field of definition.required) if (!hasOwn(value, field)) fail('MISSING_FIELD', field, `Missing operation field: ${field}`);
  for (const field of Object.keys(value)) if (!['type', ...definition.required, ...(definition.optional ?? [])].includes(field)) fail('UNKNOWN_FIELD', field, `Unknown operation field: ${field}`);
  for (const key of ['id', 'alias', 'assetId', 'beforeId']) if (hasOwn(value, key) && (typeof value[key] !== 'string' || !value[key])) fail('INVALID_OPERATION', key, 'Expected a nonempty string');
  for (const key of ['patch', 'node', 'idMap', 'document', 'key']) if (hasOwn(value, key) && !isRecord(value[key])) fail('INVALID_OPERATION', key, 'Expected an object');
  if (value.type === 'transform.set' && !isRecord(value.value)) fail('INVALID_OPERATION', 'value', 'Expected an object');
  for (const key of ['ids', 'unset']) if (hasOwn(value, key) && (!Array.isArray(value[key]) || !value[key].every(item => typeof item === 'string'))) fail('INVALID_OPERATION', key, 'Expected an array of strings');
  for (const key of ['includeDescendants']) if (hasOwn(value, key) && typeof value[key] !== 'boolean') fail('INVALID_OPERATION', key, 'Expected a boolean');
  const enums: Record<string, readonly string[]> = { kind: ['instance', 'group'], descendants: ['reject', 'remove', 'reparent'], preserve: ['local', 'world'], space: ['local', 'world'], write: ['base', 'key'], pattern: ['line', 'grid', 'circle'], plane: ['xy', 'xz', 'yz'], axis: ['x', 'y', 'z'], mode: ['min', 'center', 'max'], forwardAxis: ['+x', '-x', '+y', '-y', '+z', '-z'] };
  for (const [key, values] of Object.entries(enums)) if (hasOwn(value, key) && !values.includes(value[key] as string)) fail('INVALID_OPERATION', key, `Expected one of: ${values.join(', ')}`);
  if (hasOwn(value, 'channel') && !AUTOMATION_CHANNELS.some(channel => channel === value.channel)) fail('INVALID_CHANNEL', 'channel', 'Unknown automation channel');
  if (hasOwn(value, 'parentId') && value.parentId !== null && typeof value.parentId !== 'string') fail('INVALID_OPERATION', 'parentId', 'Expected a group ID or null');
  if (hasOwn(value, 'keys') && !Array.isArray(value.keys)) fail('INVALID_OPERATION', 'keys', 'Expected keyframes');
  if (hasOwn(value, 'scope') && (!Array.isArray(value.scope) || !value.scope.length || !value.scope.every(scope => ['timing', 'animation', 'tracks'].includes(scope)))) fail('INVALID_OPERATION', 'scope', 'Expected timing, animation and/or tracks');
  if (value.type === 'node.duplicate' && !Object.values(value.idMap as Record<string, unknown>).every(id => typeof id === 'string')) fail('INVALID_OPERATION', 'idMap', 'Every replacement ID must be a string');
  for (const key of ['time', 'retainAt', 'from', 'to', 'seconds', 'factor', 'columns', 'radius', 'startAngle', 'start', 'end', 'gap']) if (hasOwn(value, key)) finite(value[key], key);
  if (value.type === 'time.stretch' && hasOwn(value, 'origin')) finite(value.origin, 'origin');
  if (value.type === 'layout.align' && hasOwn(value, 'value')) finite(value.value, 'value');
  const tuples = value.type === 'transform.set' ? Object.entries(value.value as Record<string, unknown>) : value.type === 'layout' ? ['origin', 'step', 'rowStep'].filter(key => hasOwn(value, key)).map(key => [key, value[key]] as const) : value.type === 'transform.lookAt' ? ['target', 'up'].filter(key => hasOwn(value, key)).map(key => [key, value[key]] as const) : [];
  for (const [key, tuple] of tuples) if ((value.type === 'transform.set' && !['position', 'rotation', 'scale'].includes(key)) || !Array.isArray(tuple) || tuple.length !== 3 || !tuple.every(item => typeof item === 'number' && Number.isFinite(item))) fail('INVALID_TRANSFORM', key, 'Expected a finite XYZ triple');
  if (value.type === 'transform.set' && !tuples.length) fail('INVALID_TRANSFORM', 'value', 'Provide at least one transform field');
  // Data is shape-checked here, then domain values are checked by each operation and full document validation.
  return value as Operation;
}
function execute(document: SceneDocument, op: Operation, warnings: Diagnostic[], options: AuthoringOptions): SceneDocument {
  switch (op.type) {
    case 'document.replace': return structuredClone(op.document);
    case 'scene.update': patchObject(document.content as unknown as Record<string, unknown>, op.patch); unsetPaths(document.content as unknown as Record<string, unknown>, op.unset); break;
    case 'asset.set': if (dangerousKey(op.alias)) fail('UNSAFE_KEY', 'alias', 'Reserved resource alias'); document.content.assets[op.alias] = { assetId: op.assetId }; break;
    case 'asset.remove': if (!hasOwn(document.content.assets, op.alias)) fail('ASSET_ALIAS_NOT_FOUND', 'alias', `Unknown asset alias: ${op.alias}`); delete document.content.assets[op.alias]; break;
    case 'node.add': {
      if (typeof op.node.id !== 'string') fail('INVALID_NODE', 'node.id', 'A stable node ID is required');
      assertUniqueIds(document, [op.node.id]);
      const node = structuredClone(op.node);
      if (op.kind === 'group') {
        if ('animation' in node) fail('INVALID_NODE_KIND', 'node.animation', 'Groups cannot have an animation field');
        const groups = document.content.groups ?? (document.content.groups = []);
        const index = op.beforeId === undefined ? groups.length : groups.findIndex(group => group.id === op.beforeId);
        if (index < 0) fail('NODE_NOT_FOUND', 'beforeId', 'The reference group does not exist');
        groups.splice(index, 0, node as CompositionGroup);
      } else {
        if (!('animation' in node)) fail('INVALID_NODE_KIND', 'node.animation', 'Instances require an explicit animation field, including null');
        const index = op.beforeId === undefined ? document.content.instances.length : document.content.instances.findIndex(item => item.id === op.beforeId);
        if (index < 0) fail('NODE_NOT_FOUND', 'beforeId', 'The reference instance does not exist');
        document.content.instances.splice(index, 0, node as CompositionInstance);
      }
      break;
    }
    case 'node.update': {
      if (hasOwn(op.patch, 'id') || op.unset?.includes('/id')) fail('IMMUTABLE_ID', 'id', 'Node IDs are stable; create or duplicate a node instead');
      const node = nodeById(document, op.id), instance = isInstance(node);
      patchObject(node as unknown as Record<string, unknown>, op.patch); unsetPaths(node as unknown as Record<string, unknown>, op.unset);
      if (instance !== isInstance(node)) fail('IMMUTABLE_NODE_KIND', 'patch.animation', 'Use remove/add or replace for a different node kind', op.id);
      break;
    }
    case 'node.remove': {
      const node = nodeById(document, op.id), children = nodes(document).filter(child => child.parent === node.id), mode = op.descendants ?? 'reject';
      if (children.length && mode === 'reject') fail('NODE_HAS_CHILDREN', 'descendants', 'Choose remove or reparent for this node’s children', op.id);
      const ids = new Set(selected(document, [node.id], mode === 'remove').map(item => item.id));
      if (mode === 'reparent') for (const child of children) { if (node.parent) child.parent = node.parent; else delete child.parent; }
      document.content.instances = document.content.instances.filter(item => !ids.has(item.id));
      if (document.content.groups) document.content.groups = document.content.groups.filter(item => !ids.has(item.id));
      break;
    }
    case 'node.duplicate': {
      const originals = selected(document, [op.id], true), ids = originals.map(node => node.id);
      if (Object.keys(op.idMap).length !== ids.length || ids.some(id => !hasOwn(op.idMap, id))) fail('INCOMPLETE_ID_MAP', 'idMap', 'Supply exactly one new stable ID for every duplicated node');
      assertUniqueIds(document, Object.values(op.idMap));
      const copies = new Map(originals.map(node => { const copy = structuredClone(node); copy.id = op.idMap[node.id]; if (copy.parent && hasOwn(op.idMap, copy.parent)) copy.parent = op.idMap[copy.parent]; return [node.id, copy]; }));
      const copyInstances = document.content.instances.filter(node => copies.has(node.id)).map(node => copies.get(node.id) as CompositionInstance);
      const last = document.content.instances.reduce((index, node, current) => copies.has(node.id) ? current : index, -1);
      document.content.instances.splice(last + 1, 0, ...copyInstances);
      const groupCopies = originals.filter(node => !isInstance(node)).map(node => copies.get(node.id) as CompositionGroup);
      if (groupCopies.length) document.content.groups = [...(document.content.groups ?? []), ...groupCopies];
      break;
    }
    case 'node.reparent': reparent(document, op.id, op.parentId, op.preserve, op, warnings); break;
    case 'node.reorder': {
      const ordered = op.ids.length ? selected(document, op.ids) : [];
      if (ordered.length !== document.content.instances.length || ordered.some(node => !isInstance(node))) fail('INCOMPLETE_ORDER', 'ids', 'Supply every instance ID exactly once');
      document.content.instances = ordered as CompositionInstance[]; break;
    }
    case 'transform.set': transform(document, op.id, op.value, op, warnings); break;
    case 'transform.lookAt': lookAt(document, op, warnings); break;
    case 'track.set': { const node = nodeById(document, op.id), channel = channelFor(node, op.channel); tracksOf(node)[channel] = structuredClone(op.keys); break; }
    case 'track.remove': {
      const node = nodeById(document, op.id), channel = channelFor(node, op.channel);
      if (!tracksOf(node)[channel]) fail('TRACK_NOT_FOUND', 'channel', 'The track does not exist', op.id);
      if (op.retainAt !== undefined) staticChannel(node, channel, sampleChannel(node, channel, finite(op.retainAt, 'retainAt', 0)));
      delete tracksOf(node)[channel]; if (!Object.keys(node.tracks ?? {}).length) delete node.tracks; break;
    }
    case 'key.set': { const node = nodeById(document, op.id); finite(op.key.time, 'key.time', 0); setKey(node, channelFor(node, op.channel), op.key); break; }
    case 'key.remove': case 'key.move': {
      const node = nodeById(document, op.id), channel = channelFor(node, op.channel), keys = tracksOf(node)[channel];
      const at = finite(op.type === 'key.remove' ? op.time : op.from, op.type === 'key.remove' ? 'time' : 'from', 0), index = keys?.findIndex(key => key.time === at) ?? -1;
      if (!keys || index < 0) fail('KEY_NOT_FOUND', 'time', 'No key exists at that exact time', op.id);
      if (op.type === 'key.remove') { keys.splice(index, 1); if (!keys.length) delete tracksOf(node)[channel]; if (!Object.keys(node.tracks ?? {}).length) delete node.tracks; }
      else { const to = finite(op.to, 'to', 0); if (to !== at && keys.some(key => key.time === to)) fail('KEY_TIME_COLLISION', 'to', 'Another key already occupies the destination time', op.id); keys[index].time = to; keys.sort((a, b) => a.time - b.time); }
      break;
    }
    case 'time.shift': shift(document, op.ids, op.seconds, op.includeDescendants, op.scope, options); break;
    case 'time.stretch': stretch(document, op, warnings, options); break;
    case 'time.sequence': sequence(document, op, options); break;
    case 'layout': layout(document, op, warnings); break;
    case 'layout.align': case 'layout.distribute': arrange(document, op, warnings); break;
  }
  return document;
}
export function apply(document: unknown, operations: unknown, options: AuthoringOptions = {}): ApplyResult {
  const initial = validate(document, options); if (!initial.ok) return initial;
  if (!Array.isArray(operations)) return failure([diagnostic('INVALID_OPERATIONS', 'operations', 'Expected an array of operations')]);
  let working = structuredClone(initial.document);
  const warnings: Diagnostic[] = [];
  let issueOwners = new Map<string, number>();
  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    try {
      const json = jsonIssue(operations[opIndex]); if (json) return failure([{ ...json, opIndex }]);
      const op = operation(operations[opIndex]);
      working = execute(working, op, warnings, options);
      // Keep the operation that first introduced an unresolved issue. Temporary
      // references may be completed by later operations in the same atomic batch.
      const interim = validate(working, options);
      const current = new Map<string, number>();
      if (!interim.ok) for (const issue of interim.errors) current.set(`${issue.path}:${issue.message}`, issueOwners.get(`${issue.path}:${issue.message}`) ?? opIndex);
      issueOwners = current;
    } catch (error) {
      const issue = error instanceof OperationError ? diagnostic(error.code, error.path, error.message, error.nodeId) : diagnostic('INVALID_OPERATION', '$', error instanceof Error ? error.message : String(error));
      return failure([{ ...issue, opIndex }]);
    }
  }
  const checked = validate(working, options);
  if (!checked.ok) return failure(checked.errors.map(issue => ({ ...issue, ...(operations.length ? { opIndex: issueOwners.get(`${issue.path}:${issue.message}`) ?? operations.length - 1 } : {}) })));
  const changes = changesBetween(initial.document, checked.document);
  if (!changes.length && operations.length) warnings.push({ code: 'NO_CHANGE', path: '$', message: 'The batch completed without changing the document', severity: 'warning' });
  return success({ document: checked.document, changes, applied: operations.length, unchanged: changes.length === 0 }, [...checked.warnings, ...warnings]);
}
