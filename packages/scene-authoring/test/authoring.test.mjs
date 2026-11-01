import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, createDocument, diff, inspect, sample, validate } from '../dist/index.js';

const ASSET = '11111111-1111-4111-8111-111111111111';
const frame = (time, value, extra = {}) => ({ time, value, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3], connectedRight: true, ...extra });
const node = (id, extra = {}) => ({ id, asset: 'asset', animation: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...extra });
const group = (id, extra = {}) => ({ id, name: id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...extra });
function document(instances = [node('a')], groups = []) { const value = createDocument(); value.content.assets.asset = { assetId: ASSET }; value.content.instances = instances; if (groups.length) value.content.groups = groups; return value; }
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result; }
const near = (actual, expected) => { assert.equal(actual.length, expected.length); actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-7, `${actual} != ${expected}`)); };

test('atomic batch rolls back input and reports the actual failed operation', () => {
  const original = document(), snapshot = structuredClone(original);
  const result = apply(original, [{ type: 'node.update', id: 'a', patch: { name: 'Changed' } }, { type: 'node.update', id: 'missing', patch: { name: 'No' } }]);
  assert.equal(result.ok, false); assert.equal(result.errors[0].opIndex, 1); assert.equal(result.errors[0].code, 'NODE_NOT_FOUND');
  assert.deepEqual(original, snapshot); assert.equal('document' in result, false);
  const invalid = apply(original, [{ type: 'node.update', id: 'a', patch: { scale: [0, 1, 1] } }, { type: 'scene.update', patch: { loop: true } }]);
  assert.equal(invalid.ok, false); assert.equal(invalid.errors[0].opIndex, 0); assert.match(invalid.errors[0].path, /scale/);
});

test('full schema fields survive patch, explicit unset and replacement without shallow-merge loss', () => {
  const media = { trimStartSeconds: 2, trimEndSeconds: 20, playbackRate: 1, volume: .8, loop: true, muted: false, spatial: { enabled: true, refDistance: 1, maxDistance: 30, rolloffFactor: 1 } };
  const input = document([node('a', { media, timing: { startSeconds: 1, endSeconds: 8, fadeInSeconds: .2, fadeOutSeconds: .4 }, opacity: .7 })]);
  const result = ok(apply(input, [{ type: 'node.update', id: 'a', patch: { media: { spatial: { rolloffFactor: 2 }, muted: true }, hidden: true } }]));
  assert.equal(result.unchanged, false); assert.ok(result.changes.some(change => change.path.endsWith('rolloffFactor')));
  assert.equal(result.document.content.instances[0].media.trimStartSeconds, 2);
  assert.equal(result.document.content.instances[0].media.spatial.maxDistance, 30);
  const unset = ok(apply(result.document, [{ type: 'node.update', id: 'a', patch: {}, unset: ['/media/spatial'] }]));
  assert.equal(unset.document.content.instances[0].media.spatial, undefined);
  assert.deepEqual(ok(apply(createDocument(), [{ type: 'document.replace', document: unset.document }])).document, unset.document);
});

test('large scenes and transforms are not bounded by old authoring caps', () => {
  const input = document(Array.from({ length: 30 }, (_, index) => node(`n${index}`, { position: [10000, -2000, 300], scale: [200, .00001, 1] })), Array.from({ length: 20 }, (_, index) => group(`g${index}`, index ? { parent: `g${index - 1}` } : {})));
  input.content.durationSeconds = 7200;
  input.content.instances[0].tracks = { 'position.x': Array.from({ length: 2500 }, (_, i) => frame(i, i * 100)) };
  for (let i = 0; i < 12; i++) input.content.assets[`asset${i}`] = { assetId: ASSET };
  assert.equal(validate(input).ok, true);
  const output = ok(inspect(input)).inspection;
  assert.equal(output.counts.instances, 30); assert.equal(output.counts.groups, 20); assert.equal(output.counts.keyframes, 2500);
});

test('world transforms sample animated parents and write exact local keys', () => {
  const input = document([node('a', { parent: 'rig', position: [1, 0, 0] })], [group('rig', { tracks: { 'position.x': [frame(0, 0), frame(10, 10)], 'rotation.y': [frame(0, 0), frame(10, Math.PI)] } })]);
  const result = ok(apply(input, [{ type: 'transform.set', id: 'a', space: 'world', write: 'key', time: 5, value: { position: [7, 2, 3] } }]));
  near(ok(sample(result.document, 5)).sample.nodes.a.world.position, [7, 2, 3]);
  near(result.document.content.instances[0].position, [1, 0, 0]);
  assert.equal(result.document.content.instances[0].tracks['position.x'][0].time, 5);
});

