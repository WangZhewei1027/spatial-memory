import { AmbientLight, DirectionalLight, PerspectiveCamera, WebGLRenderer, type Object3D } from 'three';
import { applyTransform } from '@spatial-memory/scene-core';
import { groundPlacement } from '@/lib/scene/editor-interactions';
import { Editor, Viewport, Toolbar, type NativeCommand } from '@/vendor/three-editor';
import { EditorModels } from './models';
import { applyEditorCommand, instanceRoot, instanceId } from './transform-bridge';
import type { ThreeViewportProps } from './types';
import { configurePreviewCamera, createSpatialReference } from './spatial-reference';
import { renderPreviewInset } from './preview-inset';

export function mountThreeEditor(host: HTMLDivElement, initial: ThreeViewportProps) {
  let props = initial, closed = false, draggingId: string | null = null;
  const config = new Map<string, unknown>([['language', props.language.startsWith('zh') ? 'zh' : 'en'], ['viewport/theme', 'light']]);
  const editor = new Editor({ config: { getKey: key => config.get(key), setKey: (...args) => { for (let i = 0; i < args.length; i += 2) config.set(String(args[i]), args[i + 1]); } }, history: { clear() {}, execute(command: NativeCommand) {
    applyEditorCommand(props.onTransform, command, props.editable);
  } } });
  // Nested GLB meshes are asset internals: selection and transforms belong to the instance root.
  const nativeSelect = editor.selector.select.bind(editor.selector);
  editor.selector.select = object => nativeSelect(instanceRoot(object));
  const viewport = Viewport(editor);
  const spatial = createSpatialReference(); editor.sceneHelpers.add(spatial.root);
  const previewCamera = new PerspectiveCamera();
  host.append(viewport.dom);
  const toolbar = Toolbar(editor);
  viewport.cameraControls.dom.removeAttribute('style');
  viewport.cameraControls.dom.classList.add('scene-three-camera-controls');
  // Only the editor camera is selectable; the phone camera has its own inset controls.
  viewport.cameraControls.dom.querySelector('[aria-label="Viewport camera"]')?.remove();
  props.toolsRef.current?.append(toolbar.dom);
  props.shadingRef.current?.append(viewport.cameraControls.dom);
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.domElement.tabIndex = 0;
  const focusViewport = () => renderer.domElement.focus({ preventScroll: true });
  toolbar.dom.addEventListener('click', focusViewport);
  const models = new EditorModels(editor, () => ({ ...props, preview: false }), id => id === draggingId, () => { select(); fit(); });
  const sun = new DirectionalLight(0xffffff, 2); sun.position.set(5, 8, 5);
  editor.scene.add(new AmbientLight(0xffffff, 1.2), sun);
  editor.camera.position.set(5, 4, 7); editor.camera.lookAt(0, 0, 0); editor.camera.near = 0.01; editor.camera.far = 2000;
  viewport.beforeRender = () => models.frame();
  // Reuse the native render loop, scene and media instances; only the camera draw is repeated.
  editor.signals.sceneRendered.add(() => {
    const frame = props.previewRef.current;
    if (closed || !props.preview || !frame) return;
    renderPreviewInset(renderer, editor.scene, previewCamera, renderer.domElement.getBoundingClientRect(), frame.getBoundingClientRect(), render => models.withPreviewPresentation(render));
  });
  // Start media synchronously from the user's Play action, retaining browser user activation.
  const unsubscribePlayback = props.session.subscribe(() => models.frame());
  editor.signals.rendererCreated.dispatch(renderer);
  editor.signals.objectSelected.add((object: unknown) => { if (!closed) props.onSelect(instanceId(object as Object3D | null)); });
  function select() {
    const root = props.selectedId ? models.object(props.selectedId) : null;
    if (props.selectedId && !root) return;
    editor.select(root ?? null);
  }
  function fit() { if (models.entries.size) editor.focus(editor.scene); }
  function focusOrigin() {
    editor.controls.center.set(0, 0, 0); editor.camera.position.set(5, 4, 7); editor.camera.lookAt(0, 0, 0);
    if (editor.viewportCamera !== editor.camera) { editor.viewportCamera = editor.camera; editor.signals.viewportCameraChanged.dispatch(); }
    editor.camera.updateMatrixWorld(true); editor.signals.cameraChanged.dispatch(editor.camera);
  }
  const begin = () => {
    if (!props.editable) return;
    props.session.pause(); draggingId = instanceId(viewport.transformControls.object);
  };
  const end = () => {
    const root = draggingId && models.object(draggingId);
    const value = draggingId && props.session.sample(draggingId);
    draggingId = null;
    if (root && value) applyTransform(root, value);
  };
  viewport.transformControls.addEventListener('mouseDown', begin);
  viewport.transformControls.addEventListener('mouseUp', end);
  const resized = () => {
    spatial.resizeLabels(host.clientHeight, editor.camera.fov);
    viewport.setViewHelperLocation(Math.max(0, Math.min(270, host.clientWidth / 2 - 64)), 46); editor.signals.windowResize.dispatch();
  };
  const resize = new ResizeObserver(resized); resize.observe(host); resized();
  props.fitRef.current = fit;
  props.originRef.current = focusOrigin;
  props.placementRef.current = (x, y) => groundPlacement(editor.camera, renderer.domElement.getBoundingClientRect(), x, y);
  const shortcuts = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.composedPath().some(node => node instanceof ShadowRoot || node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || (node instanceof HTMLElement && node.isContentEditable))) return;
    const mode = ({ w: 'translate', e: 'rotate', r: 'scale' } as Record<string, string>)[event.key.toLowerCase()];
    if (mode && props.editable) editor.signals.transformModeChanged.dispatch(mode);
    if (event.key.toLowerCase() === 'f') editor.focus(editor.selected ?? editor.scene);
  };
  window.addEventListener('keydown', shortcuts);
  function update(next: ThreeViewportProps) {
    props = next; models.sync(); select();
    if (!props.editable && draggingId) end();
    viewport.setEditable(props.editable); viewport.setHelpers(true);
    toolbar.dom.hidden = !props.editable; viewport.cameraControls.dom.hidden = false;
    spatial.grid.visible = props.grid;
    spatial.setLabelsVisible(props.labels);
    spatial.update(props.cameraSettings, props.language);
    configurePreviewCamera(previewCamera, props.cameraSettings);
    // The upstream heavy grid spans 5 m; the adapter's uniformly spaced grid is exactly 1 m.
    editor.signals.showHelpersChanged.dispatch({ gridHelper: false, cameraHelpers: false, lightHelpers: false, skeletonHelpers: false });
  }
  update(initial);
  return { update, dispose() {
    if (closed) return; closed = true; end(); resize.disconnect();
    viewport.transformControls.removeEventListener('mouseDown', begin); viewport.transformControls.removeEventListener('mouseUp', end);
    window.removeEventListener('keydown', shortcuts);
    props.fitRef.current = null; props.originRef.current = null; props.placementRef.current = null;
    unsubscribePlayback(); viewport.beforeRender = null; models.dispose(); toolbar.dom.removeEventListener('click', focusViewport); toolbar.dom.remove(); viewport.cameraControls.dom.remove(); viewport.dispose();
    spatial.dispose(); Object.values(editor.signals).forEach(signal => signal.removeAll());
    editor.scene.clear(); editor.sceneHelpers.clear();
  } };
}
