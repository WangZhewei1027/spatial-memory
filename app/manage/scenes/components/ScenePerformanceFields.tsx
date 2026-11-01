"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CompositionInstance } from "@/lib/scene/protocol";
import type { SceneNode } from "@/lib/scene/hierarchy-authoring";
import { SceneInspectorSection } from "./SceneInspectorSection";
import { SceneScalarField } from "./SceneAutomationFields";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { SceneNumberField, SceneOptionalNumberField } from "./SceneFields";
import { MIN_REGION_DURATION } from "./scene-region";
import { mediaFor, timingFor } from "./scene-performance";

export function SceneTimingFields({ instance, duration, disabled, onChange }: {
  instance: CompositionInstance; duration: number; disabled: boolean; onChange: (patch: Partial<CompositionInstance>) => void;
}) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const timing = timingFor(instance, duration), end = timing.endSeconds ?? duration;
  const change = (patch: Partial<typeof timing>) => {
    const next = { ...timing, ...patch };
    const length = Math.max(0, (next.endSeconds ?? duration) - next.startSeconds);
    next.fadeInSeconds = Math.min(next.fadeInSeconds, length);
    next.fadeOutSeconds = Math.min(next.fadeOutSeconds, length);
    onChange({ timing: next });
  };
  return <SceneInspectorSection title={text("出入场", "Timing")}>
    <div className="scene-field-grid">
      <label>{text("出现 · 秒", "In · seconds")}<SceneNumberField label={text("出现时间", "Appearance time")} value={timing.startSeconds} min={0} max={Math.max(0, end - MIN_REGION_DURATION)} step={.1} disabled={disabled} onCommit={startSeconds => change({ startSeconds })} /></label>
      <label>{text("消失 · 秒", "Out · seconds")}<SceneNumberField label={text("消失时间", "Disappearance time")} value={end} min={Math.min(600, timing.startSeconds + MIN_REGION_DURATION)} max={600} step={.1} disabled={disabled || timing.startSeconds >= 600} onCommit={endSeconds => change({ endSeconds })} /></label>
    </div>
  </SceneInspectorSection>;
}

export function SceneMediaFields({ instance, time, disabled, onChange, onEdit }: {
  instance: CompositionInstance; time: number; disabled: boolean; onChange: (patch: Partial<CompositionInstance>) => void;
  onEdit: (edit: <N extends SceneNode>(node: N) => N) => void;
}) {
  const { i18n } = useTranslation(), id = useId();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const media = mediaFor(instance);
  const change = (patch: Partial<typeof media>) => onChange({ media: { ...media, ...patch } });
  return <SceneInspectorSection title={text("媒体播放", "Playback")}>
    <SceneScalarField instance={instance} channel="volume" time={time} disabled={disabled} label={text("音量", "Volume")} onEdit={onEdit} />
    <div className="scene-field-grid">
      <label>{text("源起点 · 秒", "Source in · seconds")}<SceneNumberField label={text("媒体截取起点", "Media trim start")} value={media.trimStartSeconds} min={0} max={Math.max(0, (media.trimEndSeconds ?? 86400) - MIN_REGION_DURATION)} disabled={disabled} onCommit={trimStartSeconds => change({ trimStartSeconds })} /></label>
      <label>{text("源终点 · 秒", "Source out · seconds")}<SceneOptionalNumberField label={text("媒体截取终点", "Media trim end")} value={media.trimEndSeconds} min={Math.min(86400, media.trimStartSeconds + MIN_REGION_DURATION)} max={86400} disabled={disabled || media.trimStartSeconds >= 86400} placeholder={text("文件结尾", "File end")} onCommit={trimEndSeconds => change({ trimEndSeconds })} /></label>
      <label>{text("播放速度", "Playback speed")}<SceneNumberField label={text("播放速度", "Playback speed")} value={media.playbackRate} min={.1} max={4} disabled={disabled} onCommit={playbackRate => change({ playbackRate })} /></label>
    </div>
    <div className="flex flex-wrap gap-4"><Label htmlFor={`${id}-loop`} className="flex items-center gap-2"><Checkbox id={`${id}-loop`} checked={media.loop} disabled={disabled} onCheckedChange={checked => change({ loop: checked === true })} />{text("循环片段", "Loop clip")}</Label></div>
  </SceneInspectorSection>;
}

