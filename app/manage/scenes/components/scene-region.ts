import { type CompositionInstance } from '@/lib/scene/protocol';
import { roundTime } from '@/lib/scene/transform-authoring';

export type SceneTrackKind = 'model' | 'image' | 'audio' | 'video' | 'text' | 'group';
export type RegionEdit = 'move' | 'start' | 'end';
export interface RegionRange { start: number; end: number }
export const MIN_REGION_DURATION = .001;

/** Existing GLB-only scenes keep their clip region; new tracks show their visibility interval. */
export function instanceRegion(instance: CompositionInstance, duration: number, clipDuration?: number): RegionRange {
  const start = instance.timing?.startSeconds ?? instance.animation?.startSeconds ?? 0;
  const end = instance.timing?.endSeconds ?? (instance.timing || !instance.animation || instance.animation.loop || !clipDuration
    ? duration : Math.min(duration, start + clipDuration));
  return { start, end: Math.max(start + MIN_REGION_DURATION, end) };
}

/** Clamp a gesture while preserving region length for moves and the opposite edge for trims. */
export function changeRegion(range: RegionRange, mode: RegionEdit, at: number): RegionRange {
  if (!Number.isFinite(at)) return range;
  // Retain out-of-scene content when the scene end was shortened.
  if (mode === 'start') return { start: roundTime(Math.max(0, Math.min(range.end - MIN_REGION_DURATION, at))), end: range.end };
  if (mode === 'end') return { start: range.start, end: roundTime(Math.max(range.start + MIN_REGION_DURATION, at)) };
  const length = range.end - range.start;
  const start = roundTime(Math.max(0, at));
  return { start, end: roundTime(start + length) };
}

/** One immutable update per finished gesture, so a drag is a single undo step. */
export function applyRegion(instance: CompositionInstance, before: RegionRange, after: RegionRange, mode: RegionEdit): CompositionInstance {
  if (before.start === after.start && before.end === after.end) return instance;
  if (!instance.timing && instance.animation && mode === 'move') {
    return { ...instance, animation: { ...instance.animation, startSeconds: after.start } };
  }
  const length = after.end - after.start;
  const fadeIn = instance.timing?.fadeInSeconds ?? 0, fadeOut = instance.timing?.fadeOutSeconds ?? 0;
  const animation = instance.animation && mode === 'move'
    ? { ...instance.animation, startSeconds: Math.max(0, roundTime(instance.animation.startSeconds + after.start - before.start)) }
    : instance.animation;
  return {
    ...instance, animation,
    timing: { startSeconds: after.start, endSeconds: after.end, fadeInSeconds: roundTime(Math.min(fadeIn, length)), fadeOutSeconds: roundTime(Math.min(fadeOut, length)) },
  };
}

export const regionTime = (time: number) => `${Number(time.toFixed(3))}s`;
