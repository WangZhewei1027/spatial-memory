"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Text } from "@/components/ui/typography";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UploadType } from "@/lib/upload/types";
import { acceptFor } from "../../lib/content-upload";
import { useUploadStageText } from "../../lib/upload-stage-text";
import { AssetLinkPreview } from "../AssetEditor/previews/AssetLinkPreview";
import { FileDropzone } from "../upload/file-dropzone";
import { VideoUploadHint } from "../upload/VideoUploadHint";
import { SourcePicker } from "./SourcePicker";
import { usePlacementMap } from "./PlacementMapContext";
import type { PlacementCreation } from "./usePlacementCreation";

export function PlacementContentPicker({ draft, open, onOpenChange, onReturnFocus }: { draft: PlacementCreation; open: boolean; onOpenChange: (open: boolean) => void; onReturnFocus: () => void }) {
  const { tx } = usePlacementMap();
  const stageText = useUploadStageText();
  const [mode, setMode] = useState(draft.mode);
  useEffect(() => { if (open) setMode(draft.mode); }, [open, draft.mode]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(85dvh,44rem)] max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }}>
        <DialogHeader className="shrink-0 border-b p-5 pr-12">
          <DialogTitle>{tx("contentModel.integration.map.create.chooseContent")}</DialogTitle>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(mode) => setMode(mode as "existing" | "upload")} className="flex min-h-0 flex-1 flex-col">
          <TabsList variant="line" className="mx-5 mb-3 mt-2 shrink-0 gap-4 p-0">
            <TabsTrigger value="existing" className="flex-none px-0">{tx("contentModel.integration.map.create.mode.existing")}</TabsTrigger>
            <TabsTrigger value="upload" className="flex-none px-0" disabled={!draft.types.length}>{tx("contentModel.integration.map.create.uploadNew")}</TabsTrigger>
          </TabsList>
            <TabsContent value="existing" forceMount className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"><SourcePicker value={draft.source} onChange={(source) => { if (source) { draft.setMode("existing"); draft.setSource(source); onOpenChange(false); } }} /></TabsContent>
            <TabsContent value="upload" className="mt-0 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-5 [scrollbar-gutter:stable]">
              <div className="space-y-2"><Label htmlFor="placement-upload-type">{tx("contentModel.integration.map.create.contentType")}</Label>
                <Select value={draft.type} onValueChange={(type) => draft.changeType(type as UploadType)} disabled={draft.pending}>
                  <SelectTrigger id="placement-upload-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{draft.types.map((type) => <SelectItem key={type} value={type}>{tx(`contentModel.integration.map.type.${type}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {draft.isFile && <FileDropzone file={draft.file} accept={acceptFor(draft.type)} onFileSelect={(file) => void draft.selectFile(file)} onFileRemove={draft.clearFile} disabled={draft.pending} />}
              {draft.type === "video" && <VideoUploadHint />}
              {draft.preparing && <Text as="p" variant="bodySm" tone="subdued" role="status">{stageText("preparing")}</Text>}
              {draft.type === "text" && <div className="space-y-2"><Label htmlFor="placement-upload-text">{tx("contentModel.integration.map.create.text")}</Label><Textarea id="placement-upload-text" rows={5} value={draft.text} onChange={(event) => draft.setText(event.target.value)} /></div>}
              {draft.type === "link" && <div className="space-y-2"><Label htmlFor="placement-upload-link">{tx("contentModel.integration.map.create.link")}</Label><Input id="placement-upload-link" value={draft.link} placeholder="https://" onChange={(event) => draft.setLink(event.target.value)} />{draft.linkState.data && <AssetLinkPreview linkData={draft.linkState.data} compact />}{draft.linkError && <Text as="p" variant="bodySm" tone="critical" role="alert">{draft.linkError}</Text>}</div>}
              {draft.problem && <Text as="p" variant="bodySm" tone="critical" role="alert">{draft.problem}</Text>}
              <div className="flex justify-end"><Button onClick={() => { draft.setMode("upload"); onOpenChange(false); }} disabled={!draft.uploadReady}>{tx("contentModel.integration.map.create.useContent")}</Button></div>
            </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
