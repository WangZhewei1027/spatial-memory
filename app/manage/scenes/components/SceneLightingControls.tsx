"use client";
import { useCallback, useId, useState } from "react";
import { Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { DEFAULT_SCENE_LIGHTING, type SceneLighting } from "@/packages/scene-lighting";
import { SceneNumberField } from "./SceneFields";

export function SceneLightingControls({ settings = DEFAULT_SCENE_LIGHTING, disabled, onChange }: {
  settings?: Readonly<SceneLighting>; disabled: boolean; onChange(settings: SceneLighting): void;
}) {
  const { i18n } = useTranslation(), id = useId();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const [open, setOpen] = useState(false), [container, setContainer] = useState<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLDivElement | null) => setContainer(node?.closest<HTMLElement>(".scene-workspace-theme") ?? null), []);
  const change = (patch: Partial<SceneLighting>) => onChange({ ...settings, ...patch });
  const number = (key: keyof SceneLighting, label: string, min: number, max: number, step = .1) => <div className="space-y-1.5">
    <Label htmlFor={`${id}-${key}`}>{label}</Label><SceneNumberField id={`${id}-${key}`} label={label} value={Number((settings[key] as number).toFixed(2))} min={min} max={max} step={step} disabled={disabled} onCommit={value => change({ [key]: value })} />
  </div>;
  const color = (key: "ambientColor" | "directionalColor", label: string) => <div className="space-y-1.5">
    <Label htmlFor={`${id}-${key}`}>{label}</Label><Input id={`${id}-${key}`} aria-label={label} type="color" value={settings[key]} disabled={disabled} className="w-full p-1" onChange={event => change({ [key]: event.target.value })} />
  </div>;
  return <div ref={anchor}>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant={open ? "secondary" : "ghost"} size="icon" className="size-7" title={text("灯光与环境", "Lighting and environment")} aria-label={text("灯光与环境", "Lighting and environment")}><Sun /></Button></PopoverTrigger>
      <PopoverContent portalContainer={container} side="bottom" align="end" className="scene-camera-popover max-h-[min(36rem,80vh)] overflow-y-auto" aria-label={text("灯光与环境设置", "Lighting and environment settings")}>
        <Text as="h2" variant="bodySm" fontWeight="semibold">{text("灯光与环境", "Lighting and environment")}</Text>
        <div className="scene-field-grid">
          {number("ambientIntensity", text("环境光强度", "Ambient intensity"), 0, 10)}
          {color("ambientColor", text("环境光颜色", "Ambient color"))}
          {number("directionalIntensity", text("主光强度", "Key light intensity"), 0, 10)}
          {color("directionalColor", text("主光颜色", "Key light color"))}
          {number("azimuth", text("主光水平角 · 度", "Key azimuth · °"), -180, 180, 1)}
          {number("elevation", text("主光高度角 · 度", "Key elevation · °"), -90, 90, 1)}
        </div>
        <div className="space-y-1.5"><Label htmlFor={`${id}-environment`}>{text("反射环境", "Reflection environment")}</Label>
          <Select value={settings.environment} disabled={disabled} onValueChange={(value: SceneLighting["environment"]) => change({ environment: value })}>
            <SelectTrigger id={`${id}-environment`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="studio">{text("柔光摄影棚", "Soft studio")}</SelectItem><SelectItem value="none">{text("无环境贴图", "No environment map")}</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="scene-field-grid">
          {number("environmentIntensity", text("反射强度", "Reflection intensity"), 0, 5)}
          {number("environmentRotation", text("环境旋转 · 度", "Environment rotation · °"), -180, 180, 1)}
        </div>
        <Text as="p" variant="bodySm" tone="subdued">{text("设置随场景保存，并同步到小程序。灯光方向相对场景原点。", "Saved with the scene and synced to the mini program. Light direction is relative to the scene origin.")}</Text>
        <Button variant="secondary" className="w-full" disabled={disabled} onClick={() => onChange({ ...DEFAULT_SCENE_LIGHTING })}>{text("恢复默认灯光", "Reset lighting")}</Button>
      </PopoverContent>
    </Popover>
  </div>;
}
