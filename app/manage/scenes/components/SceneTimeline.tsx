"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/typography';
import { type CompositionContent } from '@/lib/scene/protocol';
import { findNode, isGroup, trackRows, type SceneNode } from '@/lib/scene/hierarchy-authoring';
import { hiddenNodeIds } from '@/lib/scene/visibility';
import { roundTime, unkeyAll, type TransformGroup } from '@/lib/scene/transform-authoring';
import { MODEL_DRAG_TYPE } from '@/lib/scene/editor-interactions';
import { SceneTimelineRuler } from './SceneTimelineRuler';
import { SceneTimelineToolbar } from './SceneTimelineToolbar';
import { SceneTrack } from './SceneTrack';
import type { DropPlace } from './SceneTrackHeader';
import { interpolationOf, setInterpolation, type KeySelection } from './timeline-keys';
import { TimelineContext, type TimelineView } from './timeline-context';
import { gridSteps, snapTime, TIMELINE_LEAD } from './timeline-scale';
import { useScenePanelSize } from './useScenePanelSize';
import { ScenePanelDivider } from './ScenePanelDivider';
import { useTimelineView } from './useTimelineView';
import type { SceneTrackActions } from './useSceneTracks';
import type { ClipInfo } from './types';
import { instanceRegion, regionTime, type SceneTrackKind } from './scene-region';

export interface SceneTimelineProps {
  content: Pick<CompositionContent, 'instances' | 'groups' | 'assets'>; clips: Record<string, ClipInfo[] | undefined>;
  nameOf(node: SceneNode): string; selectedIds: string[]; onSelect(ids: string[]): void;
  time: number; duration: number; loop: boolean; playing: boolean; readOnly: boolean;
  onSeek(time: number): void; onPlay(): void; onDuration(time: number): void; onLoop(loop: boolean): void;
  tracks: SceneTrackActions;
  onDuplicate(id: string): void;
  kindOf?(node: SceneNode): SceneTrackKind;
  /** The library registers the asset before dragging; timeline insertion uses the same resource lookup. */
  onAddAsset?(assetId: string, startSeconds: number): void;
}
const toggle = <T,>(set: ReadonlySet<T>, value: T) => { const next = new Set(set); if (!next.delete(value)) next.add(value); return next; };

