import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankSceneDocument, type CompositionInstance, type TransformKeyframe } from '../lib/scene/protocol';
import { parseSceneDocument, validateSceneDocument } from '../lib/scene/validate';
import { fromDocument, toDocument } from '../app/manage/lib/scene-document';
import { compileSceneManifest } from '../lib/scene/compile';
import { apply, inspect, sample, validate } from '../packages/scene-authoring/src/index';
import { createBlankSceneDocument as sharedCreate } from '../packages/scene-authoring/src/protocol';
import { parseSceneDocument as sharedParse, validateSceneDocument as sharedValidate } from '../packages/scene-authoring/src/validate';
import { copyTracks, pasteTracks } from '../app/manage/scenes/components/scene-clipboard';

const assetId = '11111111-1111-4111-8111-111111111111';
const key = (time: number, value: number): TransformKeyframe => ({ time, value, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3], connectedRight: true });
const instance = (): CompositionInstance => ({ id: 'video', asset: 'media', animation: null, parent: 'rig', position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1], timing: { startSeconds: 2, endSeconds: 8, fadeInSeconds: 0, fadeOutSeconds: 0 }, media: { trimStartSeconds: 1, trimEndSeconds: 7, playbackRate: 1, volume: .7, muted: false, loop: false, spatial: { enabled: true, refDistance: 1, maxDistance: 30, rolloffFactor: 1 } }, tracks: { opacity: [key(2, 0), key(3, 1)], volume: [key(2, .4), key(4, .8)] } });

test('Web scene factories and parsers directly expose the canonical authoring schema', () => {
  assert.equal(createBlankSceneDocument, sharedCreate);
  assert.equal(parseSceneDocument, sharedParse);
  assert.equal(validateSceneDocument, sharedValidate);
  const document = createBlankSceneDocument();
  assert.deepEqual(validate(document).ok, validateSceneDocument(document).ok);
  for (const schemaVersion of [4, 5, 7, 8, 9]) {
    assert.equal(validate({ ...document, schemaVersion }).ok, false);
    assert.throws(() => parseSceneDocument({ ...document, schemaVersion }), /schemaVersion 6/);
  }
});

test('CLI authoring output survives the actual Web editor import/export and playback compiler', () => {
  const document = createBlankSceneDocument();
  const authored = apply(document, [
    { type: 'scene.update', patch: { durationSeconds: 7200, viewerPosition: [2, 1.8, 3] } },
    { type: 'asset.set', alias: 'media', assetId },
    { type: 'node.add', kind: 'group', node: { id: 'rig', name: 'Moving rig', position: [1000, 0, 0], rotation: [0, 0, 0], scale: [200, 200, 200], tracks: { 'position.x': [key(0, 1000), key(10, 2000)] } } },
    { type: 'node.add', kind: 'instance', node: instance() },
    { type: 'transform.set', id: 'video', space: 'world', write: 'key', time: 5, value: { position: [1800, 100, -800] } },
    { type: 'time.shift', ids: ['video'], seconds: 1000 },
    { type: 'node.update', id: 'video', patch: { hidden: true, media: { spatial: { maxDistance: 4000 } } } },
  ]);
  assert.equal(authored.ok, true, JSON.stringify(authored)); if (!authored.ok) return;
  const parsed = parseSceneDocument(authored.document);
  assert.deepEqual(toDocument(fromDocument(parsed)), authored.document);
  assert.equal(parsed.content.instances[0].media?.trimStartSeconds, 1, 'patching spatial settings retains source trimming');
  assert.equal(parsed.content.instances[0].tracks?.['position.x']?.[0].time, 1005, 'spatial key time moves together with presentation');
  const manifest = compileSceneManifest('preview', parsed, { media: { assetId, kind: 'video', url: 'https://fixture.example/video.mp4' } });
  assert.equal(manifest.schemaVersion, 9);
  assert.deepEqual(manifest.content.viewerPosition, [2, 1.8, 3]);
  assert.equal(manifest.content.instances[0].opacity, 0, 'hidden authoring state compiles to playback opacity');
  assert.equal(manifest.content.instances[0].tracks?.opacity, undefined);
  assert.ok(parsed.content.instances[0].tracks?.opacity, 'compiling does not erase authoring curves');
  assert.equal(inspect(parsed).ok, true); assert.equal(sample(parsed, 1005).ok, true);
});

