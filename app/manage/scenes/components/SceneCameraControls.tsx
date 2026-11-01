"use client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/ui/typography";
import { Camera, Smartphone } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { SceneNumberField } from "./SceneFields";
import { DEFAULT_SCENE_CAMERA, MAP_SCENE_CAMERA, type SceneCameraSettings } from "./three-editor/spatial-reference";

/** Viewing controls stay outside scene content and its undo/save history. */
export function SceneCameraControls({ settings, onChange, onPreview, preview = false }: {
  settings: SceneCameraSettings; onChange: (value: SceneCameraSettings) => void; onPreview?: () => void; preview?: boolean;
}) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback((node: HTMLDivElement | null) => setContainer(node?.closest<HTMLElement>(".scene-workspace-theme") ?? null), []);
  const matches = (preset: SceneCameraSettings) => (Object.keys(preset) as (keyof SceneCameraSettings)[]).every(key => settings[key] === preset[key]);
  const preset = matches(DEFAULT_SCENE_CAMERA) ? "scene" : matches(MAP_SCENE_CAMERA) ? "map" : "custom";
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
        <div className="space-y-1.5"><Label htmlFor={`${id}-preset`}>{text("放置预设", "Placement preset")}</Label><select id={`${id}-preset`} className="scene-select w-full" value={preset} onChange={event => onChange({ ...(event.target.value === "map" ? MAP_SCENE_CAMERA : DEFAULT_SCENE_CAMERA) })}>
          <option value="scene">{text("场景二维码 · 同高，前方 2 米", "Scene QR · same height, 2 m ahead")}</option>
          <option value="map">{text("地图放置 · 下移 1.4 米", "Map · placed 1.4 m lower")}</option>
          {preset === "custom" && <option value="custom" disabled>{text("自定义视角", "Custom view")}</option>}
        </select></div>
        <div className="scene-field-grid">{fields.map(field => <div key={field.key} className="space-y-1.5"><Label htmlFor={`${id}-${field.key}`}>{field.label}</Label><SceneNumberField id={`${id}-${field.key}`} label={field.label} value={settings[field.key]} min={field.min} max={field.max} step={field.step} onCommit={value => onChange({ ...settings, [field.key]: value })} /></div>)}</div>
        <Text as="p" variant="bodySm" tone="subdued">{text("取景为估算值，实际视野因手机而异。", "Approximate framing; the field of view varies by phone.")}</Text>
        {onPreview && <Button variant="secondary" className="w-full" onClick={() => { setOpen(false); onPreview(); }}><Smartphone />{text("打开相机预览", "Open camera preview")}</Button>}
      </PopoverContent>
    </Popover>
  </div>;
}
