"use client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/ui/typography";
import { Camera, Smartphone } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { SceneNumberField } from "./SceneFields";
import { DEFAULT_SCENE_CAMERA, type SceneCameraSettings } from "./three-editor/spatial-reference";

/** Position edits join scene history; lens and pitch only change the preview. */
export function SceneCameraControls({ settings, onChange, onPreview, preview = false, positionDisabled = false }: {
  settings: SceneCameraSettings; onChange: (value: SceneCameraSettings) => void; onPreview?: () => void; preview?: boolean; positionDisabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback((node: HTMLDivElement | null) => setContainer(node?.closest<HTMLElement>(".scene-workspace-theme") ?? null), []);
  const fields: { key: keyof SceneCameraSettings; label: string; min?: number; max?: number; step: number }[] = [
    { key: "distance", label: text("水平距离 · 米", "Distance · m"), min: Number.MIN_VALUE, step: .1 },
    { key: "height", label: text("高度 · 米", "Height · m"),  step: .1 },
    { key: "yaw", label: text("水平角 · 度", "Orbit · °"),  step: 1 },
    { key: "pitch", label: text("仰角 · 度", "Pitch · °"),  step: 1 },
    { key: "fov", label: text("视场角 · 度", "Field of view · °"), min: Number.MIN_VALUE, max: 179.999, step: 1 },
  ];
  return <div ref={anchorRef} className="scene-camera-controls">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant={open ? "secondary" : "ghost"} size="icon" className={preview ? "size-7" : "size-8"} title={text("虚拟相机", "Virtual camera")} aria-label={text("虚拟相机", "Virtual camera")}><Camera /></Button></PopoverTrigger>
      <PopoverContent portalContainer={container} side="bottom" align="end" className="scene-camera-popover" aria-label={text("虚拟相机设置", "Virtual camera settings")}>
        <Text as="h2" variant="bodySm" fontWeight="semibold">{text("虚拟相机", "Virtual camera")}</Text>
        <Button variant="secondary" className="w-full" disabled={positionDisabled} onClick={() => onChange({ ...settings, distance: DEFAULT_SCENE_CAMERA.distance, height: DEFAULT_SCENE_CAMERA.height, yaw: DEFAULT_SCENE_CAMERA.yaw })}>{text("恢复默认位置", "Reset position")}</Button>
        <div className="scene-field-grid">{fields.map(field => <div key={field.key} className="space-y-1.5"><Label htmlFor={`${id}-${field.key}`}>{field.label}</Label><SceneNumberField id={`${id}-${field.key}`} label={field.label} value={settings[field.key]} disabled={positionDisabled && field.key !== "pitch" && field.key !== "fov"} min={field.min} max={field.max} step={field.step} onCommit={value => onChange({ ...settings, [field.key]: value })} /></div>)}</div>
        <Text as="p" variant="bodySm" tone="subdued">{text("位置随场景保存并同步到小程序；俯仰和视场角仅用于预览，实际取景由手机决定。", "Position is saved with the scene and synced to the mini program. Pitch and field of view are preview settings; the phone controls actual framing.")}</Text>
        {onPreview && <Button variant="secondary" className="w-full" onClick={() => { setOpen(false); onPreview(); }}><Smartphone />{text("打开相机预览", "Open camera preview")}</Button>}
      </PopoverContent>
    </Popover>
  </div>;
}
