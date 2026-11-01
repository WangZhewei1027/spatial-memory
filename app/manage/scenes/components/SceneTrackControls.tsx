"use client";
import { Eye, EyeOff, Spline, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { isGroup, type SceneNode } from '@/lib/scene/hierarchy-authoring';
import { setNodeVisible } from '@/lib/scene/visibility';
import type { SceneTrackKind } from './scene-region';
import { mediaFor } from './scene-performance';

/** Track switches persist in the document; automation only reveals editing lanes. */
export function SceneTrackControls({ node, name, kind, automation, hiddenByParent, disabled, onAutomation, onEdit }: {
  node: SceneNode; name: string; kind: SceneTrackKind; automation: boolean; hiddenByParent?: boolean; disabled: boolean;
  onAutomation(): void; onEdit(edit: <N extends SceneNode>(node: N) => N): void;
}) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith('zh') ? zh : en;
  const instance = isGroup(node) ? undefined : node;
  const hasAudio = !!instance && (kind === 'audio' || kind === 'video');
  const muted = !!instance?.media?.muted;
  const muteLabel = text(`${muted ? '取消静音' : '静音'}：${name}`, `${muted ? 'Unmute' : 'Mute'}: ${name}`);
  const visibilityLabel = text(`${node.hidden ? '显示' : '隐藏'}：${name}`, `${node.hidden ? 'Show' : 'Hide'}: ${name}`);
  const automationLabel = text(automation ? '收起关键帧' : '展开关键帧', automation ? 'Hide keyframes' : 'Show keyframes');
  return <>
    <Button variant="ghost" size="icon" className={`size-6 scene-track-automation`} aria-pressed={automation} aria-label={automationLabel}
      title={`${automationLabel} (A)`} onClick={onAutomation}><Spline /></Button>
    {kind !== 'audio' && <Button variant="ghost" size="icon" className={`size-6 scene-track-visibility`} disabled={disabled} aria-pressed={!node.hidden} aria-label={visibilityLabel}
      title={hiddenByParent ? text('所属分组已隐藏；此开关保留对象自身的显示设置', 'Hidden by a parent group; this switch keeps the object’s own visibility setting') : visibilityLabel}
      onClick={() => onEdit(current => setNodeVisible(current, !!current.hidden))}>
      {node.hidden ? <EyeOff /> : <Eye />}
    </Button>}
    {hasAudio && <Button variant="ghost" size="icon" className={`size-6 scene-track-mute`} disabled={disabled} aria-pressed={muted} aria-label={muteLabel} title={muteLabel}
      onClick={() => onEdit(current => isGroup(current) ? current : { ...current, media: { ...mediaFor(current), muted: !current.media?.muted } })}>
      {muted ? <VolumeX /> : <Volume2 />}
    </Button>}
  </>;
}
