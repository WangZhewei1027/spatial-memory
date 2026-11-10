import type { AnimationMixer, Camera, Color, Euler, Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
export interface Signal { add(callback: (...args: unknown[]) => void): void; removeAll(): void; dispatch(...args: unknown[]): void }
export interface NativeCommand { type: string; object: Object3D; newPosition?: Vector3; newRotation?: Euler; newScale?: Vector3; execute(): void }
export class Editor {
  constructor(options: { config: { getKey(key: string): unknown; setKey(...args: unknown[]): void }; history: { execute(command: NativeCommand): void; clear(): void } });
  environmentType: string;
  signals: Record<string, Signal>; scene: Scene; sceneHelpers: Scene; camera: PerspectiveCamera; viewportCamera: Camera; viewportColor: Color;
  selector: { select(object: Object3D | null): void }; selected: Object3D | null; controls: { focus(object: Object3D): void; center: Vector3 };
  mixer: AnimationMixer; materialsRefCounter: Map<unknown, number>; geometries: Record<string, unknown>;
  addObject(object: Object3D): void; removeObject(object: Object3D): void; select(object: Object3D | null): void; focus(object: Object3D): void; execute(command: NativeCommand): void;
}
export interface NativeViewport { dom: HTMLDivElement; cameraControls: { dom: HTMLDivElement }; setViewHelperLocation(left: number, top: number): void; transformControls: TransformControls; beforeRender: (() => void) | null; setEditable(enabled: boolean): void; setHelpers(visible: boolean): void; dispose(): void }
export function Viewport(editor: Editor): NativeViewport;
export function Toolbar(editor: Editor): { dom: HTMLDivElement };
