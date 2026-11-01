"use client";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Diamond } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/typography";
import { type AutomationChannel, type CompositionInstance, type TransformKeyframe } from "@/lib/scene/protocol";
import type { SceneNode } from "@/lib/scene/hierarchy-authoring";
import { editChannel, frameAt, keyAll, sampleChannel, unkeyAll, type TransformGroup } from "@/lib/scene/transform-authoring";
import { SceneNumberField } from "./SceneFields";
import { channelsOf, unitFactor } from "./timeline-keys";

type EditorProps = { time: number; disabled: boolean; onEdit: (edit: <N extends SceneNode>(node: N) => N) => void };

/** All add/remove controls live in the inspector's trailing column. */
function SceneKeyframeButton({ node, channels, label, time, disabled, onEdit }: EditorProps & { node: SceneNode; channels: readonly AutomationChannel[]; label: string }) {
  const { i18n } = useTranslation();
  const tracks: Partial<Record<AutomationChannel, TransformKeyframe[]>> = node.tracks ?? {};
  const count = channels.filter(channel => frameAt(tracks[channel], time) >= 0).length;
  const keyed = count === channels.length;
  const animated = channels.some(channel => tracks[channel]?.length);
  const action = i18n.language.startsWith("zh") ? `${keyed ? "移除" : "添加"}${label}关键帧` : `${keyed ? "Remove" : "Add"} ${label} keyframe`;
  return <Button variant="ghost" size="icon" className="scene-key-toggle size-8" disabled={disabled}
    data-animated={animated || undefined} aria-pressed={keyed ? true : count ? "mixed" : false} aria-label={action} title={action}
    onClick={() => onEdit(current => keyed ? unkeyAll(current, channels, time) : keyAll(current, channels, time))}>
    <Diamond aria-hidden="true" />
  </Button>;
}

export function SceneTransformField({ node, group, label, time, disabled, onEdit }: EditorProps & { node: SceneNode; group: TransformGroup; label: string }) {
  const factor = unitFactor(group), unit = group === "position" ? "m" : group === "rotation" ? "°" : "";
  return <div className="scene-transform-field">
    <div className="scene-parameter-heading"><Text as="span" variant="bodyXs">{label}{unit && <span className="scene-field-unit">{unit}</span>}</Text>
      <SceneKeyframeButton node={node} channels={channelsOf(group)} label={label} time={time} disabled={disabled} onEdit={onEdit} />
    </div>
    <div className="scene-transform-fields">{(["x", "y", "z"] as const).map(axis => <label key={axis}><span>{axis.toUpperCase()}</span>
      <SceneNumberField label={`${label} ${axis.toUpperCase()}`} value={sampleChannel(node, `${group}.${axis}`, time) * factor}
        exclusiveMin={group === "scale" ? 0 : undefined}
        step={group === "rotation" ? 1 : .1} disabled={disabled} onCommit={value => onEdit(current => editChannel(current, `${group}.${axis}`, time, value / factor))} />
    </label>)}</div>
  </div>;
}

export function SceneScalarField({ instance, channel, label, time, disabled, onEdit }: EditorProps & { instance: CompositionInstance; channel: "opacity" | "volume"; label: string }) {
  const id = useId();
  return <div className="scene-scalar-field">
    <Label htmlFor={id}>{label}</Label>
    <div className="scene-percent-field"><SceneNumberField id={id} label={`${label} %`} value={sampleChannel(instance, channel, time) * 100} min={0} max={100} step={1} disabled={disabled}
      onCommit={value => onEdit(current => editChannel(current, channel, time, value / 100))} /><span aria-hidden="true">%</span></div>
    <SceneKeyframeButton node={instance} channels={[channel]} label={label} time={time} disabled={disabled} onEdit={onEdit} />
  </div>;
}
