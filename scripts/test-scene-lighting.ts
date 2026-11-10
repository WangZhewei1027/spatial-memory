import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SCENE_LIGHTING, lightingIssues } from '../packages/scene-lighting/config.js';
import { createBlankSceneDocument } from '../lib/scene/protocol';
import { validateSceneDocument, validateSceneDefinition } from '../lib/scene/validate';
import { compileSceneManifest } from '../lib/scene/compile';
import { fromDocument, toDocument } from '../app/manage/lib/scene-document';
import { selectSceneNodes } from '../app/manage/scenes/components/scene-selection';
import { MultiSelection } from '../app/manage/scenes/components/three-editor/multi-selection';
import { registerInstance } from '../app/manage/scenes/components/three-editor/transform-bridge';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import { renderSceneContent, type SceneLightingRig } from '../packages/scene-lighting/index.js';

test('lighting survives editor save/reopen and requires the lighting-capable playback protocol', () => {
  const doc = createBlankSceneDocument();
  doc.content.lighting = { ...DEFAULT_SCENE_LIGHTING, directionalIntensity: 4, environmentRotation: 65 };
  assert.equal(validateSceneDocument(doc).ok, true);
  assert.deepEqual(toDocument(fromDocument(doc)).content.lighting, doc.content.lighting);
  const manifest = compileSceneManifest('fixture', doc, {});
  assert.equal(manifest.schemaVersion, 10);
  assert.deepEqual(manifest.content.lighting, doc.content.lighting);
  assert.equal(validateSceneDefinition({ schemaVersion: 10, content: manifest.content }).ok, true);
  assert.equal(validateSceneDefinition({ schemaVersion: 9, content: { ...manifest.content, viewerPosition: [0, 1.5, 2] } }).ok, false);
  assert.equal(validateSceneDefinition({ schemaVersion: 10, content: createBlankSceneDocument().content }).ok, false);
  assert.equal(compileSceneManifest('legacy', createBlankSceneDocument(), {}).schemaVersion, 4);
  for (const patch of [{ ambientIntensity: NaN }, { directionalIntensity: -1 }, { environmentIntensity: 6 }, { azimuth: 181 }, { elevation: 91 }, { ambientColor: 'red' }, { environment: 'url' }, { url: 'https://invalid' }]) {
    const lighting = { ...DEFAULT_SCENE_LIGHTING, ...patch };
    assert.ok(lightingIssues(lighting).length);
    assert.equal(validateSceneDocument({ ...doc, content: { ...doc.content, lighting } }).ok, false);
  }
});

test('toggle and repeated range selection keep a stable anchor and active item', () => {
  const order = ['a', 'b', 'c', 'd'];
  const first = selectSceneNodes([], 'b', order, null, {});
  const range = selectSceneNodes(first.ids, 'd', order, first.anchor, { shiftKey: true });
  assert.deepEqual(range, { ids: ['b', 'c', 'd'], anchor: 'b' });
  assert.deepEqual(selectSceneNodes(range.ids, 'c', order, range.anchor, { shiftKey: true }).ids, ['b', 'c']);
  assert.deepEqual(selectSceneNodes(range.ids, 'c', order, range.anchor, { metaKey: true }).ids, ['b', 'd']);
  assert.deepEqual(selectSceneNodes(['a'], 'c', order, 'a', { ctrlKey: true, shiftKey: true }).ids, ['a', 'b', 'c']);
});

test('multi-object world transforms preserve hierarchy and transform a selected parent only once', () => {
  const scene = new Group(), helpers = new Group(), parent = new Group(); scene.add(parent);
  parent.position.set(3, 0, 0); parent.rotation.y = Math.PI / 3;
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const a = new Mesh(geometry, material), b = new Mesh(geometry, material), child = new Mesh(geometry, material);
  a.position.set(-1, 0, 0); b.position.set(1, 0, 0); child.position.y = 1;
  parent.add(a); scene.add(b); a.add(child);
  registerInstance(a, 'a'); registerInstance(b, 'b'); registerInstance(child, 'child');
  const selection = new MultiSelection(helpers);
  selection.set([a, b, child]); scene.updateMatrixWorld(true);
  const initial = [a, b, child].map(object => object.getWorldPosition(new Vector3()));
  selection.begin(); selection.pivot.position.x += 2; selection.move();
  for (const [index, object] of [a, b, child].entries()) assert.ok(object.getWorldPosition(new Vector3()).distanceTo(initial[index].clone().add(new Vector3(2, 0, 0))) < 1e-8);
  assert.deepEqual(selection.values().map(value => value.id), ['a', 'b']);
  assert.equal(a.parent, parent); assert.equal(child.parent, a);
  selection.end(); selection.set([a, b]); selection.begin(); selection.pivot.rotation.y = Math.PI / 2; selection.move();
  assert.ok(selection.values().every(value => Object.values(value.scale).every(value => value > 0)));
  selection.end(); selection.dispose(); geometry.dispose(); material.dispose();
  assert.equal(helpers.children.length, 0);
});

test('simultaneous AR scenes isolate their lights and restore visibility on a failed render', () => {
  const scene = new Scene(), content = new Group(), camera = new PerspectiveCamera(); scene.add(content);
  const ordinary = new Group(), near = new Group(), far = new Group(), hidden = new Group();
  ordinary.name = 'ordinary'; near.name = 'near'; far.name = 'far'; hidden.visible = false;
  near.position.z = -2; far.position.z = -8;
  near.userData.sceneLighting = { ...DEFAULT_SCENE_LIGHTING, ambientColor: '#ff0000' };
  far.userData.sceneLighting = { ...DEFAULT_SCENE_LIGHTING, ambientColor: '#0000ff' };
  content.add(ordinary, near, far, hidden);
  let current: unknown, fail = false;
  const passes: { roots: string[]; settings: unknown }[] = [];
  const lighting = { apply(settings = DEFAULT_SCENE_LIGHTING) { current = settings; } } as SceneLightingRig;
  const renderer = { autoClear: true, render() {
    if (fail) throw new Error('context lost');
    passes.push({ roots: content.children.filter(root => root.visible).map(root => root.name), settings: current });
  } } as unknown as WebGLRenderer;
  renderSceneContent(renderer, scene, camera, content, lighting);
  assert.deepEqual(passes.map(pass => pass.roots), [['ordinary'], ['far'], ['near']]);
  assert.equal(passes[1].settings, far.userData.sceneLighting); assert.equal(passes[2].settings, near.userData.sceneLighting);
  assert.deepEqual(content.children.map(root => root.visible), [true, true, true, false]);
  assert.equal(renderer.autoClear, true);
  fail = true;
  assert.throws(() => renderSceneContent(renderer, scene, camera, content, lighting), /context lost/);
  assert.deepEqual(content.children.map(root => root.visible), [true, true, true, false]);
  assert.equal(renderer.autoClear, true);
});
