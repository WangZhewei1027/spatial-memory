import { AxesHelper, BufferGeometry, CanvasTexture, GridHelper, Group, LineBasicMaterial, LineSegments, MathUtils, Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Sprite, SpriteMaterial, Vector3, type Material, type Texture } from 'three';
import { DEFAULT_SCENE_VIEWER_POSITION } from '@spatial-memory/scene-core';

/** Position is saved with the scene; pitch and lens are preview-only. */
export interface SceneCameraSettings { distance: number; height: number; yaw: number; pitch: number; fov: number }
export const DEFAULT_SCENE_CAMERA: Readonly<SceneCameraSettings> = sceneCameraSettings();
export const SCENE_CAMERA_ASPECT = 9 / 16;

export function sceneCameraSettings(position: readonly [number, number, number] = DEFAULT_SCENE_VIEWER_POSITION, lens = { pitch: 0, fov: 60 }): SceneCameraSettings {
  return { distance: Math.hypot(position[0], position[2]), height: position[1], yaw: MathUtils.radToDeg(Math.atan2(position[0], position[2])), ...lens };
}
export function sceneViewerPosition(settings: SceneCameraSettings): [number, number, number] {
  const yaw = MathUtils.degToRad(settings.yaw);
  return [Math.sin(yaw) * settings.distance, settings.height, Math.cos(yaw) * settings.distance];
}

/** Mini-program placement is horizontal: eye height must not tilt the camera at the origin. */
export function configurePreviewCamera(camera: PerspectiveCamera, settings: SceneCameraSettings, aspect = SCENE_CAMERA_ASPECT) {
  const yaw = MathUtils.degToRad(settings.yaw);
  camera.position.fromArray(sceneViewerPosition(settings));
  // YXZ first turns around the vertical axis, then pitches locally. Positive pitch looks up.
  camera.rotation.set(MathUtils.degToRad(settings.pitch), yaw, 0, 'YXZ');
  camera.fov = settings.fov; camera.aspect = aspect > 0 && Number.isFinite(aspect) ? aspect : SCENE_CAMERA_ASPECT;
  camera.near = .01; camera.far = Math.max(100, camera.position.length() * 2);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}

function label(value: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 72;
  const context = canvas.getContext('2d')!;
  context.font = '500 48px sans-serif';
  canvas.width = Math.ceil(context.measureText(value).width) + 32;
  context.fillStyle = 'rgba(255,255,255,.94)'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#333333'; context.font = '500 48px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(value, canvas.width / 2, canvas.height / 2);
  const material = new SpriteMaterial({ map: new CanvasTexture(canvas), sizeAttenuation: false, depthTest: false, depthWrite: false });
  const sprite = new Sprite(material); sprite.scale.set(.04 * canvas.width / canvas.height, .04, 1); sprite.renderOrder = 10;
  return sprite;
}

function replaceLabel(sprite: Sprite, value: string) {
  const texture = sprite.material.map!;
  const canvas = texture.image as HTMLCanvasElement;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255,255,255,.94)'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#333333'; context.fillText(value, canvas.width / 2, canvas.height / 2);
  texture.needsUpdate = true;
}

