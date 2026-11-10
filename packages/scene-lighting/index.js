import { AmbientLight, DirectionalLight, Group, NoToneMapping, PMREMGenerator, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DEFAULT_SCENE_LIGHTING } from './config.js';
export { DEFAULT_SCENE_LIGHTING, lightingIssues } from './config.js';

/** One owned environment texture per renderer; never replace a model's own materials. */
export function createSceneLighting(renderer, scene) {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false;
  const root = new Group(); root.name = 'scene-lighting';
  const ambient = new AmbientLight(), sun = new DirectionalLight();
  root.add(ambient, sun, sun.target); scene.add(root);
  const quaternion = new Quaternion(), environmentQuaternion = new Quaternion(), up = new Vector3(0, 1, 0), direction = new Vector3(), origin = new Vector3();
  let environment, disposed = false;
  function apply(settings = DEFAULT_SCENE_LIGHTING, placement) {
    if (disposed) return;
    ambient.color.set(settings.ambientColor); ambient.intensity = settings.ambientIntensity;
    sun.color.set(settings.directionalColor); sun.intensity = settings.directionalIntensity;
    const azimuth = settings.azimuth * Math.PI / 180, elevation = settings.elevation * Math.PI / 180;
    direction.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
    quaternion.identity(); origin.set(0, 0, 0);
    if (placement) { placement.getWorldQuaternion(quaternion); placement.getWorldPosition(origin); }
    sun.position.copy(direction.applyQuaternion(quaternion).multiplyScalar(10).add(origin));
    sun.target.position.copy(origin);
    if (settings.environment === 'studio' && !environment) {
      const generator = new PMREMGenerator(renderer), room = new RoomEnvironment();
      try { environment = generator.fromScene(room, 0.04); }
      finally { room.dispose(); generator.dispose(); }
    }
    scene.environment = settings.environment === 'studio' ? environment.texture : null;
    scene.environmentIntensity = settings.environmentIntensity;
    environmentQuaternion.setFromAxisAngle(up, settings.environmentRotation * Math.PI / 180).premultiply(quaternion).invert();
    scene.environmentRotation.setFromQuaternion(environmentQuaternion);
    // r183 negates each Euler component when building the lookup matrix. Supply
    // the inverse lookup explicitly so combined pitch/yaw/roll stays scene-local.
    scene.environmentRotation.x *= -1; scene.environmentRotation.y *= -1; scene.environmentRotation.z *= -1;
    root.updateMatrixWorld(true);
  }
  return { root, ambient, sun, apply, dispose() {
    if (disposed) return; disposed = true;
    if (scene.environment === environment?.texture) scene.environment = null;
    root.removeFromParent(); environment?.dispose(); sun.dispose(); ambient.dispose();
  } };
}

/** AR shares a framebuffer/depth buffer, but each placed Scene owns its lighting.
 * Visibility is restored even when rendering fails. Camera pixels are drawn by the host.
 */
export function renderSceneContent(renderer, scene, camera, content, lighting) {
  const children = content.children.map(root => ({ root, visible: root.visible }));
  const scenes = children.filter(({ root, visible }) => visible && root.userData.sceneLighting);
  if (!scenes.length) { lighting.apply(); renderer.render(scene, camera); return; }
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  try {
    for (const { root } of scenes) root.visible = false;
    if (children.some(({ root, visible }) => visible && !root.userData.sceneLighting)) {
      lighting.apply(); renderer.render(scene, camera);
    }
    for (const { root } of children) root.visible = false;
    // Far-to-near improves compositing of independent translucent performances.
    scene.updateMatrixWorld(true);
    const position = camera.getWorldPosition(new Vector3()), scratch = new Vector3();
    scenes.sort((a, b) => b.root.getWorldPosition(scratch).distanceToSquared(position) - a.root.getWorldPosition(scratch).distanceToSquared(position));
    for (const { root } of scenes) {
      root.visible = true; lighting.apply(root.userData.sceneLighting, root);
      renderer.render(scene, camera); root.visible = false;
    }
  } finally {
    for (const { root, visible } of children) root.visible = visible;
    renderer.autoClear = autoClear; lighting.apply();
  }
}
