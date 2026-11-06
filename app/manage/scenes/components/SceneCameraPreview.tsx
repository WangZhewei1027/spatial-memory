"use client";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { X } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { SceneCameraControls } from "./SceneCameraControls";
import type { SceneCameraSettings } from "./three-editor/spatial-reference";

/** A transparent window into the editor renderer's second camera, using the same playback. */
export function SceneCameraPreview({ open, frameRef, settings, onChange, onClose, positionDisabled }: {
  open: boolean; frameRef: RefObject<HTMLDivElement | null>; settings: SceneCameraSettings;
  onChange: (value: SceneCameraSettings) => void; onClose: () => void; positionDisabled: boolean;
}) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  return <section id="scene-camera-preview" className="scene-preview-island" hidden={!open} aria-label={text("相机预览", "Camera preview")}>
    <div className="scene-preview-heading">
      <Text as="h2" variant="bodyXs" fontWeight="semibold" truncate className="min-w-0 flex-1">{text("相机预览", "Camera preview")}</Text>
      <SceneCameraControls settings={settings} onChange={onChange} positionDisabled={positionDisabled} />
      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onClose} title={text("关闭相机预览", "Close camera preview")} aria-label={text("关闭相机预览", "Close camera preview")}><X /></Button>
    </div>
    <div className="scene-preview-view">
      <div className="scene-preview-matte scene-preview-matte-top" aria-hidden="true" />
      <div className="scene-preview-matte scene-preview-matte-left" aria-hidden="true" />
      <div ref={frameRef} className="scene-preview-frame" aria-label={text("9:16 近似取景", "9:16 approximate framing")} />
      <div className="scene-preview-matte scene-preview-matte-right" aria-hidden="true" />
      <div className="scene-preview-matte scene-preview-matte-bottom" aria-hidden="true" />
    </div>

  </section>;
}
