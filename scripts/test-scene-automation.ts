import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleFade, sampleOpacity, samplePresentation, sampleSpatialAudio, sampleVolume } from '@spatial-memory/scene-core';
import { fromDocument, toDocument } from '../app/manage/lib/scene-document';
import { compileSceneManifest, resourceKindIssues } from '../lib/scene/compile';
import { createBlankSceneDocument, type CompositionGroup, type CompositionInstance, type TransformKeyframe } from '../lib/scene/protocol';
import { editChannel, keyTimes, moveKeys, removeKey, sampleChannel, setKey } from '../lib/scene/transform-authoring';
import { validateSceneDefinition, validateSceneDocument } from '../lib/scene/validate';

const key = (time: number, value: number): TransformKeyframe => ({ time, value, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3], connectedRight: true });
const node = (): CompositionInstance => ({ id: 'sound', asset: 'audio', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null });
const spatial = { enabled: true, refDistance: 1, maxDistance: 20, rolloffFactor: 1 };
const listener = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };

function document() {
  const doc = createBlankSceneDocument();
  doc.content.assets.audio = { assetId: '11111111-1111-4111-8111-111111111111' };
  doc.content.instances = [node()];
  return doc;
}

test('scalar tracks share interpolation and key edits without changing transforms or audio fades', () => {
  let item = editChannel(node(), 'volume', 0, .8);
  assert.equal(item.media?.volume, .8);
  item = setKey(setKey(item, 'volume', 0, .2), 'volume', 4, 1);
  item = setKey(setKey(item, 'opacity', 0, 1), 'opacity', 4, 0);
  item.timing = { startSeconds: 0, endSeconds: 6, fadeInSeconds: 4, fadeOutSeconds: 0 };
  assert.ok(Math.abs(sampleVolume(item, 2) - .6) < 1e-12);
  assert.equal(sampleOpacity(item, 2), .5);
  assert.equal(samplePresentation(item, 2, 6).opacity, .25);
  assert.equal(sampleFade(item, 2, 6).opacity, .5, 'visual opacity never changes audio gain');
  assert.ok(Math.abs(sampleChannel(item, 'volume', 2) - .6) < 1e-12);
  item = editChannel(item, 'volume', 2, .4);
  assert.equal(item.media?.volume, .8, 'animated editing does not overwrite static fallback');
  assert.deepEqual(keyTimes(item, ['volume', 'opacity']), [0, 2, 4]);
  item = moveKeys(item, ['volume'], 2, 3);
  assert.equal(sampleVolume(item, 3), .4);
  assert.equal(moveKeys(item, ['volume'], 3, 4), item, 'key collisions leave the document unchanged');
  const single = setKey(node(), 'volume', 2, .35);
  const unkeyed = removeKey(single, 'volume', 2);
  assert.equal(unkeyed.tracks?.volume, undefined);
  assert.equal(unkeyed.media?.volume, .35, 'last removed audio key preserves the audible value');
  assert.equal(removeKey(setKey(node(), 'opacity', 1, .3), 'opacity', 1).opacity, .3);
  assert.deepEqual(item.position, [0, 0, 0]);
  const group: CompositionGroup = { id: 'group', name: 'Group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  assert.equal(setKey(group, 'opacity', 0, .5), group, 'groups cannot acquire scalar tracks');
  assert.equal(editChannel(group, 'volume', 0, .5), group);
});

test('scalar sampling preserves hold and clamps imported Bezier overshoot', () => {
  const item = node();
  item.tracks = { opacity: [{ ...key(0, 0), connectedRight: false }, key(4, 1)] };
  assert.equal(sampleOpacity(item, 3.999), 0);
  assert.equal(sampleOpacity(item, 4), 1);
  item.tracks.opacity = [{ ...key(0, 0), handles: [0, 0, .3, 100] }, { ...key(4, 1), handles: [.7, 100, 1, 1] }];
  assert.equal(sampleOpacity(item, 2), 1);
  assert.equal(sampleVolume(node(), 0), 1);
  assert.equal(sampleOpacity(node(), 0), 1);
});

test('spatial sound follows distance, listener translation and orientation in world meters', () => {
  assert.deepEqual(sampleSpatialAudio(undefined, { x: 8, y: 0, z: 0 }, listener), { gain: 1, pan: 0 });
  assert.deepEqual(sampleSpatialAudio(spatial, { x: 0, y: 0, z: 0 }, listener), { gain: 1, pan: 0 });
  assert.deepEqual(sampleSpatialAudio(spatial, { x: 2, y: 0, z: 0 }, listener), { gain: .5, pan: 1 });
  assert.deepEqual(sampleSpatialAudio(spatial, { x: -2, y: 0, z: 0 }, listener), { gain: .5, pan: -1 });
  assert.deepEqual(sampleSpatialAudio(spatial, { x: 0, y: 0, z: -4 }, listener), { gain: .25, pan: 0 });
  assert.equal(sampleSpatialAudio(spatial, { x: 100, y: 0, z: 0 }, listener).gain, .05, 'distance attenuation clamps at the configured maximum');
  assert.equal(sampleSpatialAudio({ ...spatial, rolloffFactor: 0 }, { x: 100, y: 0, z: 0 }, listener).gain, 1);
  assert.equal(sampleSpatialAudio({ enabled: true, refDistance: 200, maxDistance: 2000, rolloffFactor: 20 }, { x: 2000, y: 0, z: 0 }, listener).gain, 200 / (200 + 20 * 1800), 'configured distances and rolloff are not capped');
  assert.ok(Math.abs(sampleSpatialAudio({ enabled: true, refDistance: .001, maxDistance: .1, rolloffFactor: 1 }, { x: .01, y: 0, z: 0 }, listener).gain - .1) < 1e-12, 'positive sub-decimeter reference distances retain their scale');
  const turned = { ...listener, forward: { x: 0, y: 0, z: 1 } };
  assert.equal(sampleSpatialAudio(spatial, { x: 2, y: 0, z: 0 }, turned).pan, -1);
  const translated = { ...listener, position: { x: 5, y: 7, z: -3 } };
  assert.deepEqual(sampleSpatialAudio(spatial, { x: 7, y: 7, z: -3 }, translated), { gain: .5, pan: 1 });
  assert.deepEqual(sampleSpatialAudio(spatial, { x: NaN, y: 0, z: 0 }, listener), { gain: 0, pan: 0 });
});

test('automation requires schema 8, validates values, and accepts long automation tracks', () => {
  const doc = document();
  let item = setKey(setKey(node(), 'volume', 0, 0), 'volume', 4, 1);
  item = editChannel(item, 'opacity', 0, .7);
  item.media = { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, volume: .5, muted: false, loop: false, spatial };
  doc.content.instances = [item];
  assert.equal(validateSceneDocument(doc).ok, true);
  assert.deepEqual(toDocument(fromDocument(JSON.parse(JSON.stringify(doc)))), doc, 'scalar tracks and spatial parameters survive save/reopen');
  const manifest = compileSceneManifest('scene', doc, { audio: { assetId: doc.content.assets.audio.assetId, url: 'https://fixture.example/a.mp3', kind: 'audio' } });
  assert.equal(manifest.schemaVersion, 8);
  assert.equal(validateSceneDefinition({ schemaVersion: 8, content: manifest.content }).ok, true);
  assert.equal(validateSceneDefinition({ schemaVersion: 7, content: manifest.content }).ok, false);
  assert.deepEqual(resourceKindIssues(doc, { audio: 'audio' }), []);
  assert.ok(resourceKindIssues(doc, { audio: 'image' }).some(issue => issue.path.endsWith('.tracks.volume')));
  for (const patch of [{ refDistance: 0 }, { maxDistance: .5 }, { rolloffFactor: -1 }, { enabled: 'yes' }]) {
    const invalid = structuredClone(doc);
    Object.assign(invalid.content.instances[0].media!.spatial!, patch);
    assert.equal(validateSceneDocument(invalid).ok, false, JSON.stringify(patch));
  }
  for (const value of [-.01, 1.01, NaN, Infinity]) {
    const invalid = structuredClone(doc);
    invalid.content.instances[0].tracks!.volume![0].value = value;
    assert.equal(validateSceneDocument(invalid).ok, false, String(value));
    invalid.content.instances[0].tracks!.volume![0].value = 0;
    invalid.content.instances[0].opacity = value;
    assert.equal(validateSceneDocument(invalid).ok, false, `opacity ${value}`);
  }
  const groupInvalid = structuredClone(doc);
  groupInvalid.content.groups = [{ id: 'group', name: 'Group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], tracks: {} }];
  Object.assign(groupInvalid.content.groups[0].tracks!, { opacity: [key(0, .5)] });
  assert.equal(validateSceneDocument(groupInvalid).ok, false);
  const tooMany = structuredClone(doc);
  tooMany.content.instances[0].tracks = { volume: Array.from({ length: 2401 }, (_, i) => key(i / 100, .5)) };
  assert.equal(validateSceneDocument(tooMany).ok, true);
  const volumeText = document();
  volumeText.content.instances = [{ ...node(), asset: undefined, text: { content: 'Text', color: '#ffffff', fontSize: .2, width: 2, align: 'left' }, tracks: { volume: [key(0, .5)] } }];
  assert.equal(validateSceneDocument(volumeText).ok, false);
});
