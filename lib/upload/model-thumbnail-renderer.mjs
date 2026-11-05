// Executed only in the server's isolated Chromium page, never in the Web app.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

async function renderThumbnail() {
  const manager = new THREE.LoadingManager();
  let failed = false;
  manager.onError = () => { failed = true; };
  manager.setURLModifier((url) => {
    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/three/examples/jsm/libs/draco/gltf/")) return url;
    throw new Error("External model resources are not supported");
  });
  const draco = new DRACOLoader(manager).setDecoderPath("/three/examples/jsm/libs/draco/gltf/").setWorkerLimit(1);
  const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const bytes = await (await fetch("/model")).arrayBuffer();
  const gltf = await loader.parseAsync(bytes, "");
  if (failed) throw new Error("A model resource failed to load");

  const box = new THREE.Box3().setFromObject(gltf.scene, true);
  const size = box.getSize(new THREE.Vector3());
  const dimension = Math.max(size.x, size.y, size.z);
  if (box.isEmpty() || !Number.isFinite(dimension) || dimension <= 0) throw new Error("Model has no visible geometry");
  let vertices = 0;
  gltf.scene.traverse((object) => {
    if (object.geometry) vertices += object.geometry.attributes.position?.count ?? 0;
  });
  if (vertices > 2_000_000) throw new Error("Model exceeds thumbnail geometry budget");

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(512, 512);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  // A neutral backdrop keeps pale and emissive edges visible at card size.
  scene.background = new THREE.Color(0xb5b8bc);
  const environment = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  const environmentMap = generator.fromScene(environment, 0.04);
  scene.environment = environmentMap.texture;
  // The studio map already lights diffuse surfaces. Keep fill low to retain
  // midtones and leave room for the directional highlight on glossy materials.
  scene.environmentIntensity = 0.38;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8090, 0.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  // Put any model's bounds in the same coordinate range before framing, avoiding
  // precision loss with very large/small authoring units or distant origins.
  const content = new THREE.Group();
  content.add(gltf.scene);
  gltf.scene.position.sub(box.getCenter(new THREE.Vector3()));
  content.scale.setScalar(2 / dimension);
  scene.add(content);
  scene.updateMatrixWorld(true);
  const sphere = new THREE.Box3().setFromObject(content, true).getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.12;
  camera.position.copy(new THREE.Vector3(3, 2, 4).normalize().multiplyScalar(distance).add(sphere.center));
  camera.lookAt(sphere.center);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  const result = renderer.domElement.toDataURL("image/png");
  draco.dispose();
  environmentMap.dispose();
  environment.dispose();
  generator.dispose();
  renderer.dispose();
  return result;
}

renderThumbnail().then(
  (result) => { window.thumbnailResult = result; },
  () => { window.thumbnailResult = null; },
);