test('world reparent preserves a sampled pose and rejects impossible local shear', () => {
  const input = document([node('a', { parent: 'left', position: [2, 1, 0] })], [group('left', { position: [3, 0, 0] }), group('right', { position: [-4, 0, 0] })]);
  const output = ok(apply(input, [{ type: 'node.reparent', id: 'a', parentId: 'right', preserve: 'world', time: 0 }])).document;
  near(ok(sample(output, 0)).sample.nodes.a.world.position, [5, 1, 0]);
  const shear = document([node('a', { rotation: [0, 0, Math.PI / 4] })], [group('uneven', { scale: [2, 1, 1] })]);
  const result = apply(shear, [{ type: 'node.reparent', id: 'a', parentId: 'uneven', preserve: 'world', time: 0 }]);
  assert.equal(result.ok, false); assert.equal(result.errors[0].code, 'NON_TRS_LOCAL_TRANSFORM');
});

test('key operations preserve custom curves and report collisions or missing keys', () => {
  const input = document([node('a', { tracks: { 'position.x': [frame(0, 0, { handles: [.1, -2, .7, 3] }), frame(5, 3)] } })]);
  const moved = ok(apply(input, [{ type: 'key.move', id: 'a', channel: 'position.x', from: 0, to: 2 }])).document;
  assert.deepEqual(moved.content.instances[0].tracks['position.x'][0].handles, [.1, -2, .7, 3]);
  const collision = apply(input, [{ type: 'key.move', id: 'a', channel: 'position.x', from: 0, to: 5 }]);
  assert.equal(collision.ok, false); assert.equal(collision.errors[0].code, 'KEY_TIME_COLLISION');
  const missing = apply(input, [{ type: 'key.remove', id: 'a', channel: 'position.x', time: 3 }]); assert.equal(missing.ok, false);
  const removed = ok(apply(input, [{ type: 'track.remove', id: 'a', channel: 'position.x', retainAt: 5 }])).document;
  assert.equal(removed.content.instances[0].position[0], 3); assert.equal(removed.content.instances[0].tracks, undefined);
});

test('time shift/stretch/sequence retime scheduling and keyframes without changing media speed', () => {
  const timing = { startSeconds: 1, endSeconds: 3, fadeInSeconds: .2, fadeOutSeconds: .4 };
  const input = document([node('a', { timing, tracks: { 'position.x': [frame(1, 0), frame(3, 5)] }, media: { trimStartSeconds: 0, trimEndSeconds: 2, playbackRate: 1, volume: 1, loop: false, muted: false } }), node('b', { timing: { ...timing, startSeconds: 4, endSeconds: 6 } })]);
  const stretched = ok(apply(input, [{ type: 'time.stretch', ids: ['a'], factor: 2, origin: 1 }])).document;
  assert.equal(stretched.content.instances[0].timing.endSeconds, 5); assert.equal(stretched.content.instances[0].timing.fadeOutSeconds, .8);
  assert.equal(stretched.content.instances[0].media.playbackRate, 1); assert.equal(stretched.content.instances[0].tracks['position.x'][1].time, 5);
  const sequenced = ok(apply(stretched, [{ type: 'time.sequence', ids: ['a', 'b'], start: 0, gap: 1 }])).document;
  assert.equal(sequenced.content.instances[0].timing.startSeconds, 0); assert.equal(sequenced.content.instances[1].timing.startSeconds, 5);
  assert.equal(sequenced.content.instances[0].tracks['position.x'][1].time, 4);
  const negative = apply(input, [{ type: 'time.shift', ids: ['a'], seconds: -2 }]); assert.equal(negative.ok, false);
  const obsolete = apply(input, [{ type: 'time.stretch', ids: ['a'], factor: 2, retimeMedia: true }]);
  assert.equal(obsolete.ok, false); assert.match(obsolete.errors[0].path, /retimeMedia/);
});

test('media speed is fixed at 1 for validation and editing', () => {
  const input = document([node('a', { media: { trimStartSeconds: 2, trimEndSeconds: 8, playbackRate: 1, volume: .8, loop: false, muted: false } })]);
  assert.equal(validate(input).ok, true);
  for (const playbackRate of [.1, .5, 2, 8, 0, null]) {
    const invalid = structuredClone(input); invalid.content.instances[0].media.playbackRate = playbackRate;
    const result = validate(invalid); assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.path.endsWith('playbackRate')));
    assert.equal(apply(input, [{ type: 'node.update', id: 'a', patch: { media: { playbackRate } } }]).ok, false);
  }
});