export function SceneTextFields({ instance, disabled, onChange }: {
  instance: CompositionInstance; disabled: boolean; onChange: (patch: Partial<CompositionInstance>) => void;
}) {
  const { i18n } = useTranslation(), id = useId();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const value = instance.text!;
  const [draft, setDraft] = useState(value.content);
  useEffect(() => setDraft(value.content), [value.content]);
  const change = (patch: Partial<typeof value>) => onChange({ text: { ...value, ...patch } });
  return <SceneInspectorSection title={text("文字", "Text")}>
    <Textarea aria-label={text("文字内容", "Text content")} id={`${id}-content`} value={draft} maxLength={4000} rows={3} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft.trim()) change({ content: draft }); else setDraft(value.content); }} />
    <div className="scene-field-grid">
      <label>{text("字号 · 米", "Font size · m")}<SceneNumberField label={text("文字字号", "Text font size")} value={value.fontSize} min={.02} max={5} step={.05} disabled={disabled} onCommit={fontSize => change({ fontSize })} /></label>
      <label>{text("排版宽度 · 米", "Text width · m")}<SceneNumberField label={text("文字宽度", "Text width")} value={value.width} min={.1} max={20} disabled={disabled} onCommit={width => change({ width })} /></label>
      <label>{text("文字颜色", "Text color")}<Input type="color" aria-label={text("文字颜色", "Text color")} value={value.color} disabled={disabled} onChange={event => change({ color: event.target.value })} /></label>
      <label>{text("对齐", "Alignment")}<select className="scene-select w-full" aria-label={text("文字对齐", "Text alignment")} value={value.align} disabled={disabled} onChange={event => change({ align: event.target.value as "left" | "center" | "right" })}><option value="left">{text("左对齐", "Left")}</option><option value="center">{text("居中", "Center")}</option><option value="right">{text("右对齐", "Right")}</option></select></label>
    </div>
  </SceneInspectorSection>;
}

export function SceneSpatialAudioFields({ instance, disabled, onChange }: {
  instance: CompositionInstance; disabled: boolean; onChange: (patch: Partial<CompositionInstance>) => void;
}) {
  const { i18n } = useTranslation(), id = useId();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const media = mediaFor(instance);
  const spatial = media.spatial ?? { enabled: false, refDistance: 1, maxDistance: 30, rolloffFactor: 1 };
  const change = (patch: Partial<typeof spatial>) => onChange({ media: { ...media, spatial: { ...spatial, ...patch } } });
  return <SceneInspectorSection title={text("空间音频", "Spatial audio")} defaultOpen={spatial.enabled}>
    <Label htmlFor={`${id}-enabled`} className="flex min-h-8 items-center justify-between gap-2" title={text("Web 从虚拟相机的位置试听距离和左右声像。", "Web previews distance and stereo position from the virtual camera.")}>{text("按距离衰减", "Distance attenuation")}
      <Checkbox id={`${id}-enabled`} checked={spatial.enabled} disabled={disabled} onCheckedChange={checked => change({ enabled: checked === true })} />
    </Label>
    {spatial.enabled && <><div className="scene-field-grid">
      <label>{text("原音距离 · 米", "Full volume · m")}<SceneNumberField label={text("原音距离", "Full-volume distance")} value={spatial.refDistance} min={.1} max={Math.min(100, spatial.maxDistance)} disabled={disabled} onCommit={refDistance => change({ refDistance })} /></label>
      <label>{text("衰减边界 · 米", "Rolloff limit · m")}<SceneNumberField label={text("衰减边界", "Rolloff limit")} value={spatial.maxDistance} min={spatial.refDistance} max={1000} step={1} disabled={disabled} onCommit={maxDistance => change({ maxDistance })} /></label>
      <label>{text("衰减强度", "Distance rolloff")}<SceneNumberField label={text("距离衰减强度", "Distance rolloff")} value={spatial.rolloffFactor} min={0} max={10} step={.1} disabled={disabled} onCommit={rolloffFactor => change({ rolloffFactor })} /></label>
    </div></>}
  </SceneInspectorSection>;
}
