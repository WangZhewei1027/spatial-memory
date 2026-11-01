import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SCENE_VIEWER_POSITION, scenePlacementFromCamera } from '@spatial-memory/scene-core';
import { Matrix4, Vector3 } from 'three';
import { createBlankSceneDocument } from '../lib/scene/protocol';
import { validateSceneDefinition, validateSceneDocument } from '../lib/scene/validate';
import { compileSceneManifest } from '../lib/scene/compile';

const near = (actual: readonly number[], expected: readonly number[]) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-8, `${actual} != ${expected}`));
};

test('default viewer is 1.5m above the scene ground, 2m in front', () => {
  assert.deepEqual(DEFAULT_SCENE_VIEWER_POSITION, [0, 1.5, 2]);
  assert.ok(Object.isFrozen(DEFAULT_SCENE_VIEWER_POSITION));
  const placement = scenePlacementFromCamera([0, 0, 0], [0, 0, -1]);
  near(placement.position, [0, -1.5, -2]); assert.equal(placement.yaw, 0);
});

test('placement maps the authored viewer onto the phone without tilting the ground', () => {
  const camera: [number, number, number] = [12, 7, -4];
  for (const viewer of [[0, 1.5, 2], [2, .8, 3], [-3, -1.2, -4]] as const) {
    for (const forward of [[0, 0, -1], [-1, -.5, 0], [.6, .4, -.8]] as const) {
      const placement = scenePlacementFromCamera(camera, forward, viewer);
      const matrix = new Matrix4().makeRotationY(placement.yaw).setPosition(...placement.position);
      near(new Vector3(...viewer).applyMatrix4(matrix).toArray(), camera);
      near(new Vector3(0, 1, 0).transformDirection(matrix).toArray(), [0, 1, 0]);
      assert.ok(Math.abs(placement.position[1] - (camera[1] - viewer[1])) < 1e-8);
      const lookDirection = new Vector3(0, viewer[1], 0).applyMatrix4(matrix).sub(new Vector3(...camera)).normalize();
      near(lookDirection.toArray(), new Vector3(forward[0], 0, forward[2]).normalize().toArray());
    }
  }
});

test('undefined headings and non-finite placement inputs are rejected', () => {
  assert.throws(() => scenePlacementFromCamera([0, 0, 0], [0, 1, 0]));
  assert.throws(() => scenePlacementFromCamera([Infinity, 0, 0], [0, 0, -1]));
  assert.throws(() => scenePlacementFromCamera([0, 0, 0], [0, 0, -1], [0, 1.5, 0]));
});

test('viewer position validates and compiles only for capable playback manifests', () => {
  const document = createBlankSceneDocument();
  document.content.viewerPosition = [2, 1.8, 3];
  assert.equal(validateSceneDocument(document).ok, true);
  const manifest = compileSceneManifest('scene', document, {});
  assert.equal(manifest.schemaVersion, 9); assert.deepEqual(manifest.content.viewerPosition, [2, 1.8, 3]);
  assert.equal(validateSceneDefinition({ schemaVersion: manifest.schemaVersion, content: manifest.content }).ok, true);
  assert.equal(validateSceneDefinition({ schemaVersion: 9, content: createBlankSceneDocument().content }).ok, false, 'schema 9 requires its authored viewer position');
  for (const schemaVersion of [4, 5, 7, 8]) assert.equal(validateSceneDefinition({ schemaVersion, content: manifest.content }).ok, false);
  assert.equal(compileSceneManifest('scene', createBlankSceneDocument(), {}).schemaVersion, 4);
  for (const viewerPosition of [null, [0, 1.5], [0, 1.5, 0], [0, Infinity, 2], [0, 1.5, 2, 3]]) {
    assert.equal(validateSceneDocument({ ...document, content: { ...document.content, viewerPosition } }).ok, false);
  }
});
