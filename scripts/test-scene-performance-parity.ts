import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Box3, type Material, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createSceneCore } from '@spatial-memory/scene-core';
import type { CompositionContent, CompositionInstance } from '../lib/scene/protocol';
import { compileSceneManifest } from '../lib/scene/compile';
import { hiddenNodeIds } from '../lib/scene/visibility';
import { Editor } from '../vendor/three-editor';
import { EditorModels } from '../app/manage/scenes/components/three-editor/models';
import { ModelPool } from '../app/manage/scenes/components/three-editor/model-pool';
import type { ThreeViewportProps } from '../app/manage/scenes/components/three-editor/types';
import { DEFAULT_SCENE_CAMERA } from '../app/manage/scenes/components/three-editor/spatial-reference';
import type { SceneResource } from '../app/manage/scenes/components/types';
import { performanceHosts, settleMedia } from './test-support/performance-hosts';
import { unboundedScene } from './test-support/unbounded-scene';
import { validateSceneDocument } from '../lib/scene/validate';

const require = createRequire(import.meta.url), miniRoot = resolve('../spatial-memory-mini-program/miniprogram');
const { createFixtureGLB } = require(`${miniRoot}/labs/xr-three/runtime`);
const { THREE } = require(`${miniRoot}/lib/three-runtime/runtime`);
const { ModelCache } = require(`${miniRoot}/lib/three-runtime/resources`);
const { createCompositionPlayer } = require(`${miniRoot}/lib/scene-runtime/composition`);
const { validateManifest } = require(`${miniRoot}/lib/scene-runtime/manifest`);
const large = unboundedScene();
const largeResources = Object.fromEntries(Object.entries(large.content.assets).map(([alias, ref]) => [alias, { ...ref, kind: alias === 'asset_0' ? 'audio' as const : 'model' as const, url: `https://fixture.example/${alias}` }]));
assert.equal(validateSceneDocument(large).ok, true);
const largeManifest = compileSceneManifest('large', large, largeResources);
assert.equal(validateManifest(largeManifest).list.length, 25, 'mini accepts the same large document as Web');
for (const corrupt of [
  (doc: typeof large) => { doc.content.groups![0].parent = 'group_2'; },
  (doc: typeof large) => { doc.content.instances[0].scale[0] = 0; },
  (doc: typeof large) => { Object.assign(doc.content.instances[0].media!, { playbackRate: 0 }); },
  (doc: typeof large) => { doc.content.instances[0].tracks!['position.x']![0].time = -1; },
]) {
  const invalid = structuredClone(large); corrupt(invalid);
  assert.equal(validateSceneDocument(invalid).ok, false);
  assert.throws(() => validateManifest({ ...largeManifest, content: invalid.content }));
}