test('the Web duplicate action preserves all schema fields and produces an independently editable copy', () => {
  const document = createBlankSceneDocument(); document.content.assets.media = { assetId };
  document.content.groups = [{ id: 'rig', name: 'Rig', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }];
  document.content.instances = [instance()];
  const snapshot = copyTracks(document.content, ['video'], () => 'Video');
  assert.ok(snapshot);
  const pasted = pasteTracks(document, snapshot, '副本');
  const parsed = parseSceneDocument(pasted.definition);
  assert.deepEqual(parsed.content.instances.map(item => item.id), ['video', pasted.selected[0]]);
  assert.deepEqual(parsed.content.instances[1], { ...document.content.instances[0], id: pasted.selected[0], name: 'Video 副本' });
  parsed.content.instances[1].media!.spatial!.maxDistance = 300;
  assert.equal(parsed.content.instances[0].media!.spatial!.maxDistance, 30);
  assert.equal(document.content.instances.length, 1, 'UI undo snapshot is not mutated');
});

test('scene clipboard retains a group snapshot after deletion and remaps parents and asset aliases', () => {
  const document = createBlankSceneDocument();
  document.content.assets.media = { assetId };
  document.content.groups = [{ id: 'rig', name: 'Rig', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }];
  document.content.instances = [instance()];
  const snapshot = copyTracks(document.content, ['rig', 'video'], node => node.name ?? node.id);
  assert.ok(snapshot);
  assert.equal(snapshot.nodes.length, 2, 'selecting both a parent and child copies the child once');
  document.content.instances[0].media!.volume = .1;
  const destination = createBlankSceneDocument();
  destination.content.assets.media = { assetId: '22222222-2222-4222-8222-222222222222' };
  const first = pasteTracks(destination, snapshot, 'copy');
  const copied = first.definition.content.instances[0];
  assert.equal(first.selected.length, 1);
  assert.equal(copied.parent, first.selected[0]);
  assert.equal(copied.media?.volume, .7, 'the copy-time snapshot survives source edits');
  assert.equal(first.definition.content.assets[copied.asset!].assetId, assetId);
  assert.notEqual(copied.asset, 'media', 'conflicting aliases are preserved');
  const second = pasteTracks(first.definition, snapshot, 'copy');
  assert.notEqual(second.selected[0], first.selected[0]);
  assert.equal(second.definition.content.instances.length, 2);
  assert.equal(Object.keys(second.definition.content.assets).length, 2, 'repeated paste reuses the restored asset');
  assert.equal(validate(second.definition).ok, true);
  assert.equal(copyTracks(destination.content, [], node => node.id), null);
});

test('shared atomic failures preserve the Web document and semantic validators still reject invalid data', () => {
  const document = createBlankSceneDocument(), before = structuredClone(document);
  const failure = apply(document, [{ type: 'scene.update', patch: { durationSeconds: 10000 } }, { type: 'asset.set', alias: 'media', assetId: 'not-a-uuid' }]);
  assert.equal(failure.ok, false); if (failure.ok) return;
  assert.equal(failure.errors[0].opIndex, 1); assert.deepEqual(document, before);
  for (const durationSeconds of [0, -1, Infinity, NaN]) {
    const invalid = { ...document, content: { ...document.content, durationSeconds } };
    assert.equal(validate(invalid).ok, false); assert.equal(validateSceneDocument(invalid).ok, false);
  }
});
