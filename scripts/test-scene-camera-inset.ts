import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, Vector4 } from 'three';
import { createSceneCore } from '@spatial-memory/scene-core';
import type { CompositionContent, CompositionInstance } from '../lib/scene/protocol';
import { Editor } from '../vendor/three-editor';
import { EditorModels } from '../app/manage/scenes/components/three-editor/models';
import { renderPreviewInset } from '../app/manage/scenes/components/three-editor/preview-inset';
import { DEFAULT_SCENE_CAMERA } from '../app/manage/scenes/components/three-editor/spatial-reference';
import type { ThreeViewportProps } from '../app/manage/scenes/components/three-editor/types';
import type { SceneResource } from '../app/manage/scenes/components/types';
import { performanceHosts } from './test-support/performance-hosts';

test('live inset hides editing ghosts and audio markers without changing the editable scene or playing media twice', async context => {
  const hosts = performanceHosts();
  const base = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null } satisfies Partial<CompositionInstance>;
  const content: CompositionContent = { kind: 'composition', units: 'meters', durationSeconds: 12, loop: false, assets: { audio: { assetId: 'audio' }, video: { assetId: 'video' } }, instances: [
    { ...base, id: 'audio', asset: 'audio' },
    { ...base, id: 'video', asset: 'video', timing: { startSeconds: 0, endSeconds: 12, fadeInSeconds: 2, fadeOutSeconds: 1 } },
    { ...base, id: 'future', text: { content: 'Not on stage yet', fontSize: .2, width: 2, align: 'center', color: '#333333' }, timing: { startSeconds: 5, endSeconds: 10, fadeInSeconds: 0, fadeOutSeconds: 0 } },
  ] };
  const session = createSceneCore({ content });
  const editor = new Editor({ config: { getKey: () => 'en', setKey() {} }, history: { clear() {}, execute() {} } });
  const resources: Record<string, SceneResource> = Object.fromEntries((['audio', 'video'] as const).map(kind => [kind, { assetId: kind, assetLockVersion: 1, name: kind, url: `https://fixture.example/${kind}.${kind === 'audio' ? 'mp3' : 'mp4'}`, assetState: 'active', kind }]));
  const props: ThreeViewportProps = { session, instances: content.instances,
    resolveUrl: instance => instance.asset ? resources[instance.asset]?.url : undefined,
    resolveResource: instance => instance.asset ? resources[instance.asset] : undefined,
    onClips() {}, onSelect() {}, onTransform() {}, onError(message) { assert.fail(message); },
    fitRef: { current: null }, originRef: { current: null }, previewRef: { current: null }, placementRef: { current: null }, toolsRef: { current: null }, shadingRef: { current: null },
    cameraSettings: DEFAULT_SCENE_CAMERA, selectedId: 'future', grid: true, labels: true, editable: true, preview: false, language: 'en',
  };
  const models = new EditorModels(editor, () => props, () => false, () => {});
  const state = () => [...models.entries.values()].map(entry => ({
    id: entry.instance.id, visible: entry.root?.visible, position: entry.root?.position.toArray(),
    materials: entry.materials?.map(({ material }) => ({ opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite })),
  }));
  try {
    models.sync(); session.seek(1); models.frame();
    await Promise.resolve(); await Promise.resolve();
    const audio = models.entries.get('audio')!, video = models.entries.get('video')!, future = models.entries.get('future')!;
    assert.equal(hosts.browserMedia.length, 2, 'one native element per audio/video instance');
    assert.equal(audio.root!.visible, true, 'audio marker remains available on the editing stage');
    assert.equal(future.root!.visible, true, 'selected future object remains available as an editing ghost');
    assert.equal(future.materials![0].material.opacity, .2);
    assert.equal(video.materials![0].material.opacity, .5, 'visible video is halfway through its fade');
    const originalState = state(), originalDocument = JSON.stringify(content);
    const syncSpies = [audio, video].map(entry => context.mock.method(entry.surface!.media!, 'sync'));
    const assertPreview = () => {
      assert.equal(audio.root!.visible, false, 'phone view suppresses audio markers');
      assert.equal(future.root!.visible, false, 'phone view follows the cue, not editor selection');
      assert.equal(video.root!.visible, true);
      assert.equal(video.materials![0].material.opacity, .5, 'phone view shares the current fade envelope');
    };
    models.withPreviewPresentation(assertPreview);
    assert.deepEqual(state(), originalState, 'editing presentation is restored immediately after the inset');
    assert.throws(() => models.withPreviewPresentation(() => { assertPreview(); throw new Error('render interrupted'); }), /render interrupted/);
    assert.deepEqual(state(), originalState, 'failed inset rendering also restores the editing presentation');
    assert.equal(props.selectedId, 'future'); assert.equal(session.time, 1);
    assert.equal(JSON.stringify(content), originalDocument, 'preview cannot edit the scene document');
    syncSpies.forEach(spy => assert.equal(spy.mock.callCount(), 0, 'an extra view must not drive media synchronization'));

    session.play(false); models.frame(); await Promise.resolve(); await Promise.resolve();
    const syncCalls = syncSpies.map(spy => spy.mock.callCount()), plays = hosts.browserMedia.map(media => media.plays);
    for (let frame = 0; frame < 30; frame++) models.withPreviewPresentation(assertPreview);
    assert.deepEqual(syncSpies.map(spy => spy.mock.callCount()), syncCalls, 'rendering another camera does not synchronize media a second time');
    assert.deepEqual(hosts.browserMedia.map(media => media.plays), plays, 'camera preview cannot restart or duplicate audio');
    assert.equal(hosts.browserMedia.length, 2);
    session.pause();
    const hiddenProps = props.instances.map(instance => ({ ...instance, hidden: true }));
    props.instances = hiddenProps; models.sync(); models.frame();
    assert.equal(future.root!.visible, false, 'explicitly hidden selection must never become an editing ghost');
    assert.equal(video.root!.visible, false);
    models.withPreviewPresentation(() => {
      assert.equal(video.root!.visible, false, 'camera inset respects authoring visibility');
      assert.equal(video.materials![0].material.opacity, 0);
    });
    props.instances = content.instances; models.sync(); models.frame();
    assert.equal(future.root!.visible, true, 'showing restores the original editing presentation');
    assert.equal(video.materials![0].material.opacity, .5, 'showing restores the sampled opacity without rewriting it');
  } finally {
    models.dispose(); session.dispose(); hosts.restore();
  }
});