/** Logic-style arrange area: one track per object, groups as stacks, keyframes in lanes revealed under a track. */
export function SceneTimeline(p: SceneTimelineProps) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith('zh') ? zh : en;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [automationIds, setAutomationIds] = useState<ReadonlySet<string>>(new Set());
  const toggleAutomation = (ids: string[]) => setAutomationIds(current => ids.reduce(toggle, current));
  const [params, setParams] = useState<ReadonlySet<string>>(new Set());
  const [storedKey, setSelectedKey] = useState<KeySelection | null>(null);
  const [endDraft, setEndDraft] = useState<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTime, setDropTime] = useState<number | null>(null);
  const height = useScenePanelSize("timeline");
  const disabled = p.readOnly || p.playing, end = endDraft ?? p.duration;
  const rows = useMemo(() => trackRows(p.content), [p.content]);
  const hidden = useMemo(() => hiddenNodeIds(p.content), [p.content]);
  const visible = rows.filter(row => { const visited = new Set<string>(); for (let at = row.node.parent; at && !visited.has(at); at = findNode(p.content, at)?.parent) { if (collapsed.has(at)) return false; visited.add(at); } return true; });
  const lastKey = rows.reduce((end, row) => Object.values(row.node.tracks ?? {}).reduce((last, frames) => Math.max(last, frames?.at(-1)?.time ?? 0), end), 0);
  const lastRegion = p.content.instances.reduce((last, instance) => Math.max(last, instanceRegion(instance, end).end), 0);
  const { scroller, span, laneWidth, labelWidth, compact, zoom, canZoomIn, zoomBy } = useTimelineView(Math.max(end, lastKey, lastRegion), p.time, p.playing);
  const steps = gridSteps(laneWidth / span), x = (time: number) => time / span * laneWidth, left = (time: number) => labelWidth + TIMELINE_LEAD + x(time);
  const primary = p.selectedIds.at(-1), primaryNode = primary ? findNode(p.content, primary) : undefined;
  // Selection is shared with the viewport: a key never outlives its selected track.
  const selectedKey = storedKey?.nodeId === primary ? storedKey : null;
  const keyNode = selectedKey ? findNode(p.content, selectedKey.nodeId) : undefined;
  useEffect(() => { if (storedKey && storedKey.nodeId !== primary) setSelectedKey(null); }, [primary, storedKey]);
  const selectKey = (key: KeySelection | null) => {
    if (key) p.onSelect([key.nodeId]);
    setSelectedKey(key);
  };
  const shortcuts = useRef({ automation: () => {}, group: () => {}, ungroup: () => {} });
  shortcuts.current = {
    automation: () => toggleAutomation(p.selectedIds),
    group: () => { if (!disabled && p.selectedIds.length) p.tracks.group(); },
    ungroup: () => { if (!disabled && primaryNode && isGroup(primaryNode)) p.tracks.ungroup(primaryNode.id); },
  };
  useEffect(() => {
    // A shows/hides keyframe lanes of the selected tracks; ⌘G / ⇧⌘G stack and unstack them.
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
      if (key === 'a' && !command) shortcuts.current.automation();
      else if (key === 'g' && command) { event.preventDefault(); shortcuts.current[event.shiftKey ? 'ungroup' : 'group'](); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  useEffect(() => {
    const clear = () => { setDropTime(null); setDragId(null); };
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  const assetTime = (event: DragEvent): number | null => {
    if (disabled || !p.onAddAsset || !event.dataTransfer.types.includes(MODEL_DRAG_TYPE) || !scroller.current) return null;
    const rect = scroller.current.getBoundingClientRect();
    if (event.clientX < rect.left + labelWidth) return null;
    const at = (event.clientX - rect.left + scroller.current.scrollLeft - labelWidth - TIMELINE_LEAD) / laneWidth * span;
    return Math.max(0, Math.min(Math.max(0, p.duration - .001), event.altKey ? roundTime(at) : snapTime(at, steps.minor)));
  };

  const view: TimelineView = {
    span, end, time: p.time, steps, disabled, compact, text, selectedKey, selectKey, onSeek: p.onSeek, onEditNode: (id, edit) => { if (!disabled) p.tracks.edit(id, edit); },
    pct: time => `${time / span * 100}%`,
    laneTime: (event, lane, max) => {
      const rect = lane.getBoundingClientRect(), raw = Math.max(0, Math.min(max, (event.clientX - rect.left) / rect.width * span));
      return event.altKey ? roundTime(raw) : Math.min(max, snapTime(raw, steps.minor));
    },
  };
  const select = (event: MouseEvent, id: string) => {
    if (event.metaKey || event.ctrlKey) return p.onSelect(p.selectedIds.includes(id) ? p.selectedIds.filter(item => item !== id) : [...p.selectedIds, id]);
    const from = visible.findIndex(row => row.id === primary), to = visible.findIndex(row => row.id === id);
    if (event.shiftKey && from >= 0) return p.onSelect(visible.slice(Math.min(from, to), Math.max(from, to) + 1).map(row => row.id));
    if (!p.selectedIds.includes(id) || p.selectedIds.length > 1) p.onSelect([id]);
  };
  const drop = (targetId: string, place: DropPlace) => {
    const target = rows.find(row => row.id === targetId);
    if (!dragId || !target || dragId === targetId) return;
    if (place === 'inside') return p.tracks.move(dragId, { parent: targetId });
    if (place === 'before') return p.tracks.move(dragId, { parent: target.node.parent, before: targetId });
    const siblings = rows.filter(row => row.node.parent === target.node.parent && row.id !== dragId);
    p.tracks.move(dragId, { parent: target.node.parent, before: siblings[siblings.indexOf(target) + 1]?.id });
  };
  const gridStyle = { gridTemplateColumns: `${labelWidth}px ${laneWidth + TIMELINE_LEAD}px`, '--lead': `${TIMELINE_LEAD}px`, '--major': `${x(steps.major)}px`, '--minor': `${x(steps.minor)}px` } as CSSProperties;
  return <section className="scene-timeline" data-compact={compact || undefined} data-collapsed={height.collapsed || undefined} style={{ height: height.collapsed ? "auto" : height.size }} aria-label={text('时间轴', 'Timeline')}>
    <ScenePanelDivider panel="timeline" sizing={height} controls="scene-timeline-content" />
    <SceneTimelineToolbar collapsed={height.collapsed} text={text} time={p.time} duration={p.duration} end={end} loop={p.loop} playing={p.playing} disabled={disabled}
      onSeek={p.onSeek} onPlay={p.onPlay} onLoop={p.onLoop} onDuration={p.onDuration}
      interpolation={keyNode && selectedKey ? interpolationOf(keyNode, selectedKey) : null}
      onInterpolation={mode => !disabled && selectedKey && p.tracks.edit(selectedKey.nodeId, node => setInterpolation(node, selectedKey, mode))}
      onDeleteKey={() => { if (!disabled && selectedKey) p.tracks.edit(selectedKey.nodeId, node => unkeyAll(node, selectedKey.channels, selectedKey.time)); selectKey(null); }}
      canGroup={p.selectedIds.length > 0} canUngroup={!!primaryNode && isGroup(primaryNode)} onGroup={p.tracks.group} onUngroup={() => primary && p.tracks.ungroup(primary)}
      zoom={zoom} canZoomIn={canZoomIn} onZoom={zoomBy} />
    <div id="scene-timeline-content" className="scene-timeline-body" hidden={height.collapsed} data-asset-drop={dropTime !== null || undefined}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes(MODEL_DRAG_TYPE)) return;
        event.preventDefault();
        const time = assetTime(event); event.dataTransfer.dropEffect = time === null ? 'none' : 'copy'; setDropTime(time);
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTime(null); }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes(MODEL_DRAG_TYPE)) return;
        event.preventDefault(); event.stopPropagation(); setDropTime(null);
        const time = assetTime(event), id = event.dataTransfer.getData(MODEL_DRAG_TYPE);
        if (time !== null && id) p.onAddAsset?.(id, time);
      }}>
      <div className="scene-timeline-scroll" ref={scroller}>
        <TimelineContext.Provider value={view}>
          <div className="scene-timeline-grid" style={gridStyle}>
            <div className="scene-track-heading"><Text as="span" variant="bodyXs" fontWeight="semibold">{text('轨道', 'Tracks')}</Text><span className="text-xs text-muted-foreground">{p.content.instances.length}</span></div>
            <SceneTimelineRuler span={span} end={end} time={p.time} loop={p.loop} steps={steps} canResize={!disabled} text={text} onSeek={p.onSeek}
              onEnd={(time, commit) => { if (time !== null) return setEndDraft(time); if (commit && endDraft !== null && endDraft !== p.duration) p.onDuration(endDraft); setEndDraft(null); }} onDuration={p.onDuration} />
            {visible.length > 0 && <><i className="scene-timeline-outside" style={{ left: left(end) }} /><i className="scene-end-line" style={{ left: left(end) }} /><i className="scene-playhead" style={{ left: left(p.time) }} /></>}
            {dropTime !== null && <div className="scene-timeline-drop-hint" style={{ left: left(dropTime) }} role="status"><span>{text('添加于', 'Add at')} {regionTime(dropTime)}</span></div>}
            {visible.map(row => <SceneTrack key={row.id} row={row} name={p.nameOf(row.node)} clips={p.clips[row.id]} selected={p.selectedIds.includes(row.id)}
              kind={p.kindOf?.(row.node)} collapsed={collapsed.has(row.id)} automation={automationIds.has(row.id)} hiddenByParent={!!row.node.parent && hidden.has(row.node.parent)} draggable={!disabled}
              expandedParams={new Set((['position', 'rotation', 'scale'] as TransformGroup[]).filter(group => params.has(`${row.id}:${group}`)))}
              onParam={group => setParams(current => toggle(current, `${row.id}:${group}`))}
              onSelect={event => select(event, row.id)} onStack={() => setCollapsed(current => toggle(current, row.id))}
              onAutomation={() => toggleAutomation([row.id])} onRename={name => p.tracks.rename(row.id, name)}
              onDragStart={() => setDragId(row.id)} onDrop={place => { drop(row.id, place); setDragId(null); }}
              canDuplicate={!disabled}
              onDuplicate={isGroup(row.node) ? undefined : () => p.onDuplicate(row.id)}
              onDelete={selection => { if (!disabled) p.tracks.remove(selection && p.selectedIds.includes(row.id) ? p.selectedIds : [row.id]); }} />)}
          </div>
        </TimelineContext.Provider>
      </div>
      {!rows.length && <div className="scene-timeline-empty"><Text as="p" variant="bodyXs" tone="subdued" alignment="center">{text('拖入素材安排出场时间', 'Drop an asset to set its entrance')}</Text></div>}
    </div>
  </section>;
}
