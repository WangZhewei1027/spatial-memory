"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "../AssetEditor/FieldLabel";
import { Text } from "@/components/ui/typography";
import { contentType, excerptOf, thumbnailOf } from "../../lib/content-mappers";
import { fileTypeOf } from "../../lib/content-upload";
import { usePlacementStore } from "../../lib/placement-store";
import { useUploadStageText } from "../../lib/upload-stage-text";
import { PlacementContentPicker } from "./PlacementContentPicker";
import { PlacementContentCard } from "./PlacementContentCard";
import { PlacementActionBar } from "./PlacementActionBar";
import { PlacementLocationFields } from "./PlacementLocationFields";
import { usePlacementMap } from "./PlacementMapContext";
import { usePlacementCreation } from "./usePlacementCreation";

export function PlacementCreatePanel({ active }: { active: boolean }) {
  const { tx } = usePlacementMap();
  const draft = usePlacementCreation();
  const stageText = useUploadStageText();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const close = () => usePlacementStore.getState().closeCreate();
  const ready = draft.contentReady && !!draft.point && draft.point !== "invalid";
  const source = draft.mode === "existing" ? draft.source : null;
  const asset = source?.kind === "asset" ? source.asset : null;
  const type = source?.kind === "scene" ? "scene" : contentType(asset?.file_type ?? fileTypeOf(draft.type));
  const sourceName = (asset ? asset.name || asset.id.slice(0, 8) : draft.sourceName) || tx("contentModel.integration.map.source.unnamed");
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden" data-placement-create>
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b px-2 py-1">
        <Text as="h2" variant="bodySm" fontWeight="semibold">{tx("contentModel.integration.map.create.title")}</Text>
        <Button variant="ghost" size="icon" onClick={close} aria-label={tx("contentModel.integration.map.action.close")}><X className="size-4" aria-hidden /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-2.5" data-inspector-scroll>
        <div className="space-y-2">
          <Text as="h3" variant="bodyXs" fontWeight="semibold">{tx("contentModel.integration.map.create.contentStep")}</Text>
          {draft.contentReady ? <PlacementContentCard
            ref={pickerTrigger} data-content-picker-trigger name={sourceName} contentType={type} typeLabel={tx(`contentModel.integration.map.type.${type}`)}
            thumbnailUrl={thumbnailOf(asset)} textExcerpt={asset ? excerptOf(asset) : draft.type === "text" ? draft.text : null}
            actionLabel={tx("contentModel.integration.map.create.change")} aria-label={`${tx("contentModel.integration.map.create.changeContent")}: ${sourceName}`}
            onClick={() => setPickerOpen(true)} disabled={draft.pending}
          /> : <Button ref={pickerTrigger} data-content-picker-trigger variant="outline" className="w-full" onClick={() => setPickerOpen(true)} disabled={draft.pending}>
            <Plus className="size-4" aria-hidden />{tx("contentModel.integration.map.create.chooseContent")}
          </Button>}
        </div>
        <div className="space-y-1"><FieldLabel htmlFor="placement-create-name">{tx("contentModel.integration.map.create.optionalName")}</FieldLabel><Input id="placement-create-name" value={draft.name} placeholder={tx("contentModel.integration.map.field.namePlaceholder")} disabled={draft.pending} onChange={(event) => draft.setName(event.target.value)} /></div>
        <div className="space-y-2 border-t pt-2">
          <PlacementLocationFields title={tx("contentModel.integration.map.create.locationStep")} {...draft.location} disabled={draft.pending} invalid={draft.point === "invalid"} onChange={(patch) => draft.setLocation((current) => ({ ...current, ...patch }))} extraAction={draft.mode === "upload" && draft.photoLocation && <Button variant="outline" size="sm" onClick={() => draft.photoLocation && draft.setLocation(draft.photoLocation)}><Camera className="size-4" aria-hidden />{tx("contentModel.integration.map.field.usePhotoGps")}</Button>} />
        </div>
        {(draft.problem || draft.error) && <Text as="p" variant="bodySm" tone="critical" role="alert">{draft.problem || draft.error}</Text>}
      </div>
      <PlacementActionBar status={draft.pending ? stageText(draft.stage ?? "creating") : tx(!draft.contentReady ? "contentModel.integration.map.create.pickSource" : !ready ? "contentModel.integration.map.create.locationRequired" : "contentModel.integration.map.create.ready")}>
          <Button variant="outline" size="sm" onClick={draft.reset} disabled={!draft.dirty || draft.pending}>{tx("contentModel.integration.map.action.discard")}</Button>
          <Button size="sm" onClick={() => void draft.submit()} disabled={!ready || draft.pending || draft.preparing}>{draft.pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}{tx("contentModel.integration.map.create.placeAction")}</Button>
      </PlacementActionBar>
      <PlacementContentPicker draft={draft} open={active && pickerOpen} onOpenChange={setPickerOpen} onReturnFocus={() => pickerTrigger.current?.focus({ preventScroll: true })} />
    </Card>
  );
}