class RendererFixture {
  autoClear = false;
  readonly viewport = new Vector4(0, 0, 800, 600);
  readonly scissor = new Vector4(5, 6, 700, 500);
  scissorTest = false;
  renderCount = 0;
  onRender: (scene: Object3D, camera: Camera) => void = () => {};
  getViewport(target: Vector4) { return target.copy(this.viewport); }
  getScissor(target: Vector4) { return target.copy(this.scissor); }
  getScissorTest() { return this.scissorTest; }
  setViewport(x: number | Vector4, y?: number, width?: number, height?: number) { if (x instanceof Vector4) this.viewport.copy(x); else this.viewport.set(x, y!, width!, height!); }
  setScissor(x: number | Vector4, y?: number, width?: number, height?: number) { if (x instanceof Vector4) this.scissor.copy(x); else this.scissor.set(x, y!, width!, height!); }
  setScissorTest(value: boolean) { this.scissorTest = value; }
  render(scene: Object3D, camera: Camera) { this.renderCount++; this.onRender(scene, camera); }
}

test('inset scissor uses canvas-local CSS coordinates and leaves the editing renderer unchanged', () => {
  const renderer = new RendererFixture(), scene = new Scene(), camera = new PerspectiveCamera();
  const override = new MeshBasicMaterial({ wireframe: true }); scene.overrideMaterial = override;
  const canvas = { left: 100, top: 50, width: 800, height: 600 };
  let presentations = 0;
  const withPresentation = (render: () => void) => { presentations++; render(); };
  const originalViewport = renderer.viewport.clone(), originalScissor = renderer.scissor.clone();
  renderer.onRender = (renderedScene, renderedCamera) => {
    assert.equal(renderedScene, scene); assert.equal(renderedCamera, camera);
    assert.equal(camera.aspect, 9 / 16, 'inset uses its own portrait projection, not the full editing viewport');
    assert.deepEqual(renderer.viewport.toArray(), [680, 410, 90, 160]);
    assert.deepEqual(renderer.scissor.toArray(), [680, 410, 90, 160]);
    assert.equal(renderer.scissorTest, true, 'preview clears and paints only inside its frame');
    assert.equal(scene.overrideMaterial, null, 'phone view uses normal materials even when editing in wireframe');
  };
  assert.equal(renderPreviewInset(renderer, scene, camera, canvas, { left: 780, top: 80, width: 90, height: 160 }, withPresentation), true);
  assert.equal(renderer.renderCount, 1); assert.equal(presentations, 1);
  assert.deepEqual(renderer.viewport, originalViewport); assert.deepEqual(renderer.scissor, originalScissor);
  assert.equal(renderer.scissorTest, false); assert.equal(renderer.autoClear, false); assert.equal(scene.overrideMaterial, override);

  renderer.onRender = () => {
    assert.equal(camera.aspect, 9 / 16, 'clipping preserves the camera framing');
    assert.deepEqual(renderer.viewport.toArray(), [-20, 470, 90, 160], 'partial clipping does not stretch the full camera frame');
    assert.deepEqual(renderer.scissor.toArray(), [0, 470, 70, 130], 'scissor clips the inset to the stage boundaries');
    throw new Error('GPU interrupted');
  };
  assert.throws(() => renderPreviewInset(renderer, scene, camera, canvas, { left: 80, top: 20, width: 90, height: 160 }, withPresentation), /GPU interrupted/);
  assert.deepEqual(renderer.viewport, originalViewport); assert.deepEqual(renderer.scissor, originalScissor);
  assert.equal(renderer.scissorTest, false); assert.equal(renderer.autoClear, false); assert.equal(scene.overrideMaterial, override);
  const draws = renderer.renderCount;
  assert.equal(renderPreviewInset(renderer, scene, camera, canvas, { left: 1200, top: 20, width: 90, height: 160 }, withPresentation), false);
  assert.equal(renderPreviewInset(renderer, scene, camera, canvas, { left: 100, top: 50, width: 0, height: 0 }, withPresentation), false);
  assert.equal(renderer.renderCount, draws, 'closed or offscreen inset does not render');
  override.dispose();
});
