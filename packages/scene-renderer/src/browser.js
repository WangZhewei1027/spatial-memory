import { AmbientLight, Box3, Color, DirectionalLight, Frustum, Matrix4, Mesh, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createSceneCore, mediaTime, samplePresentation } from '@spatial-memory/scene-core';
import { Editor } from '../../../vendor/three-editor/Editor.js';
import { EditorModels } from '../../../app/manage/scenes/components/three-editor/models';
import { ModelPool } from '../../../app/manage/scenes/components/three-editor/model-pool';

let active;
const vector = a => new Vector3(...a);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const timeoutError = (message, details) => Object.assign(new Error(message), { details });

async function waitFor(test, state, label) {
  const deadline = performance.now() + state.timeout;
  while (!test()) {
    if (state.errors.length) throw timeoutError(state.errors.join('; '), state.errors);
    if (performance.now() > deadline) throw timeoutError(`Timed out waiting for ${label}`, state.pending());
    await nextFrame();
  }
  if (state.errors.length) throw new Error(state.errors.join('; '));
}

function textureReady(texture) {
  if (!texture || texture.isVideoTexture) return true;
  const source = texture.image;
  if (Array.isArray(source)) return source.every(item => item && (item.width || item.data));
  return !!source && (source.data || (source.width > 0 && source.height > 0 && source.complete !== false));
}

function entryReady(entry) {
  if (!entry.root) return false;
  let ready = true;
  entry.root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) if (value?.isTexture && !textureReady(value)) ready = false;
    }
  });
  return ready;
}

