import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Group, Mesh, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createSceneCore } from '@spatial-memory/scene-core';
import { Editor } from '../vendor/three-editor';
import { SetPositionCommand } from '../vendor/three-editor/commands/SetPositionCommand.js';
import { applyEditorCommand, instanceRoot, registerInstance } from '../app/manage/scenes/components/three-editor/transform-bridge';
import { ModelPool } from '../app/manage/scenes/components/three-editor/model-pool';
import { EditorModels } from '../app/manage/scenes/components/three-editor/models';
import type { ThreeViewportProps } from '../app/manage/scenes/components/three-editor/types';
import type { CompositionContent } from '../lib/scene/protocol';

const require = createRequire(import.meta.url);
const { createFixtureGLB } = require('../../spatial-memory-mini-program/miniprogram/labs/xr-three/runtime');
const fixture = () => new GLTFLoader().parseAsync(createFixtureGLB(), '');
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function main() {
  const manifest = JSON.parse(readFileSync('vendor/three-editor/integrity.json', 'utf8'));
  for (const [name, hashes] of Object.entries(manifest.files) as [string, { embedded: string }][]) assert.equal(createHash('sha256').update(readFileSync(`vendor/three-editor/${name}`)).digest('hex'), hashes.embedded, name);
  const root = new Group(), mesh = new Mesh(); registerInstance(root, 'model'); mesh.userData.sceneInstanceId = 'spoofed-asset-metadata'; root.add(mesh);
  assert.equal(instanceRoot(mesh), root); assert.equal(instanceRoot(new Group()), null);
  const writes: unknown[] = [];
  const session: ThreeViewportProps['onTransform'] = (id, group, value) => { writes.push({ id, group, value }); };
  const editor = new Editor({ config: { getKey: () => 'en', setKey() {} }, history: { execute() {}, clear() {} } });
  const command = new SetPositionCommand(editor, root, new Vector3(150, 2, -200));
  assert.equal(applyEditorCommand(session, command, true), true);
  assert.deepEqual(writes, [{ id: 'model', group: 'position', value: { x: 150, y: 2, z: -200 } }]);
  assert.equal(applyEditorCommand(session, command, false), false, 'read-only must not write');
  assert.equal(applyEditorCommand(session, { ...command, type: 'SetMaterialCommand', execute: () => command.execute() }, true), false);
  assert.equal(applyEditorCommand(session, new SetPositionCommand(editor, mesh, new Vector3(1, 2, 3)), true), false, 'GLB internals cannot become unsaved instance transforms');
  assert.equal(writes.length, 1);

  let finish!: (value: GLTF) => void;
  const pendingPool = new ModelPool(() => new Promise(resolve => { finish = resolve; }));
  const first = pendingPool.acquire('shared'), second = pendingPool.acquire('shared');
  await pause();
  const gltf = await fixture(); let geometryDisposals = 0;
  gltf.scene.traverse(node => { const geometry = (node as Mesh).geometry; if (geometry) geometry.addEventListener('dispose', () => geometryDisposals++); });
  first.release(); second.release(); pendingPool.dispose(); finish(gltf); await second.ready;
  assert.equal(geometryDisposals, 1, 'late GLB must release exactly once'); second.release(); assert.equal(geometryDisposals, 1);
  assert.throws(() => pendingPool.acquire('closed'));

  const content: CompositionContent = { kind: 'composition', units: 'meters', durationSeconds: 10, loop: false, assets: { model: { assetId: 'model' } }, instances: [{ id: 'model', asset: 'model', position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1], animation: { clipIndex: 0, startSeconds: 1, loop: true } }] };
  const core = await createSceneCore({ content });
  let loads = 0, failed = 0;
  const pool = new ModelPool(async () => { loads++; return fixture(); });
  const props = { session: core, instances: content.instances, resolveUrl: () => 'fixture.glb', onClips() {}, onError() { failed++; } } as unknown as ThreeViewportProps;
  const models = new EditorModels(editor, () => props, () => false, () => {}, pool);
  for (let cycle = 0; cycle < 100; cycle++) {
    models.sync();
    for (let wait = 0; wait < 100 && !models.entries.get('model')?.root; wait++) await pause();
    const loaded = models.entries.get('model')!; assert.ok(loaded.root);
    assert.deepEqual(loaded.root.position.toArray(), [1, 2, 3]);
    core.seek(1 + loaded.clip!.duration); models.frame(); assert.equal(loaded.action?.time, 0, 'clip wraps at its own duration');
    core.seek(1.5); models.frame(); assert.equal(loaded.action?.time, 0.5);
    models.remove('model');
    assert.equal(editor.scene.children.length, 0); assert.equal(Object.keys(editor.geometries).length, 0); assert.equal(editor.materialsRefCounter.size, 0);
  }
  assert.equal(loads, 100); assert.equal(failed, 0);
  models.dispose(); core.dispose();
  console.log('PASS upstream integrity; native commands → scene history, bounds/read-only/nested-object guards; shared/late GLB release; 100 native Editor load/clip/dispose cycles with empty geometry/material registries');
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