test('deterministic layout and duplication need explicit stable identities', () => {
  const input = document([node('a'), node('b'), node('c')]);
  const output = ok(apply(input, [{ type: 'layout', ids: ['a', 'b', 'c'], pattern: 'grid', columns: 2, origin: [10, 0, 20], step: [3, 0, 0], rowStep: [0, 0, 4] }])).document;
  assert.deepEqual(output.content.instances.map(item => item.position), [[10, 0, 20], [13, 0, 20], [10, 0, 24]]);
  const copied = ok(apply(output, [{ type: 'node.duplicate', id: 'a', idMap: { a: 'copy' } }])).document;
  assert.deepEqual(copied.content.instances.map(item => item.id), ['a', 'copy', 'b', 'c']);
  assert.equal(apply(copied, [{ type: 'node.duplicate', id: 'a', idMap: { a: 'copy' } }]).ok, false);
  assert.ok(ok(diff(input, copied)).changes.some(change => change.path.includes('id="copy"')));
});

test('hidden video remains audible and actual media time follows trimming at natural speed', () => {
  const input = document([node('a', { hidden: true, media: { trimStartSeconds: 2, trimEndSeconds: 8, playbackRate: 1, volume: .8, loop: false, muted: false }, timing: { startSeconds: 1, endSeconds: 9, fadeInSeconds: 0, fadeOutSeconds: 0 }, opacity: 0 })]);
  const output = ok(sample(input, { time: 3, resources: { [ASSET]: { assetId: ASSET, kind: 'video', durationSeconds: 10 } } })).sample.nodes.a;
  assert.equal(output.visible, false); assert.equal(output.opacity, 0); assert.equal(output.volume, .8); assert.equal(output.mediaTime, 4);
});

test('batch can resolve temporary references, rejects prototype keys and deep cycles', () => {
  const input = createDocument();
  const output = ok(apply(input, [{ type: 'node.add', kind: 'instance', node: node('a') }, { type: 'asset.set', alias: 'asset', assetId: ASSET }]));
  assert.equal(output.document.content.instances.length, 1);
  const unsafe = apply(document(), JSON.parse('[{"type":"node.update","id":"a","patch":{"__proto__":{"polluted":true}}}]'));
  assert.equal(unsafe.ok, false); assert.equal(unsafe.errors[0].code, 'UNSAFE_KEY'); assert.equal({}.polluted, undefined);
  const cyclic = document([node('a')], [group('one', { parent: 'two' }), group('two', { parent: 'one' }), group('outside', { parent: 'one' })]);
  assert.equal(validate(cyclic).ok, false);
  const wrong = apply(document(), [{ type: 'unknown' }]); assert.equal(wrong.ok, false); assert.equal(wrong.errors[0].code, 'UNKNOWN_OPERATION');
});

test('resource facts detect invalid media and ambiguous clips without claiming authorization', () => {
  const input = document([node('a', { animation: { clipName: 'walk', startSeconds: 0, loop: false } })]);
  const result = validate(input, { resources: { [ASSET]: { assetId: ASSET, kind: 'model', animations: [{ index: 0, name: 'walk' }, { index: 1, name: 'walk' }] } }, requireResources: true });
  assert.equal(result.ok, false); assert.equal(result.errors[0].code, 'AMBIGUOUS_CLIP');
  assert.equal(validate(input, { requireResources: true }).ok, false);
  assert.equal(validate(document([node('a', { text: { content: 'Wrong', color: '#000000', fontSize: 1, width: 1, align: 'left' } })])).ok, false);
});

test('origin alignment and distribution preserve other axes and handle animated parents', () => {
  const input = document([node('a', { parent: 'rig', position: [0, 1, 2] }), node('b', { position: [8, 3, 4] }), node('c', { position: [2, 5, 6] })], [group('rig', { tracks: { 'position.x': [frame(0, 0), frame(10, 10)] } })]);
  const output = ok(apply(input, [
    { type: 'layout.align', ids: ['a', 'b', 'c'], axis: 'y', value: 7, space: 'world', time: 5, write: 'key' },
    { type: 'layout.distribute', ids: ['a', 'b', 'c'], axis: 'x', start: -4, end: 12, space: 'world', time: 5, write: 'key' },
  ])).document;
  const snapshot = ok(sample(output, 5)).sample.nodes;
  near(snapshot.a.world.position, [-4, 7, 2]); near(snapshot.b.world.position, [4, 7, 4]); near(snapshot.c.world.position, [12, 7, 6]);
  assert.equal(apply(input, [{ type: 'layout.distribute', ids: ['a'], axis: 'x' }]).ok, false);
  assert.equal(apply(input, [{ type: 'layout.align', ids: ['a'], axis: 'unknown' }]).ok, false);
});

