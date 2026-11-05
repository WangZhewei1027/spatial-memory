import { Plane, Raycaster, Vector2, Vector3, type Camera } from "three";

export const MODEL_DRAG_TYPE = "application/x-scene-model-asset";
/** Drag data is unreadable before drop; the kind travels in the type list so targets can validate on hover. */
const ASSET_KIND_DRAG_PREFIX = "application/x-scene-asset-kind.";
export const assetKindDragType = (kind: string) => `${ASSET_KIND_DRAG_PREFIX}${kind}`;
export function draggedAssetKind(types: readonly string[]) {
  return types.find((type) => type.startsWith(ASSET_KIND_DRAG_PREFIX))?.slice(ASSET_KIND_DRAG_PREFIX.length) ?? null;
}
export type ScenePosition = [number, number, number];
export type PlacementReader = (x: number, y: number) => ScenePosition | null;

/** Project a viewport pointer onto the scene ground, without accepting sky/non-finite drops. */
export function groundPlacement(camera: Camera, rect: { left: number; top: number; width: number; height: number }, x: number, y: number): ScenePosition | null {
  if (!rect.width || !rect.height) return null;
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera);
  const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
  if (!hit || ![hit.x, hit.z].every((value) => Number.isFinite(value))) return null;
  return [Math.round(hit.x * 1000) / 1000, 0, Math.round(hit.z * 1000) / 1000];
}
