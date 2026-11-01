export const SCENE_SCHEMA_VERSION = 5 as const;
/** Playback schema for legacy scenes without groups; grouped scenes use schema 5. */
export const SCENE_FLAT_SCHEMA_VERSION = 4 as const;
/** Media, scene-owned text and presentation timing require a capable player. */
export const SCENE_PERFORMANCE_SCHEMA_VERSION = 7 as const;
/** Scalar automation and spatial audio require the matching player. */
export const SCENE_AUTOMATION_SCHEMA_VERSION = 8 as const;
export const SCENE_DOCUMENT_VERSION = 6 as const;

export interface CompositionAssetRef {
  assetId: string;
}

/** Scene alias referencing an asset identity. */
export interface AssetRef {
  assetId: string;
}

export interface InstanceAnimation {
  /** Zero-based index into the GLB's animations; exactly one of clipIndex / clipName. */
  clipIndex?: number;
  /** GLB animation name; only allowed when the name is unique in the file. */
  clipName?: string;
  startSeconds: number;
  loop: boolean;
}

/** Position, Euler XYZ rotation, scale and optional tracks, local to the parent group. */
export interface TransformNode {
  /** Authoring visibility switch; compiled to opacity for existing players. */
  hidden?: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  tracks?: Partial<Record<TransformChannel, TransformKeyframe[]>>;
}

/** Transform parent for instances and nested groups; it renders nothing itself. */
export interface CompositionGroup extends TransformNode {
  id: string;
  name: string;
  /** Parent group ID; omitted at the scene root. */
  parent?: string;
}

export const SCENE_RESOURCE_KINDS = ["model", "image", "audio", "video"] as const;
export type SceneResourceKind = typeof SCENE_RESOURCE_KINDS[number];
export function isSceneResourceKind(value: unknown): value is SceneResourceKind {
  return typeof value === "string" && SCENE_RESOURCE_KINDS.some(kind => kind === value);
}
export interface InstanceTiming {
  startSeconds: number;
  /** Exclusive end; null follows the scene duration. */
  endSeconds: number | null;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface SpatialAudioSettings {
  enabled: boolean;
  /** Distances are meters; inverse attenuation is clamped at maxDistance. */
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
}

export interface InstanceMedia {
  trimStartSeconds: number;
  /** Source-media end; null uses the file's duration. */
  trimEndSeconds: number | null;
  /** Reserved at 1: media always plays at natural speed. */
  playbackRate: 1;
  volume: number;
  loop: boolean;
  muted: boolean;
  spatial?: SpatialAudioSettings;
}

/** Owned by this scene document, never inserted into the team's asset library. */
export interface SceneText {
  content: string;
  color: string;
  /** Character height and wrapping width in meters. */
  fontSize: number;
  width: number;
  align: "left" | "center" | "right";
  /** Omitted for a transparent background. Colors use #RRGGBB. */
  backgroundColor?: string;
}

export interface CompositionInstance {
  id: string;
  /** Authoring visibility switch, independent of opacity tracks and media mute. */
  hidden?: boolean;
  /** Exactly one of asset or text; text has no asset dependency. */
  asset?: string;
  text?: SceneText;
  timing?: InstanceTiming;
  media?: InstanceMedia;
  /** Visual opacity before the entry/exit fade, defaults to 1. */
  opacity?: number;
  /** Track name; the asset name is shown when omitted. */
  name?: string;
  /** Parent group ID; omitted at the scene root. */
  parent?: string;
  position: [number, number, number];
  /** Euler XYZ radians; UI displays degrees. Multi-turn values are retained. */
  rotation: [number, number, number];
  scale: [number, number, number];
  animation: InstanceAnimation | null;
  /** Numeric transform and presentation tracks, sampled by the shared core. */
  tracks?: Partial<Record<AutomationChannel, TransformKeyframe[]>>;
}

export const TRANSFORM_CHANNELS = ["position.x", "position.y", "position.z", "rotation.x", "rotation.y", "rotation.z", "scale.x", "scale.y", "scale.z"] as const;
export type TransformChannel = typeof TRANSFORM_CHANNELS[number];
export const AUTOMATION_CHANNELS = [...TRANSFORM_CHANNELS, "opacity", "volume"] as const;
export type AutomationChannel = typeof AUTOMATION_CHANNELS[number];
export interface TransformKeyframe {
  time: number;
  value: number;
  handles: [number, number, number, number];
  connectedRight: boolean;
}

export interface CompositionContent<Ref = CompositionAssetRef> {
  kind: "composition";
  units: "meters";
  /** Finite positive, or null when no instance has an animation (static scene, never ends). */
  durationSeconds: number | null;
  loop: boolean;
  assets: Record<string, Ref>;
  /** Instance order is the timeline track order; group members are contiguous. */
  instances: CompositionInstance[];
  groups?: CompositionGroup[];
}

export interface SceneDefinition {
  schemaVersion: typeof SCENE_SCHEMA_VERSION | typeof SCENE_FLAT_SCHEMA_VERSION | typeof SCENE_PERFORMANCE_SCHEMA_VERSION | typeof SCENE_AUTOMATION_SCHEMA_VERSION;
  content: CompositionContent;
}

export interface SceneDocument {
  schemaVersion: typeof SCENE_DOCUMENT_VERSION;
  content: CompositionContent<AssetRef>;
}

export function createBlankScene(): SceneDefinition {
  return { schemaVersion: SCENE_FLAT_SCHEMA_VERSION, content: { kind: "composition", units: "meters", durationSeconds: 10, loop: false, assets: {}, instances: [] } };
}

/** Server factory for a new independent Scene draft (10 s, no loop, empty). */
export function createBlankSceneDocument(): SceneDocument {
  return { schemaVersion: SCENE_DOCUMENT_VERSION, content: { kind: "composition", units: "meters", durationSeconds: 10, loop: false, assets: {}, instances: [] } };
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Playback manifest compiled from a fixed Scene.
 * `assetId` is the discovered placement ID.
 */
export interface SceneAssetManifest extends SceneDefinition {
  assetId: string;
  resources: Record<string, { assetId: string; url: string; kind?: SceneResourceKind }>;
}