const resources: Record<string, SceneResource> = Object.fromEntries(['model', 'image', 'video', 'audio', 'muted', 'looped', 'trimmed'].map((alias, index) => [alias, {
  assetId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`, assetLockVersion: 1, assetState: 'active', name: alias,
  kind: ['muted', 'looped', 'trimmed'].includes(alias) ? 'audio' : alias as SceneResource['kind'], url: `https://fixture.example/${alias}.${alias === 'model' ? 'glb' : alias === 'video' ? 'mp4' : alias === 'image' ? 'png' : 'wav'}`,
}]));
function definition(loop: boolean): CompositionContent {
  const keys = (a: number, b: number) => [
    { time: 0, value: a, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3] as [number, number, number, number], connectedRight: true },
    { time: 8, value: b, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3] as [number, number, number, number], connectedRight: true },
  ];
  const spatial = { enabled: true, refDistance: 1, maxDistance: 30, rolloffFactor: 1 };
  const base = (id: string): CompositionInstance => ({ id, asset: id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null });
  const timing = (startSeconds: number, endSeconds: number, fadeInSeconds = 0, fadeOutSeconds = 0) => ({ startSeconds, endSeconds, fadeInSeconds, fadeOutSeconds });
  const media = (trimStartSeconds: number, trimEndSeconds: number, volume: number, loop: boolean, muted = false) => ({ trimStartSeconds, trimEndSeconds, playbackRate: 1 as const, volume, loop, muted });
  const text: CompositionInstance = { ...base('text'), asset: undefined, parent: 'stage', position: [0, 2, 0],
    text: { content: '光影之间\nA story unfolds', fontSize: .25, width: 2, color: '#224466', backgroundColor: '#ffffff', align: 'left' }, timing: timing(1, 9, 1, 2) };
  return { kind: 'composition', units: 'meters', durationSeconds: 12, loop,
    assets: Object.fromEntries(Object.entries(resources).map(([alias, resource]) => [alias, { assetId: resource.assetId }])),
    groups: [{ id: 'stage', name: 'Stage', position: [1, 0, -1], rotation: [0, .3, 0], scale: [1, 1.2, 1], tracks: { 'position.x': [{ time: 0, value: 1, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3], connectedRight: true }, { time: 12, value: 3, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3], connectedRight: true }] } }],
    instances: [text,
      { ...base('image'), parent: 'stage', position: [-2, 0, 0], timing: timing(0, 10, 0, 2), tracks: { opacity: keys(.8, .2) } },
      { ...base('video'), parent: 'stage', position: [2, 0, 0], timing: timing(2, 11, 1, 1), media: { ...media(3, 7, .7, true), spatial }, tracks: { opacity: keys(.9, 0), volume: keys(.2, .8) } },
      { ...base('audio'), parent: 'stage', position: [-1, .5, -2], timing: timing(1, 9, 2, 2), media: { ...media(2, 4, .8, false), spatial }, tracks: { volume: keys(.9, .1) } },
      { ...base('muted'), timing: timing(0, 12), media: media(.5, 3, .6, true, true) },
      { ...base('looped'), timing: timing(1, 10, .5, 1), media: media(1, 9, .4, true) },
      { ...base('trimmed'), timing: timing(0, 12, 2, 2), media: media(2, 6, .3, false) },
      { ...base('model'), position: [0, 0, -2], timing: timing(2, 8, 2, 2), animation: { clipIndex: 0, startSeconds: 1, loop: true }, opacity: .75 },
      { ...base('modelReference'), asset: 'model', position: [0, 0, 2] },
    ],
  };
}

let comparisons = 0, samples = 0, maximumExactError = 0, maximumMediaDrift = 0;
function near(a: number, b: number, label: string, tolerance = 1e-7) {
  const error = Math.abs(a - b); comparisons++;
  if (tolerance <= 1e-6) maximumExactError = Math.max(maximumExactError, error);
  else maximumMediaDrift = Math.max(maximumMediaDrift, error);
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && error <= tolerance, `${label}: ${a} != ${b}`);
}
function materials(object: Object3D) {
  const result: Material[] = [];
  object.traverse(node => { const material = (node as Mesh).material; if (material) for (const item of Array.isArray(material) ? material : [material]) if (!result.includes(item)) result.push(item); });
  return result;
}

