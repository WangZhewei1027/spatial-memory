"use client";
import Link from "next/link";
import { ArrowLeftRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { MODEL_DRAG_TYPE, draggedAssetKind } from "@/lib/scene/editor-interactions";
import { useEffect, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { LibraryArtwork } from "./SceneLibraryList";
import type { SceneResource } from "./types";

type DropState = "ready" | "invalid" | "disabled";

/** Source slot of the selected track; dropping a library asset of the same kind swaps the file and keeps the track. */
export function SceneResourceSource({ resource, assetHref, canReplace, onReplace }: {
  resource: SceneResource; assetHref: string; canReplace: boolean; onReplace: (assetId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const kind = resource.kind ?? "model";
  const kindLabel = { model: text("模型", "model"), image: text("图片", "image"), audio: text("音频", "audio"), video: text("视频", "video") }[kind];
  // Library drags anywhere in the window light up this slot; hovering it says whether the drop applies.
  const [dragging, setDragging] = useState<DropState | null>(null);
  const [over, setOver] = useState(false);
  const stateOf = (types: readonly string[]): DropState | null => {
    if (!types.includes(MODEL_DRAG_TYPE)) return null;
    return !canReplace ? "disabled" : draggedAssetKind(types) === kind ? "ready" : "invalid";
  };
  useEffect(() => {
    const enter = (event: globalThis.DragEvent) => setDragging(stateOf([...event.dataTransfer?.types ?? []]));
    const clear = () => { setDragging(null); setOver(false); };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragend", clear); window.removeEventListener("drop", clear); };
  });
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(MODEL_DRAG_TYPE);
  const hint = !dragging ? text(`拖入${kindLabel}替换`, `Drop a ${kindLabel} to replace`)
    : dragging === "ready" ? (over ? text("松开即替换", "Release to replace") : text(`拖到这里替换此${kindLabel}`, `Drop here to replace this ${kindLabel}`))
    : dragging === "invalid" ? text(`只能替换为${kindLabel}`, `Only a ${kindLabel} can replace this`)
    : text("播放中或只读时无法替换", "Unavailable while playing or read-only");
  return <div className="space-y-2">
    <div className="scene-resource-slot" data-replaceable={canReplace || undefined} data-replace-drop={dragging ?? undefined} data-over={over || undefined}
      onDragOver={event => {
        if (!accepts(event)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = stateOf(event.dataTransfer.types) === "ready" ? "copy" : "none";
        setOver(true);
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }}
      onDrop={event => {
        if (!accepts(event)) return;
        event.preventDefault(); event.stopPropagation();
        const id = event.dataTransfer.getData(MODEL_DRAG_TYPE);
        setDragging(null); setOver(false);
        if (stateOf(event.dataTransfer.types) === "ready" && id) onReplace(id);
      }}>
      <div className="scene-resource-slot-artwork"><LibraryArtwork resource={resource} /></div>
      <div className="min-w-0 flex-1">
        <Text as="h3" variant="bodyXs" fontWeight="medium" truncate title={resource.name ?? undefined}>{resource.name || "—"}</Text>
        {(canReplace || dragging) && <Text as="p" variant="bodyXs" tone={dragging === "invalid" || dragging === "disabled" ? "critical" : "subdued"} className="scene-resource-slot-hint" role={dragging ? "status" : undefined}><ArrowLeftRight aria-hidden="true" />{hint}</Text>}
      </div>
      <Button asChild size="icon" variant="ghost" className="size-7 shrink-0"><Link target="_blank" rel="noopener noreferrer" href={assetHref} title={t("contentModel.edit.openAsset")} aria-label={t("contentModel.edit.openAsset")}><ExternalLink /></Link></Button>
    </div>
    {resource.assetState === "archived" && <Text as="p" variant="bodySm" tone="subdued">{t("contentModel.detail.archivedBody")}</Text>}
  </div>;
}
