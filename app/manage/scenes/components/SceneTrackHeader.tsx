"use client";
import { useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { Box, ChevronRight, Copy, Film, Folder, FolderOpen, ImageIcon, Music2, Trash2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TrackRow } from '@/lib/scene/hierarchy-authoring';
import { useTimeline } from './timeline-context';
import type { SceneTrackKind } from './scene-region';
import { MODEL_DRAG_TYPE } from '@/lib/scene/editor-interactions';
import { SceneTrackControls } from './SceneTrackControls';

export type DropPlace = 'before' | 'after' | 'inside';
export interface SceneTrackHeaderProps {
  row: TrackRow; name: string; kind?: SceneTrackKind; selected: boolean; collapsed: boolean; automation: boolean; draggable: boolean;
  onSelect(event: MouseEvent): void; onStack(): void; onAutomation(): void; onRename(name: string): void;
  onDragStart(): void; onDrop(place: DropPlace): void; onDelete(selection: boolean): void;
  canDuplicate: boolean; onDuplicate?: () => void; hiddenByParent: boolean;
}
const placeAt = (event: DragEvent<HTMLElement>, group: boolean): DropPlace => {
  const rect = event.currentTarget.getBoundingClientRect(), y = (event.clientY - rect.top) / rect.height;
  return group ? (y < .3 ? 'before' : y > .7 ? 'after' : 'inside') : (y < .5 ? 'before' : 'after');
};

/** Track header: Logic-style name cell where tracks are selected, renamed, reordered and stacked. */
export function SceneTrackHeader(p: SceneTrackHeaderProps) {
  const view = useTimeline();
  const [editing, setEditing] = useState(false);
  // Escape unmounts the field; a blur fired during removal must not commit the draft.
  const cancelled = useRef(false);
  const [drop, setDrop] = useState<DropPlace | null>(null);
  const group = p.row.kind === 'group';
  const copyLabel = view.text(`复制轨道：${p.name}`, `Duplicate track: ${p.name}`);
  const deleteLabel = view.text(`${group ? '删除分组及成员' : '删除轨道'}：${p.name}`, `${group ? 'Delete group and members' : 'Delete track'}: ${p.name}`);
  const Icon = group ? (p.collapsed ? Folder : FolderOpen) : { model: Box, image: ImageIcon, audio: Music2, video: Film, text: Type, group: Folder }[p.kind ?? 'model'];
  const finish = (value: string | null) => {
    if (cancelled.current) return;
    cancelled.current = value === null; setEditing(false);
    if (value !== null && value.trim() !== p.name) p.onRename(value);
  };
  const rename = () => { cancelled.current = false; setEditing(true); };
  return <div className="scene-track-heading-cell" style={{ '--depth': p.row.depth } as CSSProperties} data-selected={p.selected || undefined} data-hidden={p.row.node.hidden || p.hiddenByParent || undefined} data-drop={drop ?? undefined}
    draggable={p.draggable && !editing} tabIndex={0} role="button" aria-pressed={p.selected}
    aria-label={view.text(`${group ? '分组' : '轨道'}：${p.name}`, `${group ? 'Group' : 'Track'}: ${p.name}`)}
    onClick={p.onSelect}
    onKeyDown={e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter') { e.preventDefault(); if (p.draggable) rename(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && p.draggable) { e.preventDefault(); p.onDelete(true); }
    }}
    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.row.id); p.onDragStart(); }}
    onDragOver={e => { if (!p.draggable || e.dataTransfer.types.includes(MODEL_DRAG_TYPE)) return; e.preventDefault(); setDrop(placeAt(e, group)); }}
    onDragLeave={() => setDrop(null)}
    onDrop={e => { if (e.dataTransfer.types.includes(MODEL_DRAG_TYPE)) return; e.preventDefault(); e.stopPropagation(); setDrop(null); if (p.draggable) p.onDrop(placeAt(e, group)); }}>
    {group ? <button type="button" className="scene-stack-toggle" aria-expanded={!p.collapsed} onClick={e => { e.stopPropagation(); p.onStack(); }}
      aria-label={view.text(p.collapsed ? '展开分组' : '收起分组', p.collapsed ? 'Expand group' : 'Collapse group')}><ChevronRight aria-hidden="true" /></button> : <span className="scene-stack-spacer" />}
    <Icon className="scene-track-icon" aria-hidden="true" />
    {editing ? <Input autoFocus defaultValue={p.name} aria-label={view.text('轨道名称', 'Track name')} className="h-6 min-w-0 flex-1 px-1.5 shadow-none"
      onClick={e => e.stopPropagation()} onBlur={e => finish(e.currentTarget.value)}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') finish(null); }} />
      : <span className="scene-track-name" title={p.name} onDoubleClick={e => { e.stopPropagation(); if (p.draggable) rename(); }}>{p.name}</span>}
    {group && p.collapsed && <span className="scene-track-count">{p.row.children}</span>}
    <div className="scene-track-actions" draggable onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}>
    <SceneTrackControls node={p.row.node} name={p.name} kind={p.kind ?? (group ? 'group' : 'model')} automation={p.automation} hiddenByParent={p.hiddenByParent}
      disabled={view.disabled} onAutomation={p.onAutomation} onEdit={edit => view.onEditNode(p.row.id, edit)} />
    {p.onDuplicate && <Button variant="ghost" size="icon" className="size-6 scene-track-copy" disabled={view.disabled || !p.canDuplicate} aria-label={copyLabel}
      title={!view.disabled && !p.canDuplicate ? view.text('轨道数量已达上限', 'Track limit reached') : copyLabel} onClick={p.onDuplicate}><Copy /></Button>}
    <Button variant="ghost" size="icon" className="size-6 scene-track-delete" disabled={view.disabled} aria-label={deleteLabel} title={deleteLabel} onClick={() => p.onDelete(false)}><Trash2 /></Button>
    </div>
  </div>;
}
