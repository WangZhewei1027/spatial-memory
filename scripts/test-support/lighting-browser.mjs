import * as Web from 'three';
import * as Mini from '../../../spatial-memory-mini-program/miniprogram/lib/three-runtime/vendor/three.js';
import { createSceneLighting, DEFAULT_SCENE_LIGHTING } from '../../packages/scene-lighting/index.js';

// Runs both shipped renderer implementations on the same GPU, with a rotated AR placement.
globalThis.runLightingParity = () => {
  const width = 192, height = 128;
  const setups = [Web, Mini].map((T, index) => {
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const renderer = new T.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(width, height); renderer.setPixelRatio(1); renderer.setClearColor(0x17191c, 1);
    const scene = new T.Scene(), content = new T.Group(), root = new T.Group(); scene.add(content); content.add(root);
    const camera = new T.PerspectiveCamera(50, width / height, .01, 100);
    camera.position.set(0, 2, 5); camera.lookAt(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      const material = new T.MeshStandardMaterial({ color: [0xa93227, 0xc0c8d0, 0x3179ca][i], metalness: i / 2, roughness: [1, .35, .08][i] });
      const mesh = new T.Mesh(new T.BoxGeometry(.9, .9, .9), material);
      mesh.position.x = (i - 1) * 1.2; mesh.rotation.set(.3, .4, .1); root.add(mesh);
    }
    if (index === 1) {
      root.position.set(3, 1.5, -2); root.rotation.set(.2, .7, -.15); root.updateMatrixWorld(true);
      camera.position.applyMatrix4(root.matrixWorld); camera.quaternion.premultiply(root.quaternion);
    }
    camera.updateMatrixWorld(true);
    const rig = index === 0 ? createSceneLighting(renderer, scene) : T.createSceneLighting(renderer, scene);
    return { T, renderer, scene, content, root, camera, rig };
  });
  const cases = [
    { ...DEFAULT_SCENE_LIGHTING },
    { ...DEFAULT_SCENE_LIGHTING, ambientIntensity: .3, ambientColor: '#8090ff', directionalIntensity: 3.5, directionalColor: '#ffe0a0', azimuth: -120, elevation: 20, environmentIntensity: 2, environmentRotation: 75 },
    { ...DEFAULT_SCENE_LIGHTING, environment: 'none', ambientIntensity: .4, directionalIntensity: 1, azimuth: 110, elevation: 60 },
  ];
  const results = [];
  try {
    for (const settings of cases) {
      const pixels = setups.map(({ T, renderer, scene, content, root, camera, rig }, index) => {
        renderer.setRenderTarget(null); renderer.clear();
        if (index === 0) { rig.apply(settings); renderer.render(scene, camera); }
        else { root.userData.sceneLighting = settings; renderer.autoClear = false; T.renderSceneContent(renderer, scene, camera, content, rig); }
        const gl = renderer.getContext(), data = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return data;
      });
      let sum = 0, max = 0, changed = 0;
      const energy = pixels[0].reduce((total, value, index) => total + (index % 4 === 3 ? 0 : value), 0);
      for (let i = 0; i < pixels[0].length; i++) { const diff = Math.abs(pixels[0][i] - pixels[1][i]); sum += diff; max = Math.max(max, diff); if (diff > 4) changed++; }
      results.push({ energy, environment: settings.environment, averageError: sum / pixels[0].length, maxError: max, changedChannels: changed });
    }
    return { webRevision: Web.REVISION, miniRevision: Mini.REVISION, results };
  } finally {
    for (const { renderer, scene, rig } of setups) {
      rig.dispose(); scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); }); renderer.dispose(); renderer.forceContextLoss();
    }
  }
};
