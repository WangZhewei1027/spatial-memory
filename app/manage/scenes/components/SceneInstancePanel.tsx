"use client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/typography";
import { COMPOSITION_LIMITS, type CompositionInstance } from "@/lib/scene/protocol";
import { isGroup, type SceneNode } from "@/lib/scene/hierarchy-authoring";
import { FolderOutput, MousePointer2, X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SceneNumberField } from "./SceneFields";
import { SceneResourceSource } from "./SceneResourceSource";
import { SceneMediaFields, SceneSpatialAudioFields, SceneTextFields, SceneTimingFields } from "./ScenePerformanceFields";
import { SceneScalarField, SceneTransformField } from "./SceneAutomationFields";
import { SceneInspectorSection } from "./SceneInspectorSection";
import type { ClipInfo, SceneResource } from "./types";

export interface SceneInstancePanelProps {
  node?: SceneNode; name: string; resource?: SceneResource; assetHref: string; clips?: ClipInfo[];
  readOnly: boolean; playing: boolean; time: number; duration: number;
  hiddenByParent: boolean;
  onChange: (patch: Partial<CompositionInstance>) => void;
  onEdit: (edit: <N extends SceneNode>(node: N) => N) => void;
  onRename: (name: string) => void; onClose: () => void;
  onAnimation: (animation: CompositionInstance["animation"]) => void; onUngroup: () => void;
}
/** The selection inspector owns source, visibility, media/text and spatial parameters. */
export function SceneInstancePanel(props: SceneInstancePanelProps) {
  const { node, name, resource, assetHref, clips, readOnly, playing, onAnimation, onUngroup } = props;
  const { t, i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const id = useId();
  const instance = node && !isGroup(node) ? node : undefined;
  const animation = instance?.animation, disabled = readOnly || playing;
  const audio = resource?.kind === "audio";
  return <section className="scene-inspector" aria-label={text("对象属性", "Object properties")}>
    <div className="scene-panel-heading"><Text as="h2" variant="bodySm" fontWeight="semibold">{text("对象属性", "Inspector")}</Text><Button className="ml-auto size-8" size="icon" variant="ghost" aria-label={text("关闭属性", "Close inspector")} onClick={props.onClose}><X /></Button></div>
    <div className="scene-inspector-content">
    {!node ? <div className="flex items-start gap-2"><MousePointer2 className="mt-1 size-4 shrink-0 text-muted-foreground" /><Text as="p" variant="bodySm" tone="subdued">{text("在舞台或时间轴选择对象，调整空间、出入场和播放参数。", "Select an object on the stage or timeline to edit its position, timing and playback.")}</Text></div> : <>
      <div className="scene-inspector-identity"><Label htmlFor={`${id}-name`}>{text("轨道名称", "Track name")}</Label><Input key={`${node.id}-${name}`} id={`${id}-name`} defaultValue={name} maxLength={COMPOSITION_LIMITS.maxNameLength} disabled={disabled} onBlur={event => props.onRename(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        {resource && <SceneResourceSource resource={resource} assetHref={assetHref} />}
        {props.hiddenByParent && <Text as="p" variant="bodyXs" tone="subdued">{text("所属分组已隐藏", "Hidden by a parent group")}</Text>}
      </div>
      <SceneInspectorSection title={audio ? text("空间位置", "Position") : isGroup(node) ? text("空间变换", "Transform") : text("空间与外观", "Transform & appearance")}>
        {(audio ? ["position"] as const : ["position", "rotation", "scale"] as const).map(group => <SceneTransformField key={group} node={node} group={group}
          label={group === "position" ? text("位置", "Position") : group === "rotation" ? text("旋转", "Rotation") : text("缩放", "Scale")}
          time={props.time} disabled={disabled} onEdit={props.onEdit} />)}
        {instance && !audio && <SceneScalarField instance={instance} channel="opacity" label={text("不透明度", "Opacity")} time={props.time} disabled={disabled} onEdit={props.onEdit} />}
      </SceneInspectorSection>
      {instance?.text && <SceneTextFields instance={instance} disabled={disabled} onChange={props.onChange} />}
      {instance && <SceneTimingFields instance={instance} duration={props.duration} disabled={disabled} onChange={props.onChange} />}
      {instance && (audio || resource?.kind === "video") && <><SceneMediaFields instance={instance} time={props.time} disabled={disabled} onChange={props.onChange} onEdit={props.onEdit} /><SceneSpatialAudioFields instance={instance} disabled={disabled} onChange={props.onChange} /></>}
      {instance && !instance.text && (animation || !!clips?.length) && (!resource?.kind || resource.kind === "model") && <SceneInspectorSection title={text("模型动画", "Model animation")} defaultOpen={!!animation}>
        <Label htmlFor={`${id}-clip`}>{t("sceneEditor.animationClip")}</Label>
        <select id={`${id}-clip`} className="scene-select w-full" disabled={disabled} value={animation ? String(animation.clipIndex ?? clips?.findIndex(clip => clip.name === animation.clipName)) : "none"} onChange={event => onAnimation(event.target.value === "none" ? null : { clipIndex: Number(event.target.value), startSeconds: animation?.startSeconds ?? instance.timing?.startSeconds ?? 0, loop: animation?.loop ?? false })}>
          <option value="none">{t("sceneEditor.noAnimation")}</option>{clips?.map((clip, index) => <option key={index} value={index}>{clip.name || `Clip ${index + 1}`}</option>)}
        </select>
        {animation && <><label className="scene-field-label">{text("动画起点 · 秒", "Animation start · seconds")}<SceneNumberField label={t("sceneEditor.clipStart")} value={animation.startSeconds} min={0} max={600} disabled={disabled} onCommit={startSeconds => onAnimation({ ...animation, startSeconds })} /></label><Label htmlFor={`${id}-loop`} className="flex min-h-8 items-center gap-2"><Checkbox id={`${id}-loop`} disabled={disabled} checked={animation.loop} onCheckedChange={checked => onAnimation({ ...animation, loop: checked === true })} />{t("sceneEditor.clipLoop")}</Label></>}
      </SceneInspectorSection>}
    </>}
    </div>
      {node && isGroup(node) && !readOnly && <div className="scene-inspector-actions">
        <Button variant="outline" size="sm" disabled={disabled} onClick={onUngroup}><FolderOutput />{text("取消编组", "Ungroup")}</Button>
      </div>}
  </section>;
}
