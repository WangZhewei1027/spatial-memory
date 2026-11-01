import type { NativeCommand } from '@/vendor/three-editor';
import type { Object3D } from 'three';
import type { ThreeViewportProps } from './types';

const roots = new WeakMap<Object3D, string>();
export const registerInstance = (root: Object3D, id: string) => roots.set(root, id);
export const instanceId = (root: Object3D | null | undefined) => root ? roots.get(root) ?? null : null;

export function instanceRoot(object: Object3D | null): Object3D | null {
  for (let node = object; node; node = node.parent) if (roots.has(node)) return node;
  return null;
}
export const commandChannel = (type: string) => ({ SetPositionCommand: 'position', SetRotationCommand: 'rotation', SetScaleCommand: 'scale' } as const)[type as 'SetPositionCommand'];
export function transformValue(object: Object3D, key: 'position' | 'rotation' | 'scale') {
  const valid = (n: number) => Number.isFinite(n) && (key !== 'scale' || n > 0) ? n : (key === 'scale' ? 1 : 0);
  return { x: valid(object[key].x), y: valid(object[key].y), z: valid(object[key].z) };
}
/** Commit one transform per completed native drag into the scene's undo history. */
export function applyEditorCommand(onTransform: ThreeViewportProps['onTransform'], command: NativeCommand, editable: boolean) {
  const key = commandChannel(command.type), root = instanceRoot(command.object);
  if (!editable || !key || !root || root !== command.object) return false;
  const value = command.type === 'SetPositionCommand' ? command.newPosition : command.type === 'SetRotationCommand' ? command.newRotation : command.newScale;
  if (!value) return false;
  root[key].set(value.x, value.y, value.z);
  onTransform(instanceId(root)!, key, transformValue(root, key));
  return true;
}