async function load(input) {
  active?.dispose();
  const { document: doc, resources, options = {} } = input;
  if (!doc?.content || !Array.isArray(doc.content.instances)) throw new Error('Expected a scene document');
  await document.fonts.ready;
  const core = await createSceneCore({ content: doc.content });
  const editor = new Editor({ config: { getKey: () => 'en', setKey() {} }, history: { execute() {}, clear() {} } });
  const renderer = new WebGLRenderer({ canvas: document.querySelector('#scene'), antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(options.width ?? 720, options.height ?? 960, false);
  editor.scene.background = new Color(options.background ?? '#edf0f4');
  const light = new DirectionalLight(0xffffff, 2); light.position.set(5, 8, 5);
  editor.scene.add(new AmbientLight(0xffffff, 1.2), light);
  const errors = [];
  const draco = new DRACOLoader(); draco.setDecoderPath('/draco/');
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const clips = {};
  const props = {
    session: core, instances: doc.content.instances, groups: doc.content.groups,
    resolveUrl: instance => instance.asset ? resources[instance.asset]?.url : null,
    resolveResource: instance => instance.asset ? resources[instance.asset] : undefined,
    onClips: (id, value) => { clips[id] = value; }, onError: message => errors.push(message),
    onSelect() {}, onTransform() {}, selectedId: null, preview: true, language: 'en',
    cameraSettings: { distance: 2, height: 1.4, yaw: 0, pitch: 0, fov: 60 },
  };
  const models = new EditorModels(editor, () => props, () => false, () => {}, new ModelPool(url => loader.loadAsync(url)));
  const state = { core, editor, renderer, models, doc, resources, clips, errors, timeout: options.timeoutMs ?? 60000,
    pending: () => [...models.entries].filter(([, entry]) => !entryReady(entry)).map(([id]) => id),
    dispose() { models.dispose(); core.dispose(); draco.dispose(); renderer.dispose(); renderer.forceContextLoss(); } };
  active = state;
  for (const instance of doc.content.instances) if (!instance.text && !resources[instance.asset]?.url) throw new Error(`Missing resource for ${instance.id}`);
  models.sync();
  await waitFor(() => models.entries.size === doc.content.instances.length && [...models.entries.values()].every(entryReady), state, 'models and textures');
  for (const [id, entry] of models.entries) {
    const selected = entry.instance.animation;
    if (!selected) continue;
    const matches = selected.clipIndex !== undefined ? [entry.clips?.[selected.clipIndex]].filter(Boolean) : (entry.clips ?? []).filter(clip => clip.name === selected.clipName);
    if (matches.length !== 1 || !(matches[0].duration > 0)) throw new Error(`Animation clip is missing, ambiguous or empty for ${id}`);
  }
  return { loaded: models.entries.size };
}

async function seek(time) {
  const state = active, { core, models } = state;
  core.pause(); core.seek(time); models.frame();
  await waitFor(() => {
    models.frame();
    for (const entry of models.entries.values()) {
      const element = entry.surface?.media?.element;
      if (!element?.getAttribute('src')) continue;
      if (element.error) throw new Error(`Media decoding failed for ${entry.instance.id}: ${element.error.message}`);
      if (element.readyState < 2 || element.seeking) return false;
      const presentation = samplePresentation(entry.instance, core.time, core.duration);
      const target = mediaTime(presentation.visible ? core.time : 0, entry.instance.media, entry.instance.timing, Number.isFinite(element.duration) ? element.duration : undefined);
      if (!Number.isFinite(target)) throw new Error(`Invalid sampled media time for ${entry.instance.id}`);
      const bounded = Math.min(target, Math.max(0, element.duration - .001));
      if (Math.abs(element.currentTime - bounded) > .12) return false;
    }
    return true;
  }, state, 'media metadata and target frame');
  models.frame(); state.editor.scene.updateMatrixWorld(true);
  return state;
}

function corners(box) {
  const result = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) result.push(new Vector3(x, y, z));
  return result;
}

function makeCamera(spec, bounds, width, height) {
  const presets = ['audience', 'map', 'qr', 'front', 'top', 'side'];
  if (typeof spec === 'string' && !presets.includes(spec)) throw new Error(`Unknown camera preset: ${spec}`);
  if (typeof spec !== 'string' && (!spec || typeof spec !== 'object' || Array.isArray(spec))) throw new Error('Camera must be a preset or settings object');
  const settings = typeof spec === 'string' ? { name: spec } : spec;
  const allowed = ['name', 'position', 'target', 'up', 'fov', 'near', 'far', 'fit'];
  for (const key of Object.keys(settings)) if (!allowed.includes(key)) throw new Error(`Unknown camera field: ${key}`);
  if (settings.name !== undefined && (typeof settings.name !== 'string' || !settings.name)) throw new Error('Camera name must be a nonempty string');
  if (settings.fit !== undefined && typeof settings.fit !== 'boolean') throw new Error('Camera fit must be a boolean');
  for (const key of ['position', 'target', 'up']) if (settings[key] !== undefined && (!Array.isArray(settings[key]) || settings[key].length !== 3 || !settings[key].every(Number.isFinite))) throw new Error(`Camera ${key} must be a finite XYZ triple`);
  for (const key of ['fov', 'near', 'far']) if (settings[key] !== undefined && !Number.isFinite(settings[key])) throw new Error(`Camera ${key} must be finite`);
  const name = settings.name ?? 'custom';
  const center = bounds.isEmpty() ? new Vector3(0, 1, 0) : bounds.getCenter(new Vector3());
  const size = bounds.isEmpty() ? new Vector3(2, 2, 2) : bounds.getSize(new Vector3());
  const fov = settings.fov ?? 60, aspect = width / height;
  if (!(fov > 0 && fov < 180)) throw new Error('Camera fov must be between 0 and 180 degrees');
  if (settings.near !== undefined && settings.near <= 0) throw new Error('Camera near must be positive');
  if (settings.far !== undefined && settings.far <= (settings.near ?? 0)) throw new Error('Camera far must be greater than near');
  if (![...center.toArray(), ...size.toArray()].every(Number.isFinite)) throw new Error('Scene bounds cannot be represented by a finite camera');
  const distance = Math.max(size.x, size.y, size.z, 1);
  let position, target = center.clone(), up = new Vector3(0, 1, 0);
  if (name === 'top') { position = center.clone().add(new Vector3(0, distance, 0)); up.set(0, 0, -1); }
  else if (name === 'side') position = center.clone().add(new Vector3(distance, 0, 0));
  else if (name === 'audience' || name === 'map') { position = new Vector3(0, 1.4, 2); target = new Vector3(0, 1.4, 0); }
  else if (name === 'qr') { position = new Vector3(0, 0, 2); target = new Vector3(0, 0, 0); }
  else position = center.clone().add(new Vector3(0, 0, distance));
  if (settings.position) position = vector(settings.position);
  if (settings.target) target = vector(settings.target);
  if (settings.up) up = vector(settings.up);
  const forward = target.clone().sub(position);
  if (!forward.lengthSq()) throw new Error('Camera position and target must differ');
  if (!up.lengthSq() || new Vector3().crossVectors(forward, up).lengthSq() <= Number.EPSILON * forward.lengthSq() * up.lengthSq()) throw new Error('Camera up must be nonzero and not parallel to its viewing direction');
  forward.normalize(); up.normalize();
  const fit = settings.fit ?? (!['audience', 'map', 'qr'].includes(name) && !settings.position && !settings.target);
  if (fit) {
    const right = new Vector3().crossVectors(forward, up).normalize(), vertical = new Vector3().crossVectors(right, forward);
    const tanV = Math.tan(fov * Math.PI / 360), tanH = tanV * aspect;
    const fitBounds = bounds.isEmpty() ? new Box3().setFromCenterAndSize(center, size) : bounds;
    let required = settings.near ?? .01;
    // Perspective depth matters: each corner has its own distance to the camera.
    for (const corner of corners(fitBounds)) {
      const offset = corner.sub(center), depth = offset.dot(forward);
      required = Math.max(required, Math.abs(offset.dot(right)) * 1.1 / tanH - depth, Math.abs(offset.dot(vertical)) * 1.1 / tanV - depth, (settings.near ?? .01) * 1.1 - depth);
    }
    position = center.clone().addScaledVector(forward, -required); target = center.clone();
  }
  const far = settings.far ?? Math.max(100, position.distanceTo(center) + size.length() * 2);
  const near = settings.near ?? Math.min(.01, position.distanceTo(target) / 10000);
  if (![...position.toArray(), ...target.toArray(), near, far].every(Number.isFinite) || near <= 0 || far <= near) throw new Error('Camera requires finite position and 0 < near < far');
  if (fit && !bounds.isEmpty() && corners(bounds).some(corner => corner.sub(position).dot(forward) > far)) throw new Error('Camera far plane cannot contain the fitted scene bounds');
  const camera = new PerspectiveCamera(fov, aspect, near, far);
  camera.position.copy(position); camera.up.copy(up); camera.lookAt(target); camera.updateMatrixWorld(true);
  if (![...camera.projectionMatrix.elements, ...camera.matrixWorldInverse.elements].every(Number.isFinite)) throw new Error('Camera projection is not finite');
  return { camera, settings: { name, position: position.toArray(), target: target.toArray(), up: up.toArray(), fov, near: camera.near, far, aspect } };
}

function projectBounds(box, camera, width, height) {
  if (box.isEmpty()) return { projection: null, projectionStatus: 'empty' };
  const points = corners(box).map(point => point.applyMatrix4(camera.matrixWorldInverse));
  const inside = point => point.z <= -camera.near && point.z >= -camera.far;
  const clipped = points.filter(inside).map(point => point.clone());
  // Clip the AABB edges to near/far before perspective division. A corner on or
  // behind the camera plane has no meaningful finite screen-space coordinate.
  for (let index = 0; index < points.length; index++) for (const bit of [1, 2, 4]) {
    if (index & bit) continue;
    const from = points[index], to = points[index | bit];
    for (const plane of [-camera.near, -camera.far]) if ((from.z < plane && to.z > plane) || (from.z > plane && to.z < plane)) {
      const point = from.clone().lerp(to, (plane - from.z) / (to.z - from.z));
      point.z = plane; clipped.push(point);
    }
  }
  if (!clipped.length) return { projection: null, projectionStatus: 'outside-depth-range' };
  const projected = clipped.map(point => point.applyMatrix4(camera.projectionMatrix));
  if (projected.some(point => !point.toArray().every(Number.isFinite))) return { projection: null, projectionStatus: 'non-finite' };
  const projection = { min: [Math.min(...projected.map(point => (point.x + 1) * width / 2)), Math.min(...projected.map(point => (1 - point.y) * height / 2))], max: [Math.max(...projected.map(point => (point.x + 1) * width / 2)), Math.max(...projected.map(point => (1 - point.y) * height / 2))] };
  if (![...projection.min, ...projection.max].every(Number.isFinite)) return { projection: null, projectionStatus: 'non-finite' };
  return { projection, projectionStatus: points.every(inside) ? 'projected' : 'depth-clipped' };
}

async function frame({ time, camera: view, overlays = false }) {
  const { core, models, renderer, editor, clips } = await seek(time);
  const bounds = new Box3();
  const isVisible = entry => entry.root.visible && !entry.surface?.audioMarker && samplePresentation(entry.instance, core.time, core.duration).opacity > 0;
  for (const entry of models.entries.values()) if (isVisible(entry)) bounds.union(new Box3().setFromObject(entry.root, true));
  const width = renderer.domElement.width, height = renderer.domElement.height;
  const { camera, settings } = makeCamera(view, bounds, width, height);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const overlay = document.querySelector('#overlay'); overlay.width = width; overlay.height = height;
  const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, width, height);
  const nodes = {};
  for (const [id, entry] of models.entries) {
    const audioMarker = !!entry.surface?.audioMarker;
    const box = audioMarker ? new Box3() : new Box3().setFromObject(entry.root, true);
    const projection = audioMarker ? { projection: null, projectionStatus: 'audio-marker' } : projectBounds(box, camera, width, height);
    const projected = projection.projection;
    const media = entry.surface?.media?.element;
    const prepared = !!media?.getAttribute('src');
    const presentation = samplePresentation(entry.instance, core.time, core.duration);
    let triangles = 0, source;
    entry.root.traverse(node => { if (node.isMesh && !audioMarker) {
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3;
      if (active.resources[entry.instance.asset]?.kind === 'image') {
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        const image = material?.map?.image;
        if (image) source = { width: image.naturalWidth ?? image.width, height: image.naturalHeight ?? image.height };
      }
    } });
    const visible = isVisible(entry);
    nodes[id] = { worldMatrix: entry.root.matrixWorld.toArray(), visible, presentation, audioMarker,
      bounds: box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new Vector3()).toArray(), center: box.getCenter(new Vector3()).toArray() },
      ...projection, inFrustum: !box.isEmpty() && frustum.intersectsBox(box), triangles, source, animations: clips[id] ?? [],
      ...(media ? { media: { prepared, durationSeconds: Number.isFinite(media.duration) ? media.duration : null, requestedSourceTime: prepared ? mediaTime(presentation.visible ? core.time : 0, entry.instance.media, entry.instance.timing, Number.isFinite(media.duration) ? media.duration : undefined) : null, actualSourceTime: prepared ? media.currentTime : null, width: media.videoWidth ?? null, height: media.videoHeight ?? null } } : {}) };
    if (overlays && projected && visible) {
      ctx.strokeStyle = nodes[id].inFrustum ? '#087a39' : '#c45a00'; ctx.lineWidth = 2;
      ctx.strokeRect(projected.min[0], projected.min[1], projected.max[0] - projected.min[0], projected.max[1] - projected.min[1]);
      ctx.font = '18px sans-serif'; ctx.fillStyle = '#111'; ctx.fillText(id, Math.max(4, projected.min[0]), Math.max(22, projected.min[1] - 4));
    }
  }
  models.withPreviewPresentation(() => renderer.render(editor.scene, camera));
  renderer.getContext().finish();
  return { requestedTime: time, time: core.time, camera: settings, nodes, renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }, warnings: ['Bounds are world AABBs; box overlap does not prove collision or occlusion.'] };
}

window.sceneRenderer = { load, frame, dispose: () => { active?.dispose(); active = undefined; } };
