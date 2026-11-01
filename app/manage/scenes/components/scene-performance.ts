import type { AssetDto, SceneResolvedResourceDto } from "@/lib/content-model/contracts";
import type { CompositionInstance } from "@/lib/scene/protocol";
import { primaryResource, thumbnailOf } from "../../lib/content-mappers";
import type { SceneResource } from "./types";

export const PERFORMANCE_KINDS = ["model", "image", "video", "audio"] as const;
export type PerformanceKind = typeof PERFORMANCE_KINDS[number];
export function isPerformanceKind(kind: string): kind is PerformanceKind {
  return PERFORMANCE_KINDS.some(value => value === kind);
}
export function resourceFromAsset(asset: AssetDto): SceneResource | null {
  if (!isPerformanceKind(asset.payload.kind)) return null;
  const duration = asset.payload.attributes?.duration_seconds ?? asset.payload.attributes?.duration;
  return { assetId: asset.id, assetLockVersion: asset.lock_version, name: asset.name,
    url: primaryResource(asset)?.url ?? null, thumbnailUrl: thumbnailOf(asset), assetState: asset.state, kind: asset.payload.kind,
    ...(typeof duration === "number" && duration > 0 ? { durationSeconds: duration } : {}),
    animations: asset.payload.kind === "model" ? asset.payload.animations : undefined };
}
export function resourceFromResolved(resource: SceneResolvedResourceDto): SceneResource {
  return { assetId: resource.asset_id, assetLockVersion: resource.asset_lock_version,
    name: resource.asset_name, url: resource.url, assetState: resource.asset_state,
    kind: isPerformanceKind(resource.file_type) ? resource.file_type : "model", animations: resource.animations };
}
export function timingFor(instance: CompositionInstance, duration: number) {
  return instance.timing ?? { startSeconds: 0, endSeconds: duration, fadeInSeconds: 0, fadeOutSeconds: 0 };
}
export function mediaFor(instance: CompositionInstance) {
  return instance.media ?? { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, volume: 1, loop: false, muted: false };
}
/** New tracks begin at the playhead and are always long enough to be edited. */
export function insertionTiming(time: number, duration: number, mediaDuration?: number) {
  const startSeconds = Math.max(0, time);
  const endSeconds = mediaDuration ? startSeconds + mediaDuration : Math.max(duration, startSeconds + 1);
  return { startSeconds, endSeconds, fadeInSeconds: 0, fadeOutSeconds: 0 };
}
