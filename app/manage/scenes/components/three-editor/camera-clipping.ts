import { Box3, Vector3, type Object3D, type PerspectiveCamera } from 'three';

/** Include the current world bounds, including animated groups and model geometry. */
export function sceneFarPlane(camera: PerspectiveCamera, content: Object3D, minimum = 100): number {
  const bounds = new Box3().setFromObject(content);
  if (bounds.isEmpty()) return minimum;
  const center = bounds.getCenter(new Vector3()), radius = bounds.getSize(new Vector3()).length() / 2;
  const far = camera.position.distanceTo(center) + radius * 1.05;
  return Number.isFinite(far) ? Math.max(minimum, far, camera.near * 2) : Math.max(minimum, camera.far);
}

export function updateCameraClipping(camera: PerspectiveCamera, content: Object3D): void {
  const far = sceneFarPlane(camera, content);
  if (far === camera.far) return;
  camera.far = far;
  camera.updateProjectionMatrix();
}
