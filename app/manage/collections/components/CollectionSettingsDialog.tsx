"use client";

import { useState } from "react";
import { Settings, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CollectionDto } from "@/lib/content-model/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContentFailureNotice } from "../../content/ContentFeedback";
import type { ContentActionFailure } from "../../content/useContentAction";
import { collectionApi } from "../../lib/content-api";
import { ERROR_TEXTS, toActionResult } from "../../lib/content-errors";
import { useIntegrationText } from "../../lib/integration-text";

export function CollectionSettingsDialog({ collection, onSaved }: { collection: CollectionDto; onSaved: () => void }) {
  const { t } = useTranslation();
  const tx = useIntegrationText(ERROR_TEXTS);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(collection);
  const [draft, setDraft] = useState(collection.miniapp_config);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ContentActionFailure | null>(null);
  const canEdit = collection.capabilities.can_edit && snapshot.capabilities.can_edit;
  const disabled = pending || !canEdit || failure?.kind === "conflict";
  const changeOpen = (next: boolean) => {
    if (pending) return;
    if (next) {
      const latest = snapshot.config_lock_version > collection.config_lock_version ? snapshot : collection;
      setSnapshot(latest); setDraft(latest.miniapp_config); setFailure(null);
    }
    setOpen(next);
  };
  const reload = async () => {
    setPending(true);
    try {
      const latest = await collectionApi.get(collection.id);
      setSnapshot(latest); setDraft(latest.miniapp_config); setFailure(null);
      onSaved();
    } catch (error) { setFailure(toActionResult(error, tx)); }
    finally { setPending(false); }
  };
  const save = async () => {
    if (disabled) return;
    setPending(true); setFailure(null);
    try {
      const saved = await collectionApi.update(collection.id, { miniappConfig: draft, expectedLockVersion: snapshot.config_lock_version });
      setSnapshot(saved); onSaved(); setOpen(false);
    } catch (error) { setFailure(toActionResult(error, tx)); }
    finally { setPending(false); }
  };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="ghost" size="sm" title={t("collectionSettings.trigger")}><Settings aria-hidden /><span className="max-sm:sr-only">{t("collectionSettings.trigger")}</span></Button></DialogTrigger>
    <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton={false}>
      <div className="flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <DialogHeader className="min-w-0 flex-1 text-start">
          <DialogTitle>{t("collectionSettings.title")}</DialogTitle>
          <DialogDescription className="sr-only">{collection.name}</DialogDescription>
        </DialogHeader>
        <Button variant="ghost" size="icon" className="-me-2 size-11" disabled={pending} aria-label={t("common.close")} onClick={() => changeOpen(false)}><X aria-hidden /></Button>
      </div>
      {open && <form className="flex min-h-0 flex-col" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="min-h-0 space-y-5 overflow-y-auto p-5">
          <div className="space-y-2">
            <Label htmlFor="collection-retrieval-mode">{t("collectionSettings.retrievalMode")}</Label>
            <Select value={draft.retrieval_mode} disabled={disabled} onValueChange={(value: "gps" | "anchor") => setDraft({ ...draft, retrieval_mode: value })}>
              <SelectTrigger id="collection-retrieval-mode" className="min-h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{["anchor", "gps"].map((mode) => <SelectItem key={mode} value={mode}>{t(`collectionSettings.modes.${mode}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="collection-text-style">{t("collectionSettings.textStyle")}</Label>
            <Select value={draft.text_asset_miniapp_style} disabled={disabled} onValueChange={(value: "plain_white" | "dialog_decorated") => setDraft({ ...draft, text_asset_miniapp_style: value })}>
              <SelectTrigger id="collection-text-style" className="min-h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{["plain_white", "dialog_decorated"].map((style) => <SelectItem key={style} value={style}>{t(`collectionSettings.styles.${style}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="divide-y border-y">
            {(["confetti_enabled", "footer_enabled"] as const).map((key) => <div key={key} className="flex min-h-12 items-center justify-between gap-4 py-3">
              <Label htmlFor={`collection-${key}`} className="flex-1 cursor-pointer">{t(`collectionSettings.${key}`)}</Label>
              <Checkbox id={`collection-${key}`} checked={draft[key]} disabled={disabled} onCheckedChange={(checked) => setDraft({ ...draft, [key]: checked === true })} />
            </div>)}
          </div>
          {failure && <ContentFailureNotice failure={failure} onRetry={failure.kind === "conflict" && !pending ? () => void reload() : undefined} />}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>{t("common.close")}</Button>
          {canEdit && <Button type="submit" disabled={disabled || JSON.stringify(draft) === JSON.stringify(snapshot.miniapp_config)}>{t(pending ? "common.saving" : "common.save")}</Button>}
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
