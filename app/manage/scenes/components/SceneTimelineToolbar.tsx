"use client";
import { FolderInput, FolderOutput, Pause, Play, Repeat, SkipBack, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SceneNumberField } from './SceneFields';
import type { Interpolation } from './timeline-keys';

export interface SceneTimelineToolbarProps {
  text(zh: string, en: string): string;
  collapsed: boolean;
  time: number; duration: number; end: number; loop: boolean; playing: boolean; disabled: boolean;
  onSeek(time: number): void; onPlay(): void; onLoop(loop: boolean): void; onDuration(time: number): void;
  interpolation: Interpolation | null; onInterpolation(mode: Exclude<Interpolation, 'custom'>): void; onDeleteKey(): void;
  canGroup: boolean; canUngroup: boolean; onGroup(): void; onUngroup(): void;
  zoom: number; canZoomIn: boolean; onZoom(factor: number): void;
}
const Divider = () => <span className="mx-1 h-5 border-l" aria-hidden="true" />;

/** Transport, scene length, key interpolation, track stacking and zoom. */
export function SceneTimelineToolbar(p: SceneTimelineToolbarProps) {
  const { text } = p;
  return <div className="scene-timeline-toolbar">
    <Button variant="ghost" size="icon" className="size-8" aria-label={text('回到起点', 'Go to start')} onClick={() => p.onSeek(0)}><SkipBack /></Button>
    <Button variant="secondary" size="icon" className="size-8" aria-label={text(p.playing ? '暂停' : '播放', p.playing ? 'Pause' : 'Play')} onClick={p.onPlay}>{p.playing ? <Pause /> : <Play />}</Button>
    <Button variant="ghost" size="icon" className="size-8 aria-pressed:bg-secondary aria-pressed:text-foreground" aria-label={text('循环播放', 'Loop playback')} aria-pressed={p.loop} disabled={p.disabled} onClick={() => p.onLoop(!p.loop)}><Repeat /></Button>
    <div className="w-20"><SceneNumberField label={text('播放时间（秒）', 'Time (seconds)')} value={p.time} min={0} max={p.duration} step={.1} onCommit={p.onSeek} /></div>
    <span className="text-xs text-muted-foreground">/</span>
    <div className="w-20"><SceneNumberField label={text('场景时长（秒）', 'Duration (seconds)')} value={p.end} exclusiveMin={0} step={1} disabled={p.disabled} onCommit={p.onDuration} /></div>
    <span className="text-xs text-muted-foreground">s</span>
    {!p.collapsed && <>
    {p.canGroup && <><Divider /><Button variant="ghost" size="sm" className="h-8" disabled={p.disabled} title="Ctrl / ⌘ G" onClick={p.onGroup}><FolderInput />{text('编组', 'Group')}</Button></>}
    {p.canUngroup && <Button variant="ghost" size="sm" className="h-8" disabled={p.disabled} title="Ctrl / ⌘ Shift G" onClick={p.onUngroup}><FolderOutput />{text('取消编组', 'Ungroup')}</Button>}
    <div className="ml-auto flex items-center gap-1">
      {p.interpolation && <>
        <select className="scene-select" aria-label={text('关键帧插值', 'Keyframe interpolation')} disabled={p.disabled} value={p.interpolation}
          onChange={e => p.onInterpolation(e.target.value as Exclude<Interpolation, 'custom'>)}>
          {p.interpolation === 'custom' && <option value="custom" disabled>{text('原有曲线', 'Existing curve')}</option>}
          <option value="linear">{text('线性', 'Linear')}</option><option value="ease">{text('缓动', 'Ease')}</option><option value="hold">{text('保持', 'Hold')}</option>
        </select>
        <Button variant="ghost" size="icon" className="size-8" disabled={p.disabled} aria-label={text('删除选中关键帧', 'Delete selected keyframe')} onClick={p.onDeleteKey}><Trash2 /></Button>
        <Divider />
      </>}
      <Button variant="ghost" size="icon" className="size-8" aria-label={text('缩小时间轴', 'Zoom out')} disabled={p.zoom <= 1} onClick={() => p.onZoom(1 / 1.5)}><ZoomOut /></Button>
      <Button variant="ghost" size="icon" className="size-8" aria-label={text('放大时间轴', 'Zoom in')} disabled={!p.canZoomIn} onClick={() => p.onZoom(1.5)}><ZoomIn /></Button>
    </div>
    </>}
  </div>;
}
