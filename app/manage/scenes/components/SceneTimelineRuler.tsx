"use client";
import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { roundTime } from '@/lib/scene/transform-authoring';
import { formatTime, MIN_SCENE_DURATION, snapTime, type GridSteps } from './timeline-scale';

export interface SceneTimelineRulerProps {
  span: number; end: number; time: number; loop: boolean; steps: GridSteps; canResize: boolean;
  text(zh: string, en: string): string;
  onSeek(time: number): void;
  /** Live scene-end drag; `null` ends the drag and `commit` says whether to keep the draft. */
  onEnd(time: number | null, commit?: boolean): void;
  onDuration(time: number): void;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Logic-style ruler: click or drag to scrub, drag the playhead head, drag the end marker to set the scene length. */
export function SceneTimelineRuler(p: SceneTimelineRulerProps) {
  const [scrubbing, setScrubbing] = useState(false);
  const [resizing, setResizing] = useState(false);
  const pct = (time: number) => `${time / p.span * 100}%`;
  const timeAt = (event: PointerEvent<HTMLElement>, ruler: HTMLElement) => {
    const rect = ruler.getBoundingClientRect();
    return Math.max(0, (event.clientX - rect.left) / rect.width * p.span);
  };
  const seekTo = (time: number) => p.onSeek(roundTime(clamp(time, 0, p.end)));
  const nudge = (event: KeyboardEvent, apply: (delta: number) => void) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation();
    apply((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? p.steps.major : p.steps.minor));
  };
  const resizeTo = (time: number) => roundTime(Math.max(MIN_SCENE_DURATION, time));
  const labels = Array.from({ length: Math.floor(p.span / p.steps.major + 1e-6) + 1 }, (_, i) => roundTime(i * p.steps.major));
  return <div className="scene-time-ruler" data-scrubbing={scrubbing || undefined}
    onPointerDown={e => { if (e.button) return; e.currentTarget.setPointerCapture(e.pointerId); setScrubbing(true); seekTo(timeAt(e, e.currentTarget)); }}
    onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(timeAt(e, e.currentTarget)); }}
    onPointerUp={() => setScrubbing(false)} onPointerCancel={() => setScrubbing(false)}>
    {p.loop && <i className="scene-ruler-cycle" style={{ width: pct(p.end) }} />}
    <i className="scene-ruler-outside" style={{ left: pct(p.end) }} />
    {labels.map(time => <span key={time} className="scene-ruler-label" style={{ left: pct(time) }}>{formatTime(time, p.steps.major)}</span>)}
    <i className="scene-playhead-head" role="slider" tabIndex={0} style={{ left: pct(p.time) }}
      aria-label={p.text('播放头', 'Playhead')} aria-valuemin={0} aria-valuemax={p.end} aria-valuenow={p.time} aria-valuetext={formatTime(p.time, .1)}
      onKeyDown={e => nudge(e, delta => seekTo(p.time + delta))} />
    <div className="scene-end-marker" role="slider" tabIndex={p.canResize ? 0 : -1} aria-disabled={!p.canResize}
      aria-label={p.text('场景结束位置（拖动调整时长）', 'Scene end (drag to change duration)')} aria-valuemin={MIN_SCENE_DURATION} aria-valuenow={p.end} aria-valuetext={formatTime(p.end, .1)}
      data-active={resizing || undefined} style={{ left: pct(p.end) }}
      onKeyDown={e => { if (p.canResize) nudge(e, delta => p.onDuration(resizeTo(p.end + delta))); }}
      onPointerDown={e => {
        e.stopPropagation();
        if (e.button || !p.canResize) return;
        e.currentTarget.setPointerCapture(e.pointerId); setResizing(true); p.onEnd(p.end);
      }}
      onPointerMove={e => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const raw = timeAt(e, e.currentTarget.parentElement!);
        // Snap to the visible grid; hold Alt/Option for millisecond precision.
        p.onEnd(resizeTo(e.altKey ? raw : snapTime(raw, p.steps.minor)));
      }}
      onPointerUp={() => { setResizing(false); p.onEnd(null, true); }}
      onPointerCancel={() => { setResizing(false); p.onEnd(null, false); }}>
      {resizing && <span className="scene-end-label">{formatTime(p.end, .1)}</span>}
    </div>
  </div>;
}
