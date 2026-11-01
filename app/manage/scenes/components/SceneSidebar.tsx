"use client";
import { Button } from "@/components/ui/button";
import { LocateFixed, Maximize } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { SceneCameraControls } from "./SceneCameraControls";
import { SceneGizmosMenu } from "./SceneGizmosMenu";
import type { SceneCameraSettings } from "./three-editor/spatial-reference";

/** Floating tool island; the native transform controls keep their upstream behavior. */
export function SceneSidebar({ nativeToolsRef, shadingRef, grid, labels, onGrid, onLabels, onFit, onOrigin, cameraSettings, onCameraChange, onPreview, positionDisabled }: {
  nativeToolsRef: RefObject<HTMLDivElement | null>; grid: boolean; onGrid: () => void; onFit: () => void;
  shadingRef: RefObject<HTMLDivElement | null>;
  labels: boolean; onLabels: () => void;
  onOrigin: () => void; cameraSettings: SceneCameraSettings; onCameraChange: (value: SceneCameraSettings) => void; onPreview: () => void; positionDisabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  return <section className="scene-tool-island" aria-label={i18n.language.startsWith("zh") ? "舞台工具" : "Stage tools"}>
    <div className="scene-view-strip">
      <div ref={shadingRef} className="scene-shading-control" />
      <SceneGizmosMenu grid={grid} labels={labels} onGrid={onGrid} onLabels={onLabels} />
      <div className="scene-view-actions" role="group" aria-label={text("视角与相机", "View and camera")}>
        <Button size="icon" className="size-8" variant="ghost" title={`${t("sceneEditor.fit")} (F)`} aria-label={t("sceneEditor.fit")} onClick={onFit}><Maximize /></Button>
        <Button size="icon" className="size-8" variant="ghost" title={i18n.language.startsWith("zh") ? "回到原点" : "Focus origin"} aria-label={i18n.language.startsWith("zh") ? "回到原点" : "Focus origin"} onClick={onOrigin}><LocateFixed /></Button>
        <SceneCameraControls settings={cameraSettings} onChange={onCameraChange} positionDisabled={positionDisabled} onPreview={onPreview} />
      </div>
    </div>
    <div ref={nativeToolsRef} className="scene-three-tools" role="group" aria-label={text("空间变换工具", "Transform tools")} />
  </section>;
}