test('world layout handles a child selected before its moving parent', () => {
  const input = document([node('a', { parent: 'rig', position: [2, 0, 0] })], [group('rig')]);
  const output = ok(apply(input, [{ type: 'layout', ids: ['a', 'rig'], pattern: 'line', origin: [10, 0, 0], step: [10, 0, 0], space: 'world', time: 0 }])).document;
  const snapshot = ok(sample(output, 0)).sample.nodes;
  near(snapshot.a.world.position, [10, 0, 0]); near(snapshot.rig.world.position, [20, 0, 0]);
});

test('lookAt honors the declared model forward axis and rejects degenerate inputs', () => {
  const input = document([node('a', { parent: 'rig' })], [group('rig', { rotation: [0, .4, 0] })]);
  for (const forwardAxis of ['+z', '-z', '+x', '-y']) {
    const output = ok(apply(input, [{ type: 'transform.lookAt', id: 'a', target: [4, 0, -3], time: 2, forwardAxis }])).document;
    const matrix = ok(sample(output, 2)).sample.nodes.a.worldMatrix, axis = 'xyz'.indexOf(forwardAxis[1]), sign = forwardAxis[0] === '-' ? -1 : 1;
    const direction = [matrix[axis * 4], matrix[axis * 4 + 1], matrix[axis * 4 + 2]].map(value => value * sign);
    near(direction, [.8, 0, -.6]);
  }
  const zero = apply(input, [{ type: 'transform.lookAt', id: 'a', target: [0, 0, 0], time: 0 }]); assert.equal(zero.ok, false); assert.equal(zero.errors[0].code, 'DEGENERATE_LOOK_AT');
  assert.equal(apply(input, [{ type: 'transform.lookAt', id: 'a', target: [0, 10, 0], time: 0 }]).ok, false);
});

test('world writes do not claim success for a base value shadowed by a track', () => {
  const input = document([node('a', { tracks: { 'position.x': [frame(0, 0), frame(10, 10)] } })]);
  const result = apply(input, [{ type: 'transform.set', id: 'a', value: { position: [12, 0, 0] }, space: 'world', time: 5 }]);
  assert.equal(result.ok, false); assert.equal(result.errors[0].code, 'ANIMATED_WORLD_EDIT_REQUIRES_KEY');
  const local = ok(apply(input, [{ type: 'transform.set', id: 'a', value: { position: [12, 0, 0] } }]));
  assert.equal(local.warnings[0].code, 'BASE_SHADOWED_BY_TRACK');
});

test('subtree duplication keeps cloned tracks together and preserves parent references', () => {
  const input = document([node('a', { parent: 'g' }), node('b', { parent: 'g' }), node('c')], [group('g')]);
  const output = ok(apply(input, [{ type: 'node.duplicate', id: 'g', idMap: { g: 'g2', a: 'a2', b: 'b2' } }])).document;
  assert.deepEqual(output.content.instances.map(item => item.id), ['a', 'b', 'a2', 'b2', 'c']);
  assert.equal(output.content.instances[2].parent, 'g2'); assert.equal(output.content.groups[1].id, 'g2');
});

test('spatial audio facts use unbounded semantic distances from the shared current core', () => {
  const input = document([node('a', { position: [20000, 0, 0], media: { trimStartSeconds: 0, trimEndSeconds: 5, playbackRate: 1, volume: 1, loop: false, muted: false, spatial: { enabled: true, refDistance: 10000, maxDistance: 50000, rolloffFactor: 1 } } })]);
  const output = ok(sample(input, { time: 1, listener: { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } } })).sample.nodes.a;
  assert.equal(output.volume, .5); assert.equal(output.spatial.gain, .5);
});

test('sequence and scheduling stretch preserve natural media speed when fields are omitted', () => {
  const input = document([node('a'), node('b')]);
  const options = { resources: { [ASSET]: { assetId: ASSET, kind: 'audio', durationSeconds: 2 } } };
  const sequence = ok(apply(input, [{ type: 'time.sequence', ids: ['a', 'b'], gap: 1 }], options)).document;
  assert.deepEqual(sequence.content.instances.map(item => [item.timing.startSeconds, item.timing.endSeconds]), [[0, 2], [3, 5]]);
  const stretched = ok(apply(input, [{ type: 'time.stretch', ids: ['a'], factor: 2 }], options)).document;
  assert.equal(stretched.content.instances[0].media, undefined);
  assert.equal(stretched.content.instances[0].timing.endSeconds, 4);
  assert.equal(ok(sample(stretched, { time: 2, ...options })).sample.nodes.a.mediaTime, 2);
});
