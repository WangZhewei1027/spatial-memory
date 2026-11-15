"use client";
import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { organizationApi, uploadReceipt } from "../../lib/content-api";
import { useUploadStageText } from "../../lib/upload-stage-text";
import type { UploadStage } from "@/lib/upload/progress";
import { prepareFile } from "../../lib/content-upload";
import { ContentEmptyState, ContentErrorState, ContentListSkeleton } from "../../content/ContentFeedback";
import { useActivityQuery } from "./useActivityQuery";
import { ActivityFailure } from "./ActivityFeedback";

export interface ImageChoice { id: string; url: string | null }
export function ActivityImagePicker({ organizationId, label, value, disabled, onChange }: { organizationId: string; label: string; value: ImageChoice | null; disabled: boolean; onChange: (value: ImageChoice | null) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <div className="space-y-2"><Text as="p" variant="bodySm" fontWeight="medium">{label}</Text><div className="flex flex-wrap items-center gap-2">{value?.url && <Image src={value.url} width={64} height={64} unoptimized alt={label} className="size-16 rounded-md border object-cover" />}<Button type="button" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal" disabled={disabled} onClick={() => setOpen(true)}><ImagePlus aria-hidden />{t(value ? "activities.replaceImage" : "activities.chooseImage")}</Button>{value && <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={t("activities.clearImage", { label })} onClick={() => onChange(null)}><X aria-hidden /></Button>}</div><Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{t("activities.imageHint")}</DialogDescription></DialogHeader>{open && <ImageLibrary organizationId={organizationId} onBusyChange={setBusy} onSelect={(choice) => { onChange(choice); setOpen(false); }} />}</DialogContent></Dialog></div>;
}

function ImageLibrary({ organizationId, onSelect, onBusyChange }: { organizationId: string; onSelect: (choice: ImageChoice) => void; onBusyChange: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState<UploadStage>("preparing");
  const stageText = useUploadStageText();
  const [error, setError] = useState<unknown>(null);
  const [file, setFile] = useState<File | null>(null);
  const intent = useRef<{ file: File; receiptId?: string; key: string } | null>(null);
  const load = useCallback((signal: AbortSignal) => organizationApi.assets(organizationId, { file_type: "image", state: "active", q: search, limit: 24, offset }, signal), [organizationId, search, offset]);
  const result = useActivityQuery(`${organizationId}:${search}:${offset}`, load);
  const upload = async () => {
    if (!file) return;
    setPending(true); setStage("preparing"); onBusyChange(true); setError(null);
    if (intent.current?.file !== file) intent.current = { file, key: crypto.randomUUID() };
    const current = intent.current;
    try {
      if (!current.receiptId) {
        const prepared = await prepareFile(file, "image");
        current.receiptId = (await uploadReceipt(prepared.file, { organizationId, type: "image", onStage: setStage })).id;
      }
      setStage("creating");
      const created = await organizationApi.createAsset(organizationId, { name: file.name, fileType: "image", payload: { kind: "image" }, resources: [{ role: "primary", receiptId: current.receiptId }], idempotencyKey: current.key });
      onSelect({ id: created.asset.id, url: created.asset.resources.find((resource) => resource.role === "primary")?.url ?? null });
    } catch (failure) { setError(failure); } finally { setPending(false); onBusyChange(false); }
  };
  return <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Input type="file" accept="image/*" aria-label={t("activities.uploadImage")} className="max-w-sm" disabled={pending} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><Button type="button" variant="outline" disabled={!file || pending} onClick={upload} aria-live="polite">{pending && <Loader2 className="animate-spin" aria-hidden />}{pending ? stageText(stage) : t("activities.uploadImage")}</Button></div><ActivityFailure error={error} /><Input aria-label={t("activities.searchImages")} placeholder={t("activities.searchImages")} value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />{result.loading ? <ContentListSkeleton label={t("activities.loading")} rows={3} /> : result.error ? <ContentErrorState onRetry={result.reload} /> : !result.data?.data.length ? <ContentEmptyState title={t("activities.noImages")} /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{result.data.data.map((asset) => {
    const url = asset.resources.find((resource) => resource.role === "primary")?.url ?? null;
    return <button type="button" key={asset.id} disabled={pending} onClick={() => onSelect({ id: asset.id, url })} className="space-y-2 rounded-lg border p-2 text-start hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{url && <Image src={url} alt="" width={160} height={100} unoptimized className="h-24 w-full rounded object-cover" />}<Text as="span" variant="bodySm" breakWord>{asset.name || t("activities.unnamedImage")}</Text></button>;
  })}</div>}<div className="flex gap-2"><Button type="button" variant="outline" disabled={!offset} onClick={() => setOffset((value) => Math.max(0, value - 24))}>{t("activities.previous")}</Button><Button type="button" variant="outline" disabled={!result.data || offset + 24 >= result.data.page.total} onClick={() => setOffset((value) => value + 24)}>{t("activities.next")}</Button></div></div>;
}
