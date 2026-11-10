import type { RefObject } from 'react';
import type { PlacementReader } from '@/lib/scene/editor-interactions';
import type { CompositionGroup, CompositionInstance } from '@/lib/scene/protocol';
import type { SceneSession } from '../scene-session';
import type { ClipInfo, SceneResource } from '../types';
import type { SceneCameraSettings } from './spatial-reference';
export interface ThreeViewportProps {
  lighting?: import("@/packages/scene-lighting").SceneLighting;
  session: SceneSession; instances: CompositionInstance[]; groups?: CompositionGroup[];
  resolveUrl(instance: CompositionInstance): string | null | undefined;
  resolveResource?(instance: CompositionInstance): SceneResource | undefined;
  onClips(id: string, clips: ClipInfo[], assetId?: string): void; onSelect(id: string | null, modifiers?: import("../scene-selection").SelectionModifiers): void;
  selectedIds?: string[];
  onTransforms?(values: import("./multi-selection").SelectionTransform[]): void;
  onTransform(id: string, group: "position" | "rotation" | "scale", value: import("@spatial-memory/scene-core").Vector): void; onError(message: string): void;
  fitRef: RefObject<(() => void) | null>; placementRef: RefObject<PlacementReader | null>;
  originRef: RefObject<(() => void) | null>; cameraSettings: SceneCameraSettings;
  previewRef: RefObject<HTMLDivElement | null>;
  toolsRef: RefObject<HTMLDivElement | null>;
  shadingRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null; grid: boolean; labels: boolean; editable: boolean; preview: boolean; language: string;
}
