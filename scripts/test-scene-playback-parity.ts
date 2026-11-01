import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Box3, type Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createSceneCore } from '@spatial-memory/scene-core';
import type { CompositionContent, CompositionInstance, TransformChannel } from '../lib/scene/protocol';
import { Editor } from '../vendor/three-editor';
import { EditorModels, groundPivot } from '../app/manage/scenes/components/three-editor/models';
import { ModelPool } from '../app/manage/scenes/components/three-editor/model-pool';
import type { ThreeViewportProps } from '../app/manage/scenes/components/three-editor/types';

const require = createRequire(import.meta.url);
const miniRoot = resolve('../spatial-memory-mini-program/miniprogram');
const { createFixtureGLB } = require(`${miniRoot}/labs/xr-three/runtime`);
const { THREE } = require(`${miniRoot}/lib/three-runtime/runtime`);
const { ModelCache } = require(`${miniRoot}/lib/three-runtime/resources`);
const { createCompositionPlayer } = require(`${miniRoot}/lib/scene-runtime/composition`);
const miniCore = require(`${miniRoot}/lib/scene-runtime/vendor/scene-core`);
function content(loop: boolean, grouped = false): CompositionContent {
  const instances: CompositionInstance[] = [false, true].map((clipLoop, i) => ({ id: `model${i}`, asset: 'model', position: [i, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: { clipIndex: 0, startSeconds: i + 1, loop: clipLoop } }));
  for (const instance of instances) {
    instance.tracks = {};
    for (const [g, group] of ['position', 'rotation', 'scale'].entries()) for (const [a, axis] of ['x', 'y', 'z'].entries()) {
      instance.tracks[`${group}.${axis}` as TransformChannel] = [0, 4, 8].map((time, i) => ({ time,
        value: group === 'scale' ? 1 + i * 0.2 + a * 0.1 : (i - 1) * (a + 1) * 0.3 + g * 0.1,
        handles: [0.8, 0.2, 0.2, 0.9], connectedRight: i === 0,
      }));
    }
  }
  const base: CompositionContent = { kind: 'composition', units: 'meters', durationSeconds: 10, loop, assets: { model: { assetId: '11111111-1111-4111-8111-111111111111' } }, instances };
  if (!grouped) return base;
  // Second model inside a nested, animated group: parents must compose identically on both hosts.
  instances[1].parent = 'inner';
  const bezier = (values: number[]) => values.map((value, i) => ({ time: i * 4, value, handles: [0.3, 0.1, 0.6, 0.9] as [number, number, number, number], connectedRight: true }));
  return { ...base, groups: [
    { id: 'rig', name: 'Rig', position: [0, 1, 0], rotation: [0, 0.4, 0], scale: [1.5, 1.5, 1.5], tracks: { 'rotation.y': bezier([0, 2, 4]), 'position.z': bezier([0, -1, 1]) } },
    { id: 'inner', name: 'Inner', parent: 'rig', position: [0.5, 0, 0], rotation: [0.2, 0, 0], scale: [1, 2, 1], tracks: { 'scale.x': bezier([1, 2, 0.5]) } },
  ] };
}
async function main() {
  let comparisons = 0, maximumError = 0;
  const near = (a: number, b: number) => { const error = Math.abs(a - b); maximumError = Math.max(maximumError, error); comparisons++; assert.ok(error < 1e-7, `${a} != ${b}`); };
  for (const [loop, grouped] of [[false, false], [true, false], [false, true], [true, true]]) {
    const definition = content(loop, grouped);
    const bytes = createFixtureGLB();
    const webGLB = await new GLTFLoader().parseAsync(bytes.slice(0), '');
    const miniGLB = await new Promise<{ scene: Group }>((resolve, reject) => new THREE.GLTFLoader().parse(bytes.slice(0), '', resolve, reject));
    // Grouped runs also use an offset pivot like a Sketchfab export; both hosts must ground it identically.
    if (grouped) for (const scene of [webGLB.scene, miniGLB.scene]) scene.position.set(-3, 0.2, 3.3);
    const cache = new ModelCache(null, 8, async () => miniGLB);
    const player = createCompositionPlayer({ schemaVersion: grouped ? 5 : 4, assetId: 'parity', content: JSON.parse(JSON.stringify(definition)), resources: { model: { url: 'fixture.glb' } } }, { modelCache: cache });
    await player.load(); assert.equal(player.state, 'ready');
    const web = await createSceneCore({ content: definition });
    const nativeEditor = new Editor({ config: { getKey: () => 'en', setKey() {} }, history: { execute() {}, clear() {} } });
    let readyCount = 0, resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const props = { session: web, instances: definition.instances, groups: definition.groups, resolveUrl: () => 'fixture.glb', onClips() {}, onError(message: string) { rejectReady(new Error(message)); } } as unknown as ThreeViewportProps;
    const models = new EditorModels(nativeEditor, () => props, () => false, () => { if (++readyCount === definition.instances.length) resolveReady(); }, new ModelPool(async () => webGLB));
    models.sync(); await ready;
    for (const time of [0, 0.02, 0.3, 0.99, 1, 1.001, 1.5, 2, 3.99, 4, 4.001, 7.99, 8, 9.99, 10, 10.02, 22.5]) {
      web.seek(0); void web.play(loop); web.advance(time);
      player.restart(); player.update(time); near(web.time, player.time);
      models.frame();
      for (const [i, instance] of definition.instances.entries()) {
        const item = models.entries.get(instance.id)!;
        item.root!.updateWorldMatrix(true, true); player.instances[i].instanceRoot.updateWorldMatrix(true, true);
        const webValues: number[] = [], miniValues: number[] = [];
        item.root!.traverse(node => webValues.push(...node.matrixWorld.elements));
        player.instances[i].instanceRoot.traverse((node: Group) => miniValues.push(...node.matrixWorld.elements));
        assert.equal(webValues.length, miniValues.length); webValues.forEach((value, j) => near(value, miniValues[j]));
      }
    }
    web.pause(); player.pause(); const paused = player.time; web.advance(3); player.update(3); near(player.time, paused);
    models.dispose();
    web.dispose(); player.dispose(); cache.dispose();
  }
  // The pivot puts the model's bottom-center on the instance origin.
  const offsetModel = (await new GLTFLoader().parseAsync(createFixtureGLB().slice(0), '')).scene;
  offsetModel.position.set(-3, 0.2, 3.3);
  const grounded = new Box3().setFromObject(groundPivot(offsetModel));
  near(grounded.min.y, 0); near((grounded.min.x + grounded.max.x) / 2, 0); near((grounded.min.z + grounded.max.z) / 2, 0);
  // Players must be independent even in the same module scope.
  const a = content(false), b = content(false); b.durationSeconds = 5;
  const first = await miniCore.createSceneCore({ content: a });
  const second = await miniCore.createSceneCore({ content: b });
  void first.play(false); void second.play(false); first.advance(3); second.advance(1);
  near(first.time, 3); near(second.time, 1);
  first.dispose(); second.advance(1); near(second.time, 2); second.dispose();
  console.log(JSON.stringify({ result: 'PASS', webThree: '0.183.2', miniThree: THREE.REVISION, samples: 68, comparisons, maximumError, coverage: 'native Three Editor adapter vs mini CompositionPlayer; bottom-center pivots for offset models, nested animated groups, 9 transform channels, Bezier/hold, real GLB node animation, delayed/looping clips, scene loop/end, pause, isolated simultaneous players' }));
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