/** Spatial rulers are helpers, never assets or scene nodes. All owned GPU resources are released. */
export function createSpatialReference() {
  const root = new Group(); root.name = 'scene-spatial-reference';
  // Equal lines remove the upstream 5 m heavy squares that can read as the unit grid.
  const grid = new GridHelper(30, 30, 0x777777, 0x777777); grid.name = 'meter-grid';
  const origin = new Group(); origin.name = 'scene-origin';
  const axes = new AxesHelper(1); axes.renderOrder = 5;
  for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) material.depthTest = false;
  const marker = new Mesh(new RingGeometry(.065, .10, 40), new MeshBasicMaterial({ color: 0x333333, depthTest: false, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = .01; marker.renderOrder = 6;
  const originLabel = label('Origin (0, 0, 0)'); originLabel.position.set(-.35, .16, -.35); originLabel.center.set(1, 0);
  origin.add(axes, marker, originLabel);
  for (const [name, point] of [['X  1 m', [1.25, .08, 0]], ['Y  1 m', [0, 1.22, 0]], ['Z  1 m', [0, .08, 1.25]]] as const) {
    const axisLabel = label(name); axisLabel.position.fromArray(point); origin.add(axisLabel);
  }
  const camera = new Group(); camera.name = 'virtual-camera';
  const wire = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x555555, transparent: true, opacity: .8 }));
  const cameraLabel = label('Virtual camera'); cameraLabel.position.set(0, .3, .18);
  // Offset the caption in screen space so it does not cover the nearby +Z metre marker.
  cameraLabel.center.set(.5, 2);
  camera.add(wire, cameraLabel); root.add(grid, origin, camera);
  root.traverse(object => { object.raycast = () => {}; });
  const referenceCamera = new PerspectiveCamera();
  let lastSettings = '', lastLanguage = '', disposed = false;
  const update = (settings: SceneCameraSettings, language: string) => {
    const signature = JSON.stringify(settings);
    if (signature !== lastSettings) {
      lastSettings = signature;
      configurePreviewCamera(referenceCamera, settings);
      camera.position.copy(referenceCamera.position); camera.quaternion.copy(referenceCamera.quaternion);
      const length = Math.max(.25, Math.min(settings.distance, 5));
      const halfHeight = Math.tan(MathUtils.degToRad(settings.fov / 2)) * length;
      const halfWidth = halfHeight * SCENE_CAMERA_ASPECT;
      const corners = [new Vector3(-halfWidth, -halfHeight, -length), new Vector3(halfWidth, -halfHeight, -length), new Vector3(halfWidth, halfHeight, -length), new Vector3(-halfWidth, halfHeight, -length)];
      const points: Vector3[] = [];
      for (let i = 0; i < 4; i++) points.push(new Vector3(), corners[i], corners[i], corners[(i + 1) % 4]);
      const bodyFront = [new Vector3(-.12, -.08, 0), new Vector3(.12, -.08, 0), new Vector3(.12, .08, 0), new Vector3(-.12, .08, 0)];
      for (let i = 0; i < 4; i++) {
        const front = bodyFront[i], next = bodyFront[(i + 1) % 4], back = front.clone().setZ(.2), nextBack = next.clone().setZ(.2);
        points.push(front, next, back, nextBack, front, back);
      }
      wire.geometry.dispose(); wire.geometry = new BufferGeometry().setFromPoints(points);
    }
    const languageKey = language.startsWith('zh') ? 'zh' : 'en';
    if (languageKey !== lastLanguage) {
      lastLanguage = languageKey;
      replaceLabel(originLabel, languageKey === 'zh' ? '原点 (0, 0, 0)' : 'Origin (0, 0, 0)');
      replaceLabel(cameraLabel, languageKey === 'zh' ? '虚拟相机' : 'Virtual camera');
    }
  };
  const resizeLabels = (viewportHeight: number, verticalFov: number) => {
    // Sprite size is independent of distance. Convert 20 CSS pixels to camera-plane units.
    const height = 40 * Math.tan(MathUtils.degToRad(verticalFov / 2)) / Math.max(1, viewportHeight);
    root.traverse(object => {
      if (!(object instanceof Sprite) || !object.material.map) return;
      const canvas = object.material.map.image as HTMLCanvasElement;
      object.scale.set(height * canvas.width / canvas.height, height, 1);
    });
  };
  const setLabelsVisible = (visible: boolean) => {
    root.traverse(object => { if (object instanceof Sprite) object.visible = visible; });
  };
  return { root, grid, origin, camera, update, resizeLabels, setLabelsVisible, dispose() {
    if (disposed) return; disposed = true;
    const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
    root.traverse(object => {
      // Sprite geometry is shared internally by Three; only its per-label material/texture are ours.
      if (object instanceof Mesh || object instanceof LineSegments) geometries.add(object.geometry);
      if (object instanceof Mesh || object instanceof LineSegments || object instanceof Sprite) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    for (const material of materials) { if (material instanceof SpriteMaterial && material.map) textures.add(material.map); material.dispose(); }
    geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose());
    root.removeFromParent(); root.clear();
  } };
}
