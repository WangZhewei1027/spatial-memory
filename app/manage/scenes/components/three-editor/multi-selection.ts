import { Box3, Box3Helper, Euler, Group, Matrix4, type Object3D } from 'three';
import { decompose } from '@/packages/scene-authoring/src/math';
import { instanceId, transformValue } from './transform-bridge';

export interface SelectionTransform {
  id: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number };
}

/** A temporary world-space pivot; selected objects retain their document hierarchy. */
export class MultiSelection {
  readonly pivot = new Group();
  private objects: Object3D[] = [];
  private boxes: Box3Helper[] = [];
  private snapshots: { object: Object3D; world: Matrix4; rotation: Euler }[] = [];
  private inverse = new Matrix4();
  dragging = false;
  invalid = false;
  constructor(private helpers: Object3D) { this.pivot.name = 'selection-pivot'; helpers.add(this.pivot); }
  get multiple() { return this.objects.length > 1; }
  contains(id: string) { return this.dragging && this.snapshots.some(({ object }) => instanceId(object) === id); }
  set(objects: Object3D[]) {
    if (this.dragging) return;
    this.objects = objects;
    while (this.boxes.length > objects.length) this.release(this.boxes.pop()!);
    while (this.boxes.length < objects.length) {
      const box = new Box3Helper(new Box3());
      for (const material of Array.isArray(box.material) ? box.material : [box.material]) { material.depthTest = false; material.transparent = true; }
      this.boxes.push(box); this.helpers.add(box);
    }
    this.update();
  }
  update() {
    const bounds = new Box3();
    this.objects.forEach((object, index) => {
      const box = this.boxes[index]; box.box.setFromObject(object);
      box.visible = this.multiple && !box.box.isEmpty(); bounds.union(box.box);
    });
    if (!this.dragging) {
      this.pivot.position.set(0, 0, 0); this.pivot.rotation.set(0, 0, 0); this.pivot.scale.set(1, 1, 1);
      if (!bounds.isEmpty()) bounds.getCenter(this.pivot.position);
      this.pivot.updateMatrixWorld(true);
    }
  }
  begin() {
    this.update(); this.dragging = true; this.invalid = false;
    this.inverse.copy(this.pivot.matrixWorld).invert();
    const selected = new Set(this.objects);
    this.snapshots = this.objects.filter(object => {
      for (let parent = object.parent; parent; parent = parent.parent) if (selected.has(parent)) return false;
      return true;
    }).map(object => { object.updateWorldMatrix(true, false); return { object, world: object.matrixWorld.clone(), rotation: object.rotation.clone() }; });
  }
  move() {
    if (!this.dragging) return;
    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(this.inverse);
    const changes = this.snapshots.map(({ object, world, rotation }) => {
      object.parent?.updateWorldMatrix(true, false);
      const local = object.parent ? object.parent.matrixWorld.clone().invert() : new Matrix4();
      return { object, rotation, value: decompose(local.multiply(delta).multiply(world)) };
    });
    this.invalid = changes.some(change => !change.value);
    if (this.invalid) return;
    for (const { object, rotation, value } of changes) {
      object.position.fromArray(value!.position); object.rotation.set(...value!.rotation); object.scale.fromArray(value!.scale);
      // Preserve authored full turns when decomposing the temporary world-space delta.
      for (const axis of ['x', 'y', 'z'] as const) object.rotation[axis] += Math.round((rotation[axis] - object.rotation[axis]) / (2 * Math.PI)) * 2 * Math.PI;
      object.updateMatrixWorld(true);
    }
    this.update();
  }
  values(): SelectionTransform[] {
    this.move();
    if (this.invalid) return [];
    return this.snapshots.map(({ object }) => ({ id: instanceId(object)!, position: transformValue(object, 'position'), rotation: transformValue(object, 'rotation'), scale: transformValue(object, 'scale') }));
  }
  end() { this.dragging = false; this.snapshots = []; this.update(); }
  private release(box: Box3Helper) { box.removeFromParent(); box.geometry.dispose(); for (const material of Array.isArray(box.material) ? box.material : [box.material]) material.dispose(); }
  dispose() { this.boxes.forEach(box => this.release(box)); this.boxes = []; this.pivot.removeFromParent(); }
}
