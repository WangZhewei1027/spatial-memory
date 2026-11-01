"use client";
import { useRef, useState } from 'react';
import { Diamond } from 'lucide-react';
import { type AutomationChannel, type TransformKeyframe } from '@/lib/scene/protocol';
import type { SceneNode } from '@/lib/scene/hierarchy-authoring';
import { frameAt, keyAll, keyTimes, moveKeys, unkeyAll } from '@/lib/scene/transform-authoring';
import { useTimeline } from './timeline-context';

const trackFrames = (node: SceneNode): Partial<Record<AutomationChannel, TransformKeyframe[]>> => node.tracks ?? {};

/** One keyframe lane. With several channels, a diamond stands for every key at that time. */
export function SceneKeyLane({ node, channels, label }: { node: SceneNode; channels: readonly AutomationChannel[]; label: string }) {
  const view = useTimeline();
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragging = useRef<typeof drag>(null);
  const select = (time: number) => { view.selectKey({ nodeId: node.id, channels, time }); view.onSeek(Math.min(time, view.end)); };
  const isSelected = (time: number) => view.selectedKey?.nodeId === node.id && view.selectedKey.channels.join() === channels.join() && view.selectedKey.time === time;
  return <div className="scene-track-lane" onDoubleClick={e => {
    if (view.disabled) return;
    const at = view.laneTime(e, e.currentTarget, view.end);
    view.onSeek(at); view.onEditNode(node.id, current => keyAll(current, channels, at)); select(at);
  }}>
    {keyTimes(node, channels).map(time => {
      const at = drag?.from === time ? drag.to : time;
      const partial = channels.some(channel => frameAt(trackFrames(node)[channel], time) < 0);
      return <button type="button" key={time} className="scene-keyframe" data-partial={partial || undefined} data-outside={at > view.end || undefined} data-dragging={at !== time || undefined}
        aria-label={`${label} · ${time}s`} aria-pressed={isSelected(time)} title={`${time}s`} disabled={view.disabled} style={{ left: view.pct(at) }}
        onClick={e => { e.stopPropagation(); select(time); }}
        onKeyDown={e => {
          if (e.key !== 'Delete' && e.key !== 'Backspace') return;
          e.preventDefault(); e.stopPropagation(); view.onEditNode(node.id, current => unkeyAll(current, channels, time)); view.selectKey(null);
        }}
        onPointerDown={e => { if (e.button) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = { from: time, to: time }; setDrag(dragging.current); }}
        onPointerMove={e => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId) || !dragging.current) return;
          dragging.current = { ...dragging.current, to: view.laneTime(e, e.currentTarget.parentElement!, view.span) }; setDrag(dragging.current);
        }}
        onPointerCancel={() => { dragging.current = null; setDrag(null); }}
        onPointerUp={e => {
          const move = dragging.current; dragging.current = null; setDrag(null); e.currentTarget.releasePointerCapture(e.pointerId);
          if (!move || move.from === move.to) return;
          view.onEditNode(node.id, current => moveKeys(current, channels, move.from, move.to)); select(move.to);
        }}><Diamond aria-hidden="true" /></button>;
    })}
  </div>;
}
