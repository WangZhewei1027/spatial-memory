"use client";
import { useRef, useState, type PointerEvent } from 'react';
import { Diamond } from 'lucide-react';
import { AUTOMATION_CHANNELS, type CompositionInstance } from '@/lib/scene/protocol';
import { isGroup, type SceneNode } from '@/lib/scene/hierarchy-authoring';
import { keyTimes, roundTime, type TransformGroup } from '@/lib/scene/transform-authoring';
import { SceneParamLane, SceneScalarLane } from './SceneParamLane';
import { SceneTrackHeader, type SceneTrackHeaderProps } from './SceneTrackHeader';
import { PARAMS } from './timeline-keys';
import { snapTime } from './timeline-scale';
import { useTimeline } from './timeline-context';
import type { ClipInfo } from './types';
import { applyRegion, changeRegion, instanceRegion, regionTime, type RegionEdit, type RegionRange, type SceneTrackKind } from './scene-region';

/** Every object has an editable visibility region, including static objects and scene-owned text. */
function PerformanceRegion({ instance, clips, kind, name }: { instance: CompositionInstance; clips?: ClipInfo[]; kind: SceneTrackKind; name: string }) {
  const view = useTimeline();
  const animation = instance.animation;
  const [draft, setDraft] = useState<RegionRange | null>(null);
  const grab = useRef<{ offset: number; mode: RegionEdit; before: RegionRange; latest: RegionRange } | null>(null);
  const clip = animation && clips?.[animation.clipIndex ?? clips.findIndex(item => item.name === animation.clipName)];
  const original = instanceRegion(instance, view.end, clip?.duration), range = draft ?? original;
  const length = range.end - range.start;
  const repeats = animation?.loop && clip && clip.duration > 0 ? Math.min(64, Math.floor(length / clip.duration)) : 0;
  const timeAt = (clientX: number, lane: HTMLElement) => { const rect = lane.getBoundingClientRect(); return (clientX - rect.left) / rect.width * view.span; };
  const commit = (before: RegionRange, after: RegionRange, mode: RegionEdit) => {
    if (view.disabled) return;
    view.onEditNode(instance.id, node => isGroup(node) ? node : applyRegion(node, before, after, mode) as typeof node);
  };
  const begin = (event: PointerEvent<HTMLElement>, mode: RegionEdit) => {
    if (event.button || view.disabled) return;
    const region = event.currentTarget.closest<HTMLElement>('.scene-performance-region');
    if (!region?.parentElement) return;
    // Capture on the region for both edge and body drags; cancellation never commits a partial edit.
    region.setPointerCapture(event.pointerId);
    grab.current = { offset: mode === 'move' ? timeAt(event.clientX, region.parentElement) - original.start : 0, mode, before: original, latest: original };
  };
  return <div className="scene-clip-region scene-performance-region" data-kind={kind} data-dragging={draft !== null || undefined} aria-disabled={view.disabled}
    style={{ left: view.pct(range.start), width: view.pct(length) }} title={`${name} · ${regionTime(range.start)} – ${regionTime(range.end)}`}
    tabIndex={view.disabled ? -1 : 0} role="group" aria-label={view.text(`${name}，${regionTime(range.start)} 到 ${regionTime(range.end)}，方向键移动片段`, `${name}, ${regionTime(range.start)} to ${regionTime(range.end)}, arrow keys move region`)}
    onPointerDown={event => begin(event, 'move')}
    onPointerMove={event => {
      const drag = grab.current;
      if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const raw = timeAt(event.clientX, event.currentTarget.parentElement!) - drag.offset;
      drag.latest = changeRegion(drag.before, drag.mode, event.altKey ? roundTime(raw) : snapTime(raw, view.steps.minor));
      setDraft(drag.latest);
    }}
    onPointerCancel={() => { grab.current = null; setDraft(null); }}
    onPointerUp={() => {
      const drag = grab.current; grab.current = null; setDraft(null);
      if (drag) commit(drag.before, drag.latest, drag.mode);
    }}
    onKeyDown={event => {
      if (view.disabled || event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.altKey ? .001 : view.steps.minor) * (event.shiftKey ? 10 : 1);
      commit(original, changeRegion(original, 'move', original.start + delta), 'move');
    }}>
    {(['start', 'end'] as const).map(edge => <button key={edge} type="button" className="scene-region-handle" data-edge={edge} disabled={view.disabled}
      aria-label={view.text(`${edge === 'start' ? '出现点' : '消失点'}：${regionTime(range[edge])}`, `${edge === 'start' ? 'Appearance' : 'Disappearance'}: ${regionTime(range[edge])}`)}
      title={view.text('拖动边缘调整时间；方向键微调', 'Drag edge to adjust time; arrow keys fine-tune')}
      onPointerDown={event => { event.stopPropagation(); begin(event, edge); }}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.altKey ? .001 : view.steps.minor) * (event.shiftKey ? 10 : 1);
        commit(original, changeRegion(original, edge, original[edge] + delta), edge);
      }} />)}
    {Array.from({ length: repeats }, (_, i) => <i key={i} className="scene-clip-repeat" style={{ left: `${(i + 1) * (clip?.duration ?? 0) / length * 100}%` }} />)}
  </div>;
}

export interface SceneTrackProps extends Omit<SceneTrackHeaderProps, 'row'> {
  row: SceneTrackHeaderProps['row']; clips?: ClipInfo[];
  expandedParams: ReadonlySet<TransformGroup>; onParam(group: TransformGroup): void;
}
/** One track: header and region lane, plus parameter lanes while its automation is shown. */
export function SceneTrack({ clips, expandedParams, onParam, ...header }: SceneTrackProps) {
  const view = useTimeline();
  const node: SceneNode = header.row.node;
  const kind = header.kind ?? (isGroup(node) ? 'group' : node.text ? 'text' : 'model');
  const labels = { position: view.text('位置', 'Position'), rotation: view.text('旋转', 'Rotation'), scale: view.text('缩放', 'Scale') };
  return <>
    <div className="scene-track-row" data-kind={header.row.kind} data-hidden={node.hidden || header.hiddenByParent || undefined} data-selected={header.selected || undefined}>
      <SceneTrackHeader {...header} />
      <div className="scene-track-lane scene-region-lane" onPointerDownCapture={e => { if (!e.button) header.onSelect(e); }}>
        {!isGroup(node) && <PerformanceRegion instance={node} clips={clips} kind={header.kind ?? (node.text ? 'text' : 'model')} name={header.name} />}
        {!header.automation && keyTimes(node, AUTOMATION_CHANNELS).map(time => <Diamond key={time} className="scene-key-summary" aria-hidden="true" data-outside={time > view.end || undefined} style={{ left: view.pct(time) }} />)}
      </div>
    </div>
    {header.automation && !isGroup(node) && <>
      {kind !== 'audio' && <SceneScalarLane node={node} channel="opacity" depth={header.row.depth} label={view.text('不透明度', 'Opacity')} />}
      {(kind === 'audio' || kind === 'video') && <SceneScalarLane node={node} channel="volume" depth={header.row.depth} label={view.text('音量', 'Volume')} />}
    </>}
    {header.automation && PARAMS.filter(group => kind !== 'audio' || group === 'position').map(group => <SceneParamLane key={group} node={node} group={group} depth={header.row.depth} label={labels[group]}
      expanded={expandedParams.has(group)} onExpand={() => onParam(group)} />)}
  </>;
}
