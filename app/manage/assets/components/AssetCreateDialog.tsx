"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import type { AssetDto } from "@/lib/content-model/contracts";
import { ContentFailureNotice, useContentAction } from "@/app/manage/content";
import { organizationApi } from "@/app/manage/lib/content-api";
import { runContentAction } from "@/app/manage/lib/content-errors";
import { useIntegrationText } from "@/app/manage/lib/integration-text";
import { bodyForIntent, contentSignature, intentFor, settleFailure, type UploadIntent, type UploadStage } from "./asset-upload";
import { AssetContentField, contentOf, defaultNameFor, type CreatableType, type DraftContent } from "./AssetContentField";
import { useUploadStageText } from "@/app/manage/lib/upload-stage-text";
import { ASSET_TEXTS } from "./texts";

export interface AssetCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  teamName: string;
  /** Types the team allows, in display order. */
  types: CreatableType[];
  onCreated: (asset: AssetDto) => void;
}

const NAME_MAX = 120;
const EMPTY_DRAFT: DraftContent = { file: null, text: "" };

/** New team asset: content → receipt → createAsset. No collection, no placement. */
export function AssetCreateDialog({ open, onOpenChange, organizationId, teamName, types, onCreated }: AssetCreateDialogProps) {
  const { t } = useTranslation();
  const tx = useIntegrationText(ASSET_TEXTS);
  const stageText = useUploadStageText();
  const ids = { type: useId(), name: useId() };
  const [type, setType] = useState<CreatableType>(types[0] ?? "image");
  const [draft, setDraft] = useState<DraftContent>(EMPTY_DRAFT);
  const [name, setName] = useState("");
  /** Last suggested name; replaced on content change unless the user edited it. */
  const [suggested, setSuggested] = useState("");
  const [stage, setStage] = useState<UploadStage | null>(null);
  const action = useContentAction();
  const intent = useRef<UploadIntent | null>(null);
  const activeType = types.includes(type) ? type : types[0] ?? "image";
  const anchorOnly = types.length === 1 && types[0] === "anchor";
  const content = contentOf(activeType, draft);

  const reset = () => {
    setDraft(EMPTY_DRAFT); setName(""); setSuggested(""); setStage(null);
    intent.current = null; action.reset();
  };
  const close = (next: boolean) => {
    if (action.pending) return;
    if (!next) reset();
    onOpenChange(next);
  };
  const changeDraft = (next: DraftContent) => {
    setDraft(next);
    const nextSuggestion = defaultNameFor(activeType, next);
    if (!name.trim() || name === suggested) setName(nextSuggestion);
    setSuggested(nextSuggestion);
  };

  const changeType = (next: CreatableType) => {
    setType(next);
    setDraft(EMPTY_DRAFT);
    if (name === suggested) setName("");
    setSuggested("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!content || !trimmed) return;
    const signature = [organizationId, trimmed, contentSignature(content)].join("|");
    const current = intentFor(intent, signature);
    const ok = await action.run(() =>
      runContentAction(
        async () => {
          try {
            const body = await bodyForIntent(current, content, organizationId, (key) => String(t(key)), setStage);
            setStage("creating");
            return await organizationApi.createAsset(organizationId, {
              name: trimmed,
              fileType: content.kind === "file" ? content.type : content.kind,
              payload: body.payload,
              resources: body.resources,
              idempotencyKey: current.key,
            });
          } catch (error) {
            settleFailure(intent, error);
            throw error;
          } finally {
            setStage(null);
          }
        },
        tx,
        (result) => onCreated(result.asset),
      ),
    );
    if (ok) { reset(); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{anchorOnly ? t("contentModel.library.anchor.create") : tx("contentModel.integration.assets.create.title")}</DialogTitle>
            <DialogDescription>{tx("contentModel.integration.assets.create.body", { team: teamName })}</DialogDescription>
          </DialogHeader>

          {!anchorOnly && <div className="space-y-1.5">
            <Label htmlFor={ids.type}>{tx("contentModel.integration.assets.create.type")}</Label>
            <Select value={activeType} onValueChange={(value) => changeType(value as CreatableType)} disabled={action.pending}>
              <SelectTrigger id={ids.type} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {types.map((value) => <SelectItem key={value} value={value}>{t(`fileTypes.${value}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}

          <AssetContentField type={activeType} draft={draft} onChange={changeDraft} disabled={action.pending} tx={tx} />

          <div className="space-y-1.5">
            <Label htmlFor={ids.name}>{anchorOnly ? t("contentModel.library.anchor.name") : tx("contentModel.integration.assets.create.name")}</Label>
            <Input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} disabled={action.pending} required />
          </div>

          {stage && (
            <Text as="p" variant="bodySm" tone="subdued" aria-live="polite">{stageText(stage)}</Text>
          )}
          {action.failure && <ContentFailureNotice failure={action.failure} />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={action.pending}>{tx("contentModel.integration.assets.create.cancel")}</Button>
            <Button type="submit" disabled={!content || !name.trim() || action.pending}>
              {action.pending && <Loader2 className="animate-spin" aria-hidden />}
              {stage ? stageText(stage) : anchorOnly && !action.failure ? t("contentModel.library.anchor.create") : tx(action.failure ? "contentModel.integration.assets.create.retry" : "contentModel.integration.assets.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
