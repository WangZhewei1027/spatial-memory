import { AnimationMixer, Box3, Group, LoopOnce, Mesh, PerspectiveCamera, Vector3, type AnimationAction, type AnimationClip, type Material, type Object3D } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { applyTransform, clipTime, mediaPreloadIds, samplePresentation, sampleSpatialAudio } from '@spatial-memory/scene-core';
import type { Editor } from '@/vendor/three-editor';
import type { CompositionGroup, CompositionInstance } from '@/lib/scene/protocol';
import { hiddenNodeIds } from '@/lib/scene/visibility';
import { ModelPool, disposeModel } from './model-pool';
import { registerInstance } from './transform-bridge';
import type { ThreeViewportProps } from './types';
import { resourceSurface, textSurface, type SceneSurface } from './surfaces';
import { configurePreviewCamera } from './spatial-reference';
import { SpatialAudioMixer } from './spatial-audio';

type OpacityMaterial = { material: Material; opacity: number; transparent: boolean; depthWrite: boolean };
type Entry = { instance: CompositionInstance; url: string; signature: string; release(): void; stop?: () => void; root?: Group; model?: Object3D; surface?: SceneSurface; materials?: OpacityMaterial[]; clips?: AnimationClip[]; mixer?: AnimationMixer; action?: AnimationAction; clip?: AnimationClip; animationKey?: string };
/**
 * Imported models often carry an offset pivot (e.g. Sketchfab/FBX exports). Wrap the model so its
 * bounding box's bottom-center sits on the instance origin, outside what the AnimationMixer drives.
 * Same rule as the mini-program's `lib/three-runtime/pivot.js`.
 */
