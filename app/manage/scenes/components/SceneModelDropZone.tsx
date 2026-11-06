"use client";
import { Text } from "@/components/ui/typography";
import { MODEL_DRAG_TYPE, type PlacementReader, type ScenePosition } from "@/lib/scene/editor-interactions";
import { useEffect, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";

export function SceneModelDropZone({ children, canDrop, enabled, placementRef, onAdd }: {
  children: ReactNode; enabled: boolean; placementRef: RefObject<PlacementReader | null>;
  /** Overrides the `models` lookup, e.g. when drag ids are asset IDs. */
  canDrop: (id: string) => boolean;
  onAdd: (id: string, position: ScenePosition) => void;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState<{ x: number; y: number; valid: boolean } | null>(null);
  useEffect(() => {
    const clear = () => setOver(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(MODEL_DRAG_TYPE);
  return <div className="scene-canvas" data-model-drop={over ? over.valid ? "ready" : "invalid" : undefined}
    onDragOver={(event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      const valid = enabled && !!placementRef.current?.(event.clientX, event.clientY);
      event.dataTransfer.dropEffect = valid ? "copy" : "none";
      const rect = event.currentTarget.getBoundingClientRect();
      setOver({ x: event.clientX - rect.left, y: event.clientY - rect.top, valid });
    }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null); }}
    onDrop={(event) => {
      if (!accepts(event)) return;
      event.preventDefault(); event.stopPropagation(); setOver(null);
      const id = event.dataTransfer.getData(MODEL_DRAG_TYPE);
      const position = enabled ? placementRef.current?.(event.clientX, event.clientY) : null;
      if (position && canDrop(id)) onAdd(id, position);
    }}>
    {children}
    {over && <><div className="scene-drop-message" role="status"><Text as="span" variant="bodyXs">{t(!enabled ? "sceneEditor.dropUnavailable" : over.valid ? "sceneEditor.dropModel" : "sceneEditor.dropOnGround")}</Text></div>{over.valid && <div className="scene-drop-target" style={{ left: over.x, top: over.y }} aria-hidden="true" />}</>}
  </div>;
}
