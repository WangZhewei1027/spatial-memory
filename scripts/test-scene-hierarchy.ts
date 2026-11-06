import assert from 'node:assert/strict';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { createSceneCore } from '@spatial-memory/scene-core';
import { compileSceneManifest } from '../lib/scene/compile';
import { editNode, groupNodes, moveNode, normalizeHierarchy, removeNodes, renameNode, trackRows, ungroup } from '../lib/scene/hierarchy-authoring';
import type { CompositionContent, CompositionInstance } from '../lib/scene/protocol';
import { validateSceneDefinition, validateSceneDocument } from '../lib/scene/validate';
import { fromDocument, toDocument } from '../app/manage/lib/scene-document';
import { copyTracks, pasteTracks, PASTE_OFFSET } from '../app/manage/scenes/components/scene-clipboard';

const assetId = '10150000-0000-4000-8000-000000000001';
const model = (id: string, position: [number, number, number] = [0, 0, 0]): CompositionInstance => ({ id, asset: 'model', position, rotation: [0, 0, 0], scale: [1, 1, 1], animation: null });
const scene = (instances: CompositionInstance[], groups?: CompositionContent['groups']): CompositionContent => ({ kind: 'composition', units: 'meters', durationSeconds: 10, loop: false, assets: { model: { assetId } }, instances, ...(groups ? { groups } : {}) });
const ok = <T,>(result: { ok: true; content: T } | { ok: false; reason: string }) => { assert.ok(result.ok, JSON.stringify(result)); return (result as { content: T }).content; };
const order = (content: CompositionContent) => trackRows(content).map(row => `${'  '.repeat(row.depth)}${row.id}`);
const near = (a: number, b: number, message: string) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} != ${b}`);
/** Static world position of an instance through its group chain. */
function worldPosition(content: CompositionContent, id: string) {
  const nodes = [...content.instances, ...(content.groups ?? [])];
  let node = nodes.find(item => item.id === id), matrix = new Matrix4();
  while (node) {
    const local = new Matrix4().compose(new Vector3(...node.position), new Quaternion().setFromEuler(new Euler(...node.rotation, 'XYZ')), new Vector3(...node.scale));
    matrix = local.multiply(matrix); node = nodes.find(item => item.id === node!.parent);
  }
  return new Vector3().setFromMatrixPosition(matrix);
}

// Group, nest, reorder and ungroup like Logic track stacks; the flat list stays the track order.
let content = scene([model('a', [1, 0, 0]), model('b'), model('c'), model('d')]);
content = ok(groupNodes(content, ['c', 'a'], { id: 'g1', name: 'Rig' }));
assert.deepEqual(order(content), ['g1', '  a', '  c', 'b', 'd'], 'members gather at the first selected track');
assert.deepEqual(content.instances.map(item => item.id), ['a', 'c', 'b', 'd']);
content = ok(moveNode(content, 'd', { parent: 'g1', before: 'c' }));
assert.deepEqual(order(content), ['g1', '  a', '  d', '  c', 'b']);
content = ok(groupNodes(content, ['d', 'c'], { id: 'g2', name: 'Inner' }));
assert.deepEqual(order(content), ['g1', '  a', '  g2', '    d', '    c', 'b']);
assert.equal(moveNode(content, 'g1', { parent: 'g2' }).ok, false, 'a group cannot move into its own member');
content = ok(moveNode(content, 'b', { before: 'g1' }));
assert.deepEqual(order(content), ['b', 'g1', '  a', '  g2', '    d', '    c']);

// Reparenting keeps the resting pose in world space.
content = { ...content, groups: content.groups!.map(group => group.id === 'g1' ? { ...group, position: [0, 2, 0], rotation: [0, Math.PI / 2, 0], scale: [2, 2, 2] } : group) };
const before = worldPosition(content, 'a');
const moved = ok(moveNode(content, 'a', {}));
const after = worldPosition(moved, 'a');
near(after.x, before.x, 'x kept'); near(after.y, before.y, 'y kept'); near(after.z, before.z, 'z kept');
const flattened = ungroup(content, 'g1');
assert.deepEqual(order(flattened), ['b', 'a', 'g2', '  d', '  c']);
for (const id of ['a', 'd']) { const w0 = worldPosition(content, id), w1 = worldPosition(flattened, id); near(w1.x, w0.x, `${id} x`); near(w1.y, w0.y, `${id} y`); near(w1.z, w0.z, `${id} z`); }

// Empty groups disappear, removing a group removes its members, renames fall back to the asset.
assert.equal(normalizeHierarchy(scene([model('a')], [{ id: 'empty', name: 'Empty', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }])).groups, undefined);
const removed = removeNodes(content, ['g2']);
assert.deepEqual(order(removed), ['b', 'g1', '  a']);
assert.equal(renameNode(renameNode(content, 'a', ' Lantern '), 'a', '').instances.find(item => item.id === 'a')!.name, undefined);
assert.equal(renameNode(content, 'a', ' Lantern ').instances.find(item => item.id === 'a')!.name, 'Lantern');
assert.equal(renameNode(content, 'g1', '  ').groups!.find(item => item.id === 'g1')!.name, 'Rig', 'groups keep a name');

// Deep hierarchies and large group counts remain editable.
let deep = scene([model('a')]);
for (let i = 0; i < 20; i++) deep = ok(groupNodes(deep, [deep.groups?.at(-1)?.id ?? 'a'], { id: `d${i}`, name: `D${i}` }));
deep = ok(groupNodes(deep, ['d19'], { id: 'd20', name: 'D20' }));
assert.equal(trackRows(deep).length, 22);
assert.equal(validateSceneDocument({ schemaVersion: 6, content: deep }).ok, true);

// Validation, save round trip and compiled schema.
const document = { schemaVersion: 6 as const, content };
assert.equal(validateSceneDocument(document).ok, true, JSON.stringify(validateSceneDocument(document).issues));
assert.deepEqual(toDocument(fromDocument(JSON.parse(JSON.stringify(document)))), document, 'groups and names survive save/reopen');
const cyclic = { schemaVersion: 6, content: { ...content, groups: content.groups!.map(group => group.id === 'g1' ? { ...group, parent: 'g2' } : group) } };
assert.match(JSON.stringify(validateSceneDocument(cyclic).issues), /循环引用/);
assert.equal(validateSceneDocument({ schemaVersion: 6, content: { ...content, instances: content.instances.map(item => ({ ...item, parent: 'missing' })) } }).ok, false);
assert.equal(validateSceneDocument({ schemaVersion: 6, content: { ...content, groups: [...content.groups!, { ...content.groups![0] }] } }).ok, false, 'IDs are unique across groups and instances');
const resources = { model: { assetId, url: 'https://cdn.test/model.glb' } };
const grouped = compileSceneManifest('scene', document, resources);
assert.equal(grouped.schemaVersion, 5);
assert.equal(validateSceneDefinition({ schemaVersion: 5, content: grouped.content }).ok, true);
assert.equal(validateSceneDefinition({ schemaVersion: 4, content: grouped.content }).ok, false, 'flat schema 4 never carries groups');
const flat = compileSceneManifest('scene', { schemaVersion: 6, content: { ...scene([model('a')]), groups: [] } }, resources);
assert.equal(flat.schemaVersion, 4, 'scenes without groups stay playable by released mini-programs');
assert.equal('groups' in flat.content, false);

// Editing a group-free scene must not add `groups: undefined`; paste validates the whole document.
const ungrouped = editNode(scene([model('a')]), 'a', node => ({ ...node, position: [0, 1, 0] }));
assert.equal('groups' in ungrouped, false, 'absent groups stay absent after an edit');
const editedDefinition = fromDocument({ schemaVersion: 6, content: ungrouped });
const clipboard = copyTracks(ungrouped, ['a'], node => node.id)!;
const pasted = pasteTracks(editedDefinition, clipboard, 'copy');
assert.equal(pasted.definition.content.instances.length, 2, 'copy/paste after a viewport edit');
assert.deepEqual(pasted.definition.content.instances[1].position, [PASTE_OFFSET[0], 1, PASTE_OFFSET[2]], 'an in-place paste is offset');
const repeated = pasteTracks(pasted.definition, clipboard, 'copy', 2);
const third = repeated.definition.content.instances.find(item => item.id === repeated.selected[0])!;
assert.deepEqual(third.position, [PASTE_OFFSET[0] * 2, 1, PASTE_OFFSET[2] * 2], 'repeated pastes step further instead of stacking');
// Animated position follows the offset; group members keep their local transform under the copied group.
const key = (time: number, value: number) => ({ time, value, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3] as [number, number, number, number], connectedRight: true });
const rigged = ok(groupNodes(scene([{ ...model('m', [1, 0, 0]), tracks: { 'position.x': [key(0, 1), key(2, 3)] } }, model('n')]), ['m', 'n'], { id: 'rig', name: 'Rig' }));
const animatedPaste = pasteTracks(fromDocument({ schemaVersion: 6, content: rigged }), copyTracks(rigged, ['m'], node => node.id)!, 'copy');
assert.deepEqual(animatedPaste.definition.content.instances.find(item => item.id === animatedPaste.selected[0])!.tracks!['position.x']!.map(frame => frame.value), [1 + PASTE_OFFSET[0], 3 + PASTE_OFFSET[0]]);
const groupPaste = pasteTracks(fromDocument({ schemaVersion: 6, content: rigged }), copyTracks(rigged, ['rig'], node => node.id)!, 'copy').definition.content;
const rigCopy = groupPaste.groups!.find(group => group.id !== 'rig')!;
assert.deepEqual(rigCopy.position, [PASTE_OFFSET[0], 0, PASTE_OFFSET[2]], 'the copied group root moves');
assert.deepEqual(groupPaste.instances.filter(item => item.parent === rigCopy.id).map(item => item.position), rigged.instances.map(item => item.position), 'members stay local to the moved group');

// Scene Core samples group tracks with the same clock as instances.
const animated = { ...content, groups: content.groups!.map(group => group.id === 'g1' ? { ...group, tracks: { 'position.x': [{ time: 0, value: 0, handles: [0, 0, 1, 1] as [number, number, number, number], connectedRight: true }, { time: 2, value: 4, handles: [0, 0, 1, 1] as [number, number, number, number], connectedRight: true }] } } : group) };
const core = createSceneCore({ content: animated });
core.seek(1); near(core.sample('g1')!.position.x, 2, 'group track sampled');
core.sync(scene([model('a')])); assert.equal(core.sample('g1'), undefined, 'sync drops removed groups');
core.dispose();
console.log(JSON.stringify({ result: 'PASS', coverage: 'track order, stack/nest/move/ungroup, world-preserving reparent, empty groups, delete, rename, edit without groups + offset paste, unbounded depth, validation, save round trip, schema 4/5 compile, core group sampling' }));
