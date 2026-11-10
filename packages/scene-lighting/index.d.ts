import type { AmbientLight, Camera, DirectionalLight, Group, Object3D, Scene, WebGLRenderer } from 'three';
import type { SceneLighting } from './config.js';
export * from './config.js';
export interface SceneLightingRig {
  root: Group; ambient: AmbientLight; sun: DirectionalLight;
  apply(settings?: Readonly<SceneLighting>, placement?: Object3D): void;
  dispose(): void;
}
export function createSceneLighting(renderer: WebGLRenderer, scene: Scene): SceneLightingRig;
export function renderSceneContent(renderer: WebGLRenderer, scene: Scene, camera: Camera, content: Object3D, lighting: SceneLightingRig): void;
