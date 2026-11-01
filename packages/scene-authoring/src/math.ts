import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { sampleInstance } from '@spatial-memory/scene-core';
import type { SceneDocument } from './protocol';
import { fail, nodes } from './common';
import type { SceneNode, Transform, Vec3 } from './types';

const tuple = (value: { x: number; y: number; z: number }): Vec3 => [value.x, value.y, value.z];
export function localAt(node: SceneNode, time: number): Transform {
  const value = sampleInstance(node, time);
  return { position: tuple(value.position), rotation: tuple(value.rotation), scale: tuple(value.scale) };
}
export const matrixOf = (value: Transform): Matrix4 => new Matrix4().compose(new Vector3(...value.position), new Quaternion().setFromEuler(new Euler(...value.rotation, 'XYZ')), new Vector3(...value.scale));
/** A world matrix may contain shear; never silently replace it by a different TRS. */
export function decompose(matrix: Matrix4): Transform | undefined {
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  if (![...position.toArray(), ...quaternion.toArray(), ...scale.toArray()].every(Number.isFinite) || [scale.x, scale.y, scale.z].some(value => value <= 0)) return undefined;
  const rebuilt = new Matrix4().compose(position, quaternion, scale);
  if (matrix.elements.some((value, index) => Math.abs(value - rebuilt.elements[index]) > 1e-8 * Math.max(1, Math.abs(value)))) return undefined;
  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ');
  return { position: tuple(position), rotation: tuple(rotation), scale: tuple(scale) };
}
export function worldMatrices(document: SceneDocument, time: number): Map<string, Matrix4> {
  const all = new Map(nodes(document).map(node => [node.id, node])), result = new Map<string, Matrix4>();
  for (const node of all.values()) {
    if (result.has(node.id)) continue;
    const chain: SceneNode[] = [], visited = new Set<string>();
    let current: SceneNode | undefined = node;
    while (current && !result.has(current.id)) {
      if (visited.has(current.id)) fail('HIERARCHY_CYCLE', 'parent', 'A group cannot contain a cycle', current.id);
      visited.add(current.id); chain.push(current);
      if (current.parent && !all.has(current.parent)) fail('PARENT_NOT_FOUND', 'parent', 'Parent group does not exist', current.id);
      current = current.parent ? all.get(current.parent) : undefined;
    }
    for (let index = chain.length - 1; index >= 0; index--) {
      const item = chain[index], matrix = matrixOf(localAt(item, time));
      if (item.parent) matrix.premultiply(result.get(item.parent)!);
      if (!matrix.elements.every(Number.isFinite)) fail('NUMERIC_OVERFLOW', 'transform', 'The sampled world matrix is not finite', item.id);
      result.set(item.id, matrix);
    }
  }
  return result;
}
