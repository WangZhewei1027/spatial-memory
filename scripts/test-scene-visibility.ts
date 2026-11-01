import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromDocument, toDocument } from '../app/manage/lib/scene-document';
import { compileSceneManifest } from '../lib/scene/compile';
import { createBlankSceneDocument, type CompositionInstance } from '../lib/scene/protocol';
import { setKey } from '../lib/scene/transform-authoring';
import { validateSceneDefinition, validateSceneDocument } from '../lib/scene/validate';
import { hiddenNodeIds, setNodeVisible } from '../lib/scene/visibility';

const assetId = '11111111-1111-4111-8111-111111111111';
function document() {
  const doc = createBlankSceneDocument();
  doc.content.assets.model = { assetId };
  doc.content.instances = [{ id: 'object', asset: 'model', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null }];
  return doc;
}
const resources = { model: { assetId, url: 'https://fixture.example/model.glb', kind: 'model' as const } };

test('hidden authoring round-trips and compiles to compatible opacity without losing authored curves', () => {
  const doc = document();
  const original = setKey(setKey(doc.content.instances[0], 'opacity', 0, .8), 'opacity', 4, .2);
  doc.content.instances[0] = setNodeVisible(original, false);
  assert.equal(validateSceneDocument(doc).ok, true);
  assert.deepEqual(toDocument(fromDocument(JSON.parse(JSON.stringify(doc)))), doc);
  const saved = structuredClone(doc);
  const manifest = compileSceneManifest('scene', doc, resources);
  assert.equal(manifest.schemaVersion, 8);
  assert.equal(validateSceneDefinition({ schemaVersion: 8, content: manifest.content }).ok, true);
  assert.equal(manifest.content.instances[0].opacity, 0);
  assert.equal(manifest.content.instances[0].tracks?.opacity, undefined);
  assert.equal('hidden' in manifest.content.instances[0], false);
  assert.deepEqual(doc, saved, 'compiling never mutates the saved document');
  doc.content.instances[0] = setNodeVisible(doc.content.instances[0], true);
  assert.deepEqual(doc.content.instances[0], original, 'show restores exact authored values and keys');
  assert.deepEqual(compileSceneManifest('scene', doc, resources).content.instances[0], original);
  Object.assign(doc.content.instances[0], { hidden: 'yes' });
  assert.equal(validateSceneDocument(doc).ok, false);
});

test('group visibility respects child choices, preserves sound and emits no authoring flags', () => {
  const doc = document(), base = doc.content.instances[0];
  const media: CompositionInstance['media'] = { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, volume: .6, muted: false, loop: true };
  doc.content.groups = [{ id: 'group', name: 'Group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], hidden: true }];
  doc.content.instances = [
    { ...base, parent: 'group', media, tracks: { volume: setKey(base, 'volume', 1, .7).tracks!.volume } },
    { ...base, id: 'child', parent: 'group', hidden: true },
    { ...base, id: 'unrelated' },
  ];
  assert.deepEqual([...hiddenNodeIds(doc.content)], ['group', 'object', 'child']);
  const content = compileSceneManifest('scene', doc, resources).content;
  assert.equal('hidden' in content.groups![0], false);
  assert.equal(content.instances[0].opacity, 0);
  assert.deepEqual(content.instances[0].media, media, 'hiding pictures does not mute sound');
  assert.deepEqual(content.instances[0].tracks?.volume, doc.content.instances[0].tracks?.volume);
  assert.equal(content.instances[2].opacity, undefined);
  doc.content.groups[0] = setNodeVisible(doc.content.groups[0], true);
  assert.deepEqual([...hiddenNodeIds(doc.content)], ['child'], 'showing the group keeps a child explicitly hidden');
});

test('visible legacy model scenes retain their released playback schema', () => {
  const doc = document();
  assert.equal(compileSceneManifest('scene', doc, resources).schemaVersion, 4);
  doc.content.instances[0] = setNodeVisible(doc.content.instances[0], false);
  assert.equal(compileSceneManifest('scene', doc, resources).schemaVersion, 8);
  doc.content.instances[0] = setNodeVisible(doc.content.instances[0], true);
  assert.equal(compileSceneManifest('scene', doc, resources).schemaVersion, 4);
  doc.content.groups = [{ id: 'group', name: 'Group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }];
  assert.equal(compileSceneManifest('scene', doc, resources).schemaVersion, 5);
});
