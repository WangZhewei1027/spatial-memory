import type { AutomationChannel, CompositionGroup, CompositionInstance, SceneDocument, SceneResourceKind, TransformKeyframe } from './protocol';

export type Vec3 = [number, number, number];
export type SceneNode = CompositionGroup | CompositionInstance;
export type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 };
export type NodePatch = Record<string, unknown>;
export interface Diagnostic { code: string; path: string; message: string; opIndex?: number; nodeId?: string; severity: 'error' | 'warning' }
export type Failure = { ok: false; errors: Diagnostic[]; diagnostics: Diagnostic[] };
export type Success<T> = { ok: true; warnings: Diagnostic[]; diagnostics: Diagnostic[] } & T;
export type Result<T> = Success<T> | Failure;
/** Facts supplied by the caller, keyed by assetId. Never an authorization grant. */
export interface ResourceFact {
  assetId: string;
  kind: SceneResourceKind;
  name?: string;
  state?: 'active' | 'archived';
  durationSeconds?: number | null;
  animations?: { index: number; name: string; duration?: number }[];
}
export interface AuthoringOptions { resources?: Record<string, ResourceFact>; requireResources?: boolean }
export interface Change { path: string; before?: unknown; after?: unknown; kind: 'add' | 'remove' | 'replace' }
export type ApplyResult = Result<{ document: SceneDocument; changes: Change[]; applied: number; unchanged: boolean }>;
export interface Listener { position: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } }
export interface SampleOptions extends AuthoringOptions { time: number; nodeIds?: string[]; listener?: Listener }
export interface SampledNode {
  id: string; kind: 'instance' | 'group'; parentId: string | null;
  local: Transform; worldMatrix: number[]; world?: Transform;
  hidden: boolean; visible: boolean; opacity: number;
  volume?: number; mediaTime?: number; clipTime?: number;
  spatial?: { gain: number; pan: number };
}
export interface SceneSample { time: number; durationSeconds: number | null; nodes: Record<string, SampledNode> }
export interface SceneInspection {
  schemaVersion: 6; units: 'meters'; durationSeconds: number | null; loop: boolean;
  counts: { assets: number; instances: number; groups: number; keyframes: number; channels: number };
  assets: { alias: string; assetId: string; kind?: SceneResourceKind; instanceIds: string[] }[];
  nodes: { id: string; kind: 'instance' | 'group'; name?: string; parentId: string | null; childIds: string[]; channels: string[]; region: { start: number; end: number | null }; hidden: boolean }[];
  /** Geometry bounds and occlusion require a loaded renderer; they are not inferred here. */
  capabilities: { geometryBounds: false; occlusion: false };
}
export type TimeScope = ('timing' | 'animation' | 'tracks')[];
export type TransformWrite = { space?: 'local' | 'world'; write?: 'base' | 'key'; time?: number };
export type Operation =
  | { type: 'document.replace'; document: SceneDocument }
  | { type: 'scene.update'; patch: NodePatch; unset?: string[] }
  | { type: 'asset.set'; alias: string; assetId: string }
  | { type: 'asset.remove'; alias: string }
  | { type: 'node.add'; kind: 'instance' | 'group'; node: SceneNode; beforeId?: string }
  | { type: 'node.update'; id: string; patch: NodePatch; unset?: string[] }
  | { type: 'node.remove'; id: string; descendants?: 'reject' | 'remove' | 'reparent' }
  | { type: 'node.duplicate'; id: string; idMap: Record<string, string> }
  | { type: 'node.reparent'; id: string; parentId: string | null; preserve: 'local' | 'world'; time?: number; write?: 'base' | 'key' }
  | { type: 'node.reorder'; ids: string[] }
  | ({ type: 'transform.set'; id: string; value: Partial<Transform> } & TransformWrite)
  | { type: 'transform.lookAt'; id: string; target: Vec3; up?: Vec3; forwardAxis?: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'; time: number; write?: 'base' | 'key' }
  | { type: 'track.set'; id: string; channel: AutomationChannel; keys: TransformKeyframe[] }
  | { type: 'track.remove'; id: string; channel: AutomationChannel; retainAt?: number }
  | { type: 'key.set'; id: string; channel: AutomationChannel; key: TransformKeyframe }
  | { type: 'key.remove'; id: string; channel: AutomationChannel; time: number }
  | { type: 'key.move'; id: string; channel: AutomationChannel; from: number; to: number }
  | { type: 'time.shift'; ids: string[]; seconds: number; includeDescendants?: boolean; scope?: TimeScope }
  | { type: 'time.stretch'; ids: string[]; factor: number; origin?: number; includeDescendants?: boolean; scope?: TimeScope }
  | { type: 'time.sequence'; ids: string[]; start?: number; gap?: number; includeDescendants?: boolean }
  | ({ type: 'layout'; ids: string[]; pattern: 'line' | 'grid' | 'circle'; origin?: Vec3; step?: Vec3; rowStep?: Vec3; columns?: number; radius?: number; plane?: 'xy' | 'xz' | 'yz'; startAngle?: number } & TransformWrite)
  | ({ type: 'layout.align'; ids: string[]; axis: 'x' | 'y' | 'z'; value?: number; mode?: 'min' | 'center' | 'max' } & TransformWrite)
  | ({ type: 'layout.distribute'; ids: string[]; axis: 'x' | 'y' | 'z'; start?: number; end?: number } & TransformWrite);