async function main() {
  for (const { loop, hidden } of [{ loop: false, hidden: false }, { loop: true, hidden: false }, { loop: false, hidden: true }]) {
    const hosts = performanceHosts();
    const content = definition(loop), bytes = createFixtureGLB();
    if (hidden) { content.groups![0].hidden = true; content.instances.find(instance => instance.id === 'model')!.hidden = true; }
    const hiddenIds = hiddenNodeIds(content);
    const webGLB = await new GLTFLoader().parseAsync(bytes.slice(0), '');
    const miniGLB = await new Promise((resolve, reject) => new THREE.GLTFLoader().parse(bytes.slice(0), '', resolve, reject));
    const cache = new ModelCache(hosts.canvas, 8, async () => miniGLB);
    const manifest = compileSceneManifest('parity', { schemaVersion: 6, content }, Object.fromEntries(Object.entries(resources).map(([alias, resource]) => [alias, { assetId: resource.assetId, url: resource.url!, kind: resource.kind }])));
    const listenerCamera = new THREE.PerspectiveCamera(); listenerCamera.position.set(0, 0, 2);
    const player = createCompositionPlayer(manifest, { modelCache: cache, canvas: hosts.canvas, getListenerCamera: () => listenerCamera });
    const session = createSceneCore({ content });
    const editor = new Editor({ config: { getKey: () => 'en', setKey() {} }, history: { clear() {}, execute() {} } });
    const errors: string[] = [];
    const props: ThreeViewportProps = { session, instances: content.instances, groups: content.groups, resolveUrl: instance => instance.asset ? resources[instance.asset]?.url : undefined,
      resolveResource: instance => instance.asset ? resources[instance.asset] : undefined, onClips() {}, onSelect() {}, onTransform() {}, onError(message) { errors.push(message); },
      fitRef: { current: null }, originRef: { current: null }, previewRef: { current: null }, placementRef: { current: null }, toolsRef: { current: null }, shadingRef: { current: null }, cameraSettings: DEFAULT_SCENE_CAMERA, selectedId: null, grid: false, labels: false, editable: false, preview: true, language: 'en' };
    let readyCount = 0, ready!: () => void; const loaded = new Promise<void>(resolve => { ready = resolve; });
    const models = new EditorModels(editor, () => props, () => false, () => { if (++readyCount === content.instances.length) ready(); }, new ModelPool(async () => webGLB));
    try {
      models.sync(); await Promise.all([loaded, player.load()]); await settleMedia();
      assert.equal(player.state, 'ready', JSON.stringify(player.diagnostics));
      assert.deepEqual(errors, []);
      assert.equal(player.instances.length, content.instances.length);
      assert.equal(hosts.browserCanvases.length, 1); assert.equal(hosts.miniCanvases.length, 1);
      assert.deepEqual(hosts.miniCanvases[0].draws, hosts.browserCanvases[0].draws, 'same canvas metrics must produce identical text layout, alignment and colors');
      const nativeText = player.instances.find((entry: { id: string }) => entry.id === 'text').surface.materials[0].map.image;
      assert.equal(hosts.browserCanvases[0].width, nativeText.width);
      assert.equal(hosts.browserCanvases[0].height, nativeText.height);
      const compare = async (label: string) => {
        models.frame(); await settleMedia();
        // Native decoding settles asynchronously; a paused evaluation must still upload its requested frame.
        player.update(0); await settleMedia();
        near(player.time, session.time, `${label} clock`); samples++;
        for (const instance of content.instances) {
          const web = models.entries.get(instance.id)!;
          const mini = player.instances.find((entry: { id: string }) => entry.id === instance.id);
          web.root!.updateWorldMatrix(true, true); mini.instanceRoot.updateWorldMatrix(true, true);
          web.root!.matrixWorld.elements.forEach((value, index) => near(value, mini.instanceRoot.matrixWorld.elements[index], `${label} ${instance.id} world[${index}]`));
          const kind = instance.text ? 'text' : resources[instance.asset!].kind;
          if (kind !== 'audio') {
            if (hiddenIds.has(instance.id)) {
              assert.equal(web.root!.visible, false, `${label} ${instance.id} hidden in editor`);
              materials(mini.instanceRoot).forEach(material => assert.equal(material.opacity, 0, `${label} ${instance.id} hidden in released mini player`));
            } else assert.equal(mini.instanceRoot.visible, web.root!.visible, `${label} ${instance.id} visibility`);
            const webMaterials = materials(web.root!), miniMaterials = materials(mini.instanceRoot);
            assert.equal(miniMaterials.length, webMaterials.length, `${instance.id} material count`);
            webMaterials.forEach((material, index) => near(material.opacity, miniMaterials[index].opacity, `${label} ${instance.id} opacity`));
            const webBounds = new Box3().setFromObject(web.root!), miniBounds = new Box3().setFromObject(mini.instanceRoot);
            for (const corner of ['min', 'max'] as const) for (const axis of ['x', 'y', 'z'] as const) near(webBounds[corner][axis], miniBounds[corner][axis], `${label} ${instance.id} bounds ${corner}.${axis}`, 1e-6);
          }
        }
        for (const media of hosts.browserMedia) {
          const file = media.lastSource.split('/').at(-1)!;
          if (!file || !media.src) continue;
          const instanceId = file.split('.')[0];
          const surface = player.instances.find((entry: { id: string }) => entry.id === instanceId).surface;
          const driftTolerance = session.playing ? .15 : .015;
          if (surface.audio) near(surface.audio.sourceTime, media.currentTime, `${label} ${file} requested audio time`, driftTolerance);
          if (surface.video) {
            near(surface.video.sourceTime, media.currentTime, `${label} ${file} requested video time`, driftTolerance);
            const decoder = hosts.decoders.findLast(decoder => !decoder.removed && !decoder.abortVideo && decoder.source.endsWith(file))!;
            near(decoder.currentTime, media.currentTime, `${label} ${file} decoded frame time`, 1 / 30);
            assert.ok(surface.materials[0].map?.image.data.length > 0, 'decoded video pixels uploaded to the real native material');
          }
          const nativeAudio = hosts.innerAudio.findLast(audio => !audio.destroyed && audio.source.endsWith(file));
          if (nativeAudio) {
            assert.equal(nativeAudio.paused, media.paused, `${label} ${file} native streaming playback`);
            near(nativeAudio.currentTime, media.currentTime, `${label} ${file} streamed audio time`, .2);
            near(nativeAudio.playbackRate, 1, `${label} ${file} native default rate`);
            near(media.playbackRate, 1, `${label} ${file} browser default rate`);
            near(nativeAudio.volume, media.muted ? 0 : media.volume, `${label} ${file} streamed audio fade`);
            continue;
          }
          const soundtrack = hosts.mediaAudio.findLast(audio => !audio.destroyed && audio.decoder?.source.endsWith(file));
          if (soundtrack) {
            assert.equal(soundtrack.started, !media.paused, `${label} ${file} video soundtrack playback`);
            near(soundtrack.decoder!.currentTime, media.currentTime, `${label} ${file} physical video soundtrack time`, .2);
            near(soundtrack.volume, media.paused || media.muted ? 0 : media.volume, `${label} ${file} video soundtrack volume`);
            continue;
          }
          const nativeSources = hosts.audioContexts.flatMap(context => context.sources).filter(source => source.buffer?.source.endsWith(file));
          const active = nativeSources.filter(source => source.started && !source.stopped);
          assert.equal(active.length > 0, !media.paused, `${label} ${file} source playback`);
          if (active.length) {
            const source = active.at(-1)!;
            near(source.position, media.currentTime, `${label} ${file} physical audio position`, .15);
            near(source.playbackRate.value, 1, `${label} ${file} effective playback rate`);
            near(source.gain!.gain.value, media.muted ? 0 : media.volume, `${label} ${file} faded/muted gain`);
          }
        }
        assert.deepEqual(errors, [], `${label} Web renderer errors`);
        assert.notEqual(player.state, 'error', `${label} ${JSON.stringify(player.diagnostics)}`);
      };
      // Exact boundary seeks exercise entry-inclusive and exit-exclusive envelopes, trims and source loops.
      for (const time of [0, .5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 8, 8.5, 9, 10, 10.5, 11, 12, 8.5, 3, 0]) {
        session.pause(); session.seek(time); player.pause(); player.seek(time);
        await compare(`paused seek ${time}`);
        assert.ok(hosts.browserMedia.every(media => media.paused), 'seeking must not start browser audio');
        assert.ok(hosts.audioContexts.every(context => context.sources.every(source => !source.started || source.stopped)), 'seeking must not start native audio');
      }
      session.seek(3); player.seek(3);
      for (const [distance, yaw, height, pitch] of [[1, 45, 0, 0], [8, -90, 1.4, 15], [3, 180, 2, -20], [2, 0, 0, 0]]) {
        const radians = yaw * Math.PI / 180;
        props.cameraSettings = { ...DEFAULT_SCENE_CAMERA, distance, yaw, height, pitch };
        listenerCamera.position.set(Math.sin(radians) * distance, height, Math.cos(radians) * distance);
        listenerCamera.rotation.set(pitch * Math.PI / 180, radians, 0, 'YXZ');
        await compare(`listener distance ${distance}, yaw ${yaw}, pitch ${pitch}`);
      }
      session.seek(0); session.play(loop); player.restart(); await compare('restart');
      for (const dt of [.5, .5, .5, .5, .5, .5, 1, 1, 2, 1, .5, .5, 1, .5, .5, 1, 4]) {
        hosts.tick(dt); session.advance(dt); models.frame(); player.update(dt); await compare(`advance ${dt}`);
      }
      assert.equal(player.state, loop ? 'playing' : 'ended', 'scene transport follows end versus loop behavior');
      session.seek(3); player.seek(3); session.play(loop); player.play(); await compare('resume after seek');
      // Explicit transport changes must seek even below the old .3s drift heuristic.
      session.seek(3.25); session.play(loop); player.seek(3.25); await compare('small seek during playback');
      hosts.tick(.25); session.advance(.25); player.update(.25); await compare('advance after playing seek');
      near(player.time, 3.5, 'playing seek preserves clock advancement');
      session.pause(); player.pause(); const paused = session.time;
      hosts.tick(2); session.advance(2); player.update(2); await compare('paused hold'); near(player.time, paused, 'pause clock');
      assert.ok(hosts.browserMedia.every(media => media.paused));
      assert.ok(hosts.audioContexts.every(context => context.sources.every(source => !source.started || source.stopped)));
      session.play(loop); player.play(); await compare('resume');
      // A late asynchronous native failure must silence/release the entire performance.
      hosts.decoders.findLast(decoder => !decoder.removed && !decoder.abortVideo)!.failNextSeek = true; player.seek(4); await settleMedia();
      assert.equal(player.state, 'error', 'decoder failure transitions the real player to error');
      assert.match(player.diagnostics.message, /Injected decoder seek failure/);
      assert.equal(player.root.children.length, 0, 'runtime error detaches every instance');
      assert.ok(hosts.decoders.every(decoder => decoder.removed));
      assert.ok(hosts.audioContexts.every(context => context.closed && context.sources.every(source => source.stopped)), 'runtime error silences every track');
      models.dispose(); session.dispose(); player.dispose(); cache.dispose(); await settleMedia();
      assert.equal(editor.scene.children.length, 0); assert.equal(player.root.children.length, 0);
      assert.ok(hosts.browserMedia.every(media => media.released && media.paused), 'Web media stopped and detached');
      assert.ok(hosts.decoders.every(decoder => decoder.removed && !decoder.started), 'native decoders removed');
      assert.ok(hosts.audioContexts.every(context => context.closed && context.sources.every(source => source.stopped)), 'native audio contexts and scheduled sources released');
      assert.ok(hosts.innerAudio.every(audio => audio.destroyed && audio.paused), 'native streaming audio released');
      assert.ok(hosts.mediaAudio.every(audio => audio.destroyed && !audio.started), 'native video soundtrack players released');
      assert.equal(hosts.files.size, 0, 'native temporary downloads released');
    } finally { models.dispose(); session.dispose(); player.dispose(); cache.dispose(); hosts.restore(); }
  }
  console.log(JSON.stringify({ result: 'PASS', samples, comparisons, maximumExactError, maximumMediaDrift, coverage: 'actual Web EditorModels vs mini CompositionPlayer; schema8 images/video/audio/scene text, text layout, group transforms and planar bounds, keyed opacity/volume, camera-relative spatial distance gain, GLB fade isolation, persisted instance/group visibility without silencing video, visibility/fades, source trims/natural 1x speed/loop/volume/mute, decoded video frame targets, forward/reverse/playing seeks/play/pause/resume/restart/end, asynchronous decoder errors and disposal' }));
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
