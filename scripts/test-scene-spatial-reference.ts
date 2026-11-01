import assert from 'node:assert/strict';
import test from 'node:test';
import { AxesHelper, BufferGeometry, LineSegments, Material, Mesh, PerspectiveCamera, Raycaster, Sprite, Texture, Vector2, Vector3 } from 'three';
import { configurePreviewCamera, createSpatialReference, DEFAULT_SCENE_CAMERA, MAP_SCENE_CAMERA } from '../app/manage/scenes/components/three-editor/spatial-reference';
import { CanvasFixture } from './test-support/performance-hosts';

const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`);
const vectorNear = (actual: Vector3, expected: number[], label: string) => actual.toArray().forEach((value, index) => near(value, expected[index], `${label}[${index}]`));

test('QR and map cameras match horizontal mini-program placement without scaling the scene', () => {
  const camera = new PerspectiveCamera();
  configurePreviewCamera(camera, DEFAULT_SCENE_CAMERA, 9 / 16);
  vectorNear(camera.position, [0, 0, 2], 'QR camera');
  vectorNear(camera.getWorldDirection(new Vector3()), [0, 0, -1], 'QR direction');
  const origin = new Vector3().project(camera);
  near(origin.x, 0, 'QR origin centered horizontally'); near(origin.y, 0, 'QR origin centered vertically');
  near(camera.aspect, 9 / 16, 'portrait aspect');
  near(camera.fov, 60, 'default vertical field of view');

  // A one-metre segment two metres away occupies sqrt(3)/4 of a 60° viewport.
  const floor = new Vector3(0, 0, 0).project(camera), top = new Vector3(0, 1, 0).project(camera);
  near((top.y - floor.y) / 2, Math.sqrt(3) / 4, 'projected one-metre height');
  configurePreviewCamera(camera, { ...DEFAULT_SCENE_CAMERA, distance: 4 }, 9 / 16);
  near(new Vector3(0, 1, 0).project(camera).y / 2, Math.sqrt(3) / 8, 'doubling distance halves apparent height');

  configurePreviewCamera(camera, MAP_SCENE_CAMERA, 9 / 16);
  vectorNear(camera.position, [0, 1.4, 2], 'map camera');
  vectorNear(camera.getWorldDirection(new Vector3()), [0, 0, -1], 'map remains horizontal');
  near(new Vector3(0, 1.4, 0).project(camera).y, 0, 'camera-height content at center');
  assert.ok(new Vector3().project(camera).y < -1, 'ground origin can be below the portrait frame; do not silently tilt to fit it');
});

test('camera controls orbit in metres, preserve height and independently adjust pitch and lens', () => {
  const camera = new PerspectiveCamera();
  const original = { ...DEFAULT_SCENE_CAMERA, distance: 3, height: 1.25, yaw: 90, pitch: 0, fov: 75 };
  const settings = Object.freeze({ ...original });
  configurePreviewCamera(camera, settings, 9 / 16);
  near(Math.hypot(camera.position.x, camera.position.z), 3, 'horizontal orbit radius');
  near(camera.position.y, 1.25, 'camera height');
  near(new Vector3(0, 1.25, 0).project(camera).x, 0, 'orbit still faces scene center horizontally');
  near(new Vector3(0, 1.25, 0).project(camera).y, 0, 'orbit retains horizontal eye line');
  near(camera.fov, 75, 'lens adjustment');
  near(camera.aspect, 9 / 16, 'portrait aspect survives adjustment');
  const originalPosition = camera.position.clone();
  configurePreviewCamera(camera, { ...settings, pitch: 30 }, 16 / 9);
  near(camera.position.distanceTo(originalPosition), 0, 'pitch does not move camera');
  near(camera.getWorldDirection(new Vector3()).y, 0.5, 'positive pitch looks upward');
  near(camera.aspect, 16 / 9, 'projection updates on viewport resize');
  assert.deepEqual(settings, original, 'camera settings are input only');
});

test('spatial helpers have one-metre grid cells and axes, cannot be picked, and release their resources', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag: string) { assert.equal(tag, 'canvas'); return new CanvasFixture(); },
  } });
  const reference = createSpatialReference();
  try {
    reference.update(DEFAULT_SCENE_CAMERA, 'zh');
    reference.root.updateMatrixWorld(true);
    const vertices = reference.grid.geometry.getAttribute('position');
    const xLines = new Set<number>(), zLines = new Set<number>();
    for (let index = 0; index < vertices.count; index += 2) {
      const start = new Vector3().fromBufferAttribute(vertices, index).applyMatrix4(reference.grid.matrixWorld);
      const end = new Vector3().fromBufferAttribute(vertices, index + 1).applyMatrix4(reference.grid.matrixWorld);
      near(start.y, 0, 'grid plane'); near(end.y, 0, 'grid plane');
      if (start.x === end.x) xLines.add(start.x);
      if (start.z === end.z) zLines.add(start.z);
    }
    for (const positions of [xLines, zLines]) {
      const sorted = [...positions].sort((left, right) => left - right);
      assert.ok(sorted.length > 2, 'grid supplies multiple measurable cells');
      for (let index = 1; index < sorted.length; index++) near(sorted[index] - sorted[index - 1], 1, 'adjacent grid lines are one metre apart');
    }
    const axes = reference.origin.children.find(node => node instanceof AxesHelper);
    assert.ok(axes instanceof AxesHelper, 'origin exposes the three spatial axes');
    const axisVertices = axes.geometry.getAttribute('position');
    for (let index = 0; index < axisVertices.count; index += 2) {
      const start = new Vector3().fromBufferAttribute(axisVertices, index).applyMatrix4(axes.matrixWorld);
      const end = new Vector3().fromBufferAttribute(axisVertices, index + 1).applyMatrix4(axes.matrixWorld);
      vectorNear(start, [0, 0, 0], 'axis starts at scene origin');
      near(start.distanceTo(end), 1, 'axis is one metre long');
    }
    const camera = new PerspectiveCamera();
    configurePreviewCamera(camera, DEFAULT_SCENE_CAMERA, 9 / 16);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    assert.deepEqual(raycaster.intersectObject(reference.root, true), [], 'helpers do not intercept scene selection');
    reference.update(MAP_SCENE_CAMERA, 'en');
    vectorNear(reference.camera.position, [0, 1.4, 2], 'helper follows virtual camera');

    const labels: Sprite[] = [];
    reference.root.traverse(node => { if (node instanceof Sprite) labels.push(node); });
    assert.equal(labels.length, 5, 'origin, camera and three axis labels share one switch');
    const labelMaps = labels.map(node => node.material.map);
    reference.setLabelsVisible(false);
    reference.update(DEFAULT_SCENE_CAMERA, 'zh'); reference.resizeLabels(600, 60);
    assert.ok(labels.every(node => !node.visible), 'camera, language and viewport updates keep labels hidden');
    assert.ok(reference.grid.visible && reference.origin.visible && reference.camera.visible && axes.visible, 'the label switch preserves grid and spatial guides');
    reference.grid.visible = false; reference.setLabelsVisible(true);
    assert.ok(labels.every(node => node.visible), 'all labels return together');
    assert.equal(reference.grid.visible, false, 'label and grid visibility remain independent');
    assert.deepEqual(labels.map(node => node.material.map), labelMaps, 'toggling reuses the same GPU resources');

    const resources = new Set<BufferGeometry | Material | Texture>();
    reference.root.traverse(node => {
      if (node instanceof Mesh || node instanceof LineSegments) resources.add(node.geometry);
      if (node instanceof Mesh || node instanceof LineSegments || node instanceof Sprite) {
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          resources.add(material);
          for (const value of Object.values(material)) if (value instanceof Texture) resources.add(value);
        }
      }
    });
    const disposed = new Set<BufferGeometry | Material | Texture>();
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.add(resource));
    reference.dispose();
    assert.deepEqual(disposed, resources, 'all owned helper geometries, materials and label textures are released');
  } finally {
    reference.dispose();
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
