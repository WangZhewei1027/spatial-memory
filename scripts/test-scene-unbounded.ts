import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { sceneFarPlane, updateCameraClipping } from '../app/manage/scenes/components/three-editor/camera-clipping';
import { fitSpan, gridSteps } from '../app/manage/scenes/components/timeline-scale';
import { roundTime } from '../lib/scene/transform-authoring';
import { trackRows } from '../lib/scene/hierarchy-authoring';
import { parseSceneText, validateSceneDocument } from '../lib/scene/validate';
import { unboundedScene } from './test-support/unbounded-scene';

test('large compositions preserve counts, long times, arbitrary finite transforms and text', () => {
  const document = unboundedScene();
  assert.deepEqual(validateSceneDocument(document), { ok: true, issues: [] });
  assert.equal(trackRows(document.content).length, 45);
  assert.equal(parseSceneText(JSON.stringify({ schemaVersion: 8, content: document.content })).content.instances.length, 25);
  document.content.instances[0].media!.spatial!.refDistance = .00001;
  assert.equal(validateSceneDocument(document).ok, true, 'small positive values are not rounded into zero');
});

test('finite values, positive dimensions, nonnegative times and unit intervals remain enforced', () => {
  const changes = [
    (d: ReturnType<typeof unboundedScene>) => { d.content.durationSeconds = Infinity; },
    (d: ReturnType<typeof unboundedScene>) => { d.content.instances[0].position[0] = NaN; },
    (d: ReturnType<typeof unboundedScene>) => { d.content.instances[0].scale[0] = 0; },
    (d: ReturnType<typeof unboundedScene>) => { Object.assign(d.content.instances[0].media!, { playbackRate: 0 }); },
    (d: ReturnType<typeof unboundedScene>) => { d.content.instances[0].timing!.startSeconds = -1; },
    (d: ReturnType<typeof unboundedScene>) => { d.content.instances[0].media!.volume = 1.01; },
    (d: ReturnType<typeof unboundedScene>) => { d.content.instances[0].opacity = -.01; },
    (d: ReturnType<typeof unboundedScene>) => { d.content.instances[24].text!.fontSize = 0; },
    (d: ReturnType<typeof unboundedScene>) => { d.content.instances[0].tracks!['position.x']![0].handles[0] = -1; },
  ];
  for (const change of changes) { const doc = unboundedScene(); change(doc); assert.equal(validateSceneDocument(doc).ok, false); }
});

test('cycles reached through another parent and missing references terminate with errors', () => {
  const document = unboundedScene();
  document.content.groups![0].parent = 'group_2';
  assert.ok(validateSceneDocument(document).issues.some(issue => issue.message.includes('循环')));
  assert.doesNotThrow(() => trackRows(document.content));
  document.content.groups![0].parent = 'missing';
  assert.ok(validateSceneDocument(document).issues.some(issue => issue.message.includes('不存在')));
});

test('camera far plane follows transformed world bounds and camera distance', () => {
  const content = new Group(), nested = new Group();
  nested.position.set(10_000, 0, 0); nested.scale.setScalar(1000); content.add(nested);
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()); nested.add(mesh);
  const camera = new PerspectiveCamera(60, 1, .01, 100);
  assert.ok(sceneFarPlane(camera, content) > 11_000);
  updateCameraClipping(camera, content);
  assert.ok(camera.far > 11_000);
  camera.position.x = -10_000;
  assert.ok(sceneFarPlane(camera, content) > 21_000);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('long timelines keep tick density bounded without truncating scene duration', () => {
  for (const duration of [100_000, 1e9, Number.MAX_VALUE]) {
    const span = fitSpan(duration), steps = gridSteps(1000 / span);
    assert.ok(Number.isFinite(span) && span >= duration);
    assert.ok(Number.isFinite(steps.major) && steps.major > 0);
    assert.ok(span / steps.major < 20, 'ruler labels scale with visible pixels');
    assert.ok(Number.isFinite(roundTime(duration)));
  }
});
