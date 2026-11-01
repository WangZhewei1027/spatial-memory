import { mediaTime, sampleFade, sampleVolume } from '@spatial-memory/scene-core';
import type { CompositionInstance } from '@/lib/scene/protocol';
import type { SpatialAudioMixer } from './spatial-audio';

/** A single media element belongs to one scene instance, including its pending play request. */
export class MediaPlayback {
  private pending = false;
  private blocked = false;
  private closed = false;
  private wasPlaying = false;
  private desiredPlaying = false;
  private prepared = false;
  private generation = 0;
  private latest?: { instance: CompositionInstance; time: number; playing: boolean; duration: number | null; spatial: { gain: number; pan: number } };
  private metadata = () => { if (this.prepared && this.latest) this.apply(this.latest); };

  constructor(readonly element: HTMLMediaElement, private url: string, private onError: (blocked: boolean) => void, private audio?: SpatialAudioMixer) {
    element.preload = 'none';
    element.addEventListener('loadedmetadata', this.metadata);
  }

  sync(instance: CompositionInstance, time: number, playing: boolean, duration: number | null, prepare = true, spatial = { gain: 1, pan: 0 }) {
    if (this.closed) return;
    this.latest = { instance, time, playing, duration, spatial };
    if (playing && instance.media?.spatial?.enabled) this.audio?.unlock(() => this.onError(true));
    else if (!playing) this.audio?.pause();
    if (!prepare) { this.release(); return; }
    if (!this.prepared) {
      this.prepared = true;
      this.element.preload = 'auto';
      // Native media consumes the OSS URL progressively with range requests. It never
      // waits for a fetch/blob or complete download before starting playback.
      this.element.src = this.url;
      this.element.load();
    }
    this.apply(this.latest);
  }

  private apply({ instance, time, playing, duration, spatial }: NonNullable<MediaPlayback['latest']>) {
    const presentation = sampleFade(instance, time, duration);
    const settings = instance.media;
    const sourceDuration = Number.isFinite(this.element.duration) ? this.element.duration : undefined;
    const target = mediaTime(presentation.visible ? time : 0, settings, instance.timing, sourceDuration);
    const trimStart = Math.min(settings?.trimStartSeconds ?? 0, sourceDuration ?? Infinity);
    const trimEnd = Math.min(settings?.trimEndSeconds ?? Infinity, sourceDuration ?? Infinity);
    const local = Math.max(0, time - (instance.timing?.startSeconds ?? 0));
    const emptyRange = Number.isFinite(trimEnd) && trimEnd <= trimStart;
    const ended = emptyRange || (!settings?.loop && Number.isFinite(trimEnd) && local >= trimEnd - trimStart);
    const shouldPlay = playing && presentation.visible && !ended;
    this.desiredPlaying = shouldPlay;
    if (!playing) this.blocked = false;
    const volume = Math.max(0, Math.min(1, sampleVolume(instance, time) * presentation.opacity * spatial.gain));
    if (this.audio) this.audio.apply(this.element, volume, spatial.pan, settings?.spatial?.enabled ?? false, playing, () => this.onError(true));
    else this.element.volume = volume;
    this.element.muted = settings?.muted ?? false;
    // The scene owns loops, including trims. Native looping would include the entire file.
    this.element.loop = false;
    const threshold = playing && this.wasPlaying ? 0.15 : 0.015;
    if (this.element.readyState >= 1 && Math.abs(this.element.currentTime - target) > threshold) {
      try { this.element.currentTime = target; } catch { /* A stream may not expose seekable data yet. */ }
    }
    this.wasPlaying = shouldPlay;
    if (!shouldPlay) { if (!this.element.paused) this.element.pause(); return; }
    // Metadata must arrive before play so a trimmed cue cannot briefly play from 0.
    if (this.element.readyState < 1 || !this.element.paused || this.pending || this.blocked) return;
    this.pending = true;
    const generation = this.generation;
    void this.element.play().then(() => {
      if (generation !== this.generation) return;
      if (this.closed || !this.desiredPlaying) this.element.pause();
    }).catch((error: unknown) => {
      if (generation !== this.generation || this.closed || !this.desiredPlaying) return;
      // Seeking while a play request is loading may abort it; the next frame retries.
      if (error instanceof Error && error.name === 'AbortError') return;
      this.blocked = true;
      this.onError(error instanceof Error && error.name === 'NotAllowedError');
    }).finally(() => { if (generation === this.generation) this.pending = false; });
  }

  private release() {
    if (!this.prepared) return;
    this.prepared = false;
    this.generation++;
    this.pending = false;
    this.blocked = false;
    this.wasPlaying = false;
    this.desiredPlaying = false;
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.preload = 'none';
    this.element.load();
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.element.removeEventListener('loadedmetadata', this.metadata);
    this.latest = undefined;
    this.release();
    this.audio?.remove(this.element);
  }
}