export function groundPivot(model: Object3D) {
  const pivot = new Group(); pivot.name = 'pivot';
  const bounds = new Box3().setFromObject(model);
  if (!bounds.isEmpty()) pivot.position.set(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
  pivot.add(model);
  return pivot;
}
type GroupEntry = { group: CompositionGroup; object: Group; stop(): void };
export class EditorModels {
  readonly entries = new Map<string, Entry>();
  readonly groups = new Map<string, GroupEntry>();
  private hidden = new Set<string>();
  private audio = new SpatialAudioMixer();
  private listenerCamera = new PerspectiveCamera();
  private listener = { position: new Vector3(), forward: new Vector3(), up: new Vector3() };
  private sourcePosition = new Vector3();
  constructor(private editor: Editor, private props: () => ThreeViewportProps, private dragging: (id: string) => boolean, private ready: () => void, private pool = new ModelPool()) {}
  /** The transform root of an instance or group. */
  object(id: string): Object3D | undefined { return this.entries.get(id)?.root ?? this.groups.get(id)?.object; }
  /** Groups are empty transform parents; members are re-parented without changing their local transform. */
  private syncGroups() {
    const groups = this.props().groups ?? [];
    for (const [id, entry] of this.groups) if (!groups.some(group => group.id === id)) {
      entry.stop(); for (const child of [...entry.object.children]) this.editor.scene.add(child);
      if (this.editor.selected === entry.object) this.editor.select(null);
      this.editor.removeObject(entry.object); this.groups.delete(id);
    }
    for (const group of groups) {
      const existing = this.groups.get(group.id);
      if (existing) { existing.group = group; continue; }
      const object = new Group(); object.name = group.id; registerInstance(object, group.id);
      const stop = this.props().session.observe(group.id, value => { if (!this.dragging(group.id)) { applyTransform(object, value); if (this.editor.selected === object) this.editor.signals.objectChanged.dispatch(object); } });
      this.groups.set(group.id, { group, object, stop });
      this.editor.addObject(object);
    }
    for (const { group, object } of this.groups.values()) this.attach(object, group.parent);
    for (const entry of this.entries.values()) if (entry.root) this.attach(entry.root, entry.instance.parent);
  }
  private attach(object: Object3D, parent: string | undefined) {
    const target = (parent && this.groups.get(parent)?.object) || this.editor.scene;
    if (object.parent === target) return;
    target.add(object); this.editor.signals.sceneGraphChanged.dispatch();
  }
  private signature(instance: CompositionInstance) {
    if (instance.text) return JSON.stringify(instance.text);
    return `${this.props().resolveResource?.(instance)?.kind ?? 'model'}:${this.props().resolveUrl(instance) ?? ''}`;
  }
  private mounted(entry: Entry, object: Object3D, materials: Material[], announce = true) {
    const root = entry.root = new Group();
    root.name = entry.instance.id; registerInstance(root, entry.instance.id); root.add(object);
    entry.materials = materials.map(material => ({ material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite }));
    if (!this.props().session.sample(entry.instance.id)) { this.remove(entry.instance.id); return; }
    entry.stop = this.props().session.observe(entry.instance.id, value => {
      if (!this.dragging(entry.instance.id)) { applyTransform(root, value); if (this.editor.selected === root) this.editor.signals.objectChanged.dispatch(root); }
    });
    this.editor.addObject(root); this.attach(root, entry.instance.parent);
    this.animation(entry); this.frame(); if (announce) this.ready();
  }
  private failed(entry: Entry, blocked = false) {
    if (this.entries.get(entry.instance.id) !== entry) return;
    const zh = this.props().language?.startsWith('zh');
    const name = entry.instance.name || this.props().resolveResource?.(entry.instance)?.name || entry.instance.id;
    this.props().onError(blocked
      ? (zh ? '浏览器阻止了媒体播放，请暂停后再次点击播放。' : 'The browser blocked media playback. Pause and press Play again.')
      : (zh ? `无法加载或播放「${name}」，请检查素材文件与浏览器支持的格式。` : `Could not load or play “${name}”. Check the source file and browser format support.`));
  }
  sync() {
    const props = this.props();
    this.hidden = hiddenNodeIds(props);
    const replaced = new Set<string>();
    this.syncGroups();
    for (const [id, entry] of this.entries) {
      const current = props.instances.find(item => item.id === id);
      if (!current || this.signature(current) !== entry.signature) {
        if (current) replaced.add(id);
        this.remove(id, !!current);
      }
    }
    for (const instance of props.instances) {
      const url = props.resolveUrl(instance);
      if (!url && !instance.text) continue;
      const existing = this.entries.get(instance.id);
      if (existing) { existing.instance = instance; if (existing.root) this.attach(existing.root, instance.parent); this.animation(existing); continue; }
      const kind = props.resolveResource?.(instance)?.kind ?? 'model';
      const entry: Entry = { instance, url: url ?? '', signature: this.signature(instance), release() {} };
      this.entries.set(instance.id, entry);
      if (instance.text || kind !== 'model') {
        try {
          const created = entry.surface = instance.text ? textSurface(instance.text) : resourceSurface(kind as Exclude<typeof kind, 'model'>, url!, blocked => this.failed(entry, blocked), this.audio);
          this.mounted(entry, created.object, created.materials, !replaced.has(instance.id));
        } catch { this.failed(entry); }
        continue;
      }
      const handle = this.pool.acquire(url!); entry.release = handle.release;
      void handle.ready.then(gltf => {
        if (this.entries.get(instance.id) !== entry) return;
        const model = entry.model = clone(gltf.scene); entry.clips = gltf.animations;
        // Fades belong to an instance. Geometries/textures stay pooled, materials do not.
        const materials = new Map<Material, Material>();
        const independent = (source: Material) => { let result = materials.get(source); if (!result) { result = source.clone(); materials.set(source, result); } return result; };
        model.traverse(node => { if (node instanceof Mesh) node.material = Array.isArray(node.material) ? node.material.map(independent) : independent(node.material); });
        this.mounted(entry, groundPivot(model), [...materials.values()]);
        this.props().onClips(instance.id, gltf.animations.map(clip => ({ name: clip.name, duration: clip.duration })));
      }).catch(() => {
        if (this.entries.get(instance.id) !== entry) return;
        entry.release(); this.failed(entry);
      });
    }
    this.frame();
  }
  private animation(entry: Entry) {
    if (!entry.model) return;
    const animation = entry.instance.animation;
    const key = JSON.stringify(animation);
    if (entry.animationKey === key) return;
    entry.mixer?.stopAllAction(); entry.mixer?.uncacheRoot(entry.model);
    entry.animationKey = key; entry.mixer = undefined; entry.action = undefined; entry.clip = undefined;
    if (!animation) return;
    const clip = animation.clipIndex !== undefined ? entry.clips?.[animation.clipIndex] : entry.clips?.find(item => item.name === animation.clipName);
    if (!clip) return;
    const mixer = entry.mixer = new AnimationMixer(entry.model);
    const action = entry.action = mixer.clipAction(clip); entry.clip = clip;
    action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
  }
  private present(entry: Entry, preview: boolean) {
    const props = this.props(), { session } = props;
    const presentation = samplePresentation(entry.instance, session.time, session.duration);
    const hidden = this.hidden.has(entry.instance.id);
    const ghost = !hidden && !preview && !session.playing && props.selectedId === entry.instance.id && (!presentation.visible || presentation.opacity === 0);
    if (entry.root) entry.root.visible = !hidden && (presentation.visible || ghost) && !(preview && entry.surface?.audioMarker);
    const opacity = hidden ? 0 : ghost ? 0.2 : presentation.opacity;
    for (const original of entry.materials ?? []) {
      const transparent = original.transparent || opacity < 1;
      if (original.material.transparent !== transparent) { original.material.transparent = transparent; original.material.needsUpdate = true; }
      original.material.opacity = original.opacity * opacity;
      original.material.depthWrite = original.depthWrite && opacity === 1;
    }
  }
  /** A second camera shares the same objects and media clock without replaying or fetching media. */
  withPreviewPresentation(render: () => void) {
    const roots: { root: Group; visible: boolean }[] = [];
    const materials: OpacityMaterial[] = [];
    for (const entry of this.entries.values()) {
      if (entry.root) roots.push({ root: entry.root, visible: entry.root.visible });
      for (const { material } of entry.materials ?? []) materials.push({ material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
    }
    try {
      for (const entry of this.entries.values()) this.present(entry, true);
      render();
    } finally {
      for (const { root, visible } of roots) root.visible = visible;
      for (const { material, opacity, transparent, depthWrite } of materials) {
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
        material.opacity = opacity; material.depthWrite = depthWrite;
      }
    }
  }
  frame() {
    const props = this.props(), { session } = props;
    const media = props.instances.filter(instance => {
      const kind = props.resolveResource?.(instance)?.kind;
      return kind === 'audio' || kind === 'video';
    });
    const prepare = new Set(mediaPreloadIds(media, session.time, session.duration, session.looping));
    // Listen from the virtual phone camera even when its inset is closed. Editor orbiting
    // is an authoring tool, not a change to the audience's listening position.
    if (media.some(instance => instance.media?.spatial?.enabled)) {
      configurePreviewCamera(this.listenerCamera, props.cameraSettings);
      this.listenerCamera.getWorldPosition(this.listener.position);
      this.listenerCamera.getWorldDirection(this.listener.forward);
      this.listener.up.set(0, 1, 0).transformDirection(this.listenerCamera.matrixWorld);
      this.editor.scene.updateMatrixWorld(true);
    }
    for (const entry of this.entries.values()) {
      this.present(entry, props.preview);
      if (entry.surface?.media) {
        entry.root?.getWorldPosition(this.sourcePosition);
        const spatial = sampleSpatialAudio(entry.instance.media?.spatial, this.sourcePosition, this.listener);
        entry.surface.media.sync(entry.instance, session.time, session.playing, session.duration, prepare.has(entry.instance.id), spatial);
      }
      if (entry.action && entry.mixer && entry.clip && entry.instance.animation) {
        entry.action.time = clipTime(session.time, entry.instance.animation, entry.clip.duration);
        entry.mixer.update(0);
      }
    }
  }
  remove(id: string, preserveSelection = false) {
    const entry = this.entries.get(id); if (!entry) return;
    this.entries.delete(id); entry.stop?.();
    if (entry.model) { entry.mixer?.stopAllAction(); entry.mixer?.uncacheRoot(entry.model); disposeModel(entry.model); entry.materials?.forEach(({ material }) => material.dispose()); }
    if (entry.root) { if (!preserveSelection && this.editor.selected === entry.root) this.editor.select(null); this.editor.removeObject(entry.root); }
    entry.surface?.dispose();
    entry.release();
    // Upstream removeObject keeps its geometry registry; rebuild it from live models.
    this.editor.geometries = {};
    this.editor.scene.traverse(node => { const geometry = (node as import('three').Mesh).geometry; if (geometry) this.editor.geometries[geometry.uuid] = geometry; });
  }
  dispose() {
    for (const id of [...this.entries.keys()]) this.remove(id);
    for (const entry of this.groups.values()) { entry.stop(); this.editor.removeObject(entry.object); }
    this.groups.clear(); this.pool.dispose();
    this.audio.dispose();
  }
}
