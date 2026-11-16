"use client";

import { useId, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { CopyPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { isSuperAdmin } from "@/lib/permissions";
import type { DuplicateContentRequest, DuplicateContentResult, DuplicateContentSourceType } from "@/lib/content-model/duplicate-contracts";
import { ContentFailureNotice } from "../content/ContentFeedback";
import { useContentAction } from "../content/useContentAction";
import { useManageStore } from "../store";
import type { Organization } from "../types";
import { useCollections } from "../lib/collections";
import { contentRequest } from "../lib/content-api";
import { teamHref } from "../lib/content-context";
import { ERROR_TEXTS, runContentAction } from "../lib/content-errors";
import { useIntegrationText } from "../lib/integration-text";
import { intentFor, settleFailure, type UploadIntent } from "../assets/components/asset-upload";

interface DuplicateSource {
  sourceType: DuplicateContentSourceType;
  sourceId: string;
  sourceOrganizationId: string;
  name: string;
  /** Recognition targets open their own library after copying. */
  assetType?: string;
}

interface DuplicateButtonProps extends DuplicateSource {
  archived?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
}

/** A privileged content operation shared by catalogs and their editors. */
export function CrossOrganizationDuplicateButton({ archived, disabled, iconOnly, ...source }: DuplicateButtonProps) {
  const { t } = useTranslation();
  const role = useManageStore(state => state.currentUserRole);
  const organizations = useManageStore(state => state.organizations);
  const [open, setOpen] = useState(false);
  // Preserve an uncertain request across closing/reopening the dialog so retries replay it.
  const intent = useRef<UploadIntent | null>(null);
  const sourceTeam = organizations.find(team => team.id === source.sourceOrganizationId);
  if (!isSuperAdmin(role) || archived || !sourceTeam || sourceTeam.archived_at) return null;
  const targets = organizations.filter(team => team.id !== source.sourceOrganizationId && !team.archived_at);
  const label = t("contentModel.crossCopy.action");
  return <>
    <Button type="button" variant="ghost" size={iconOnly ? "icon" : "sm"} className={iconOnly ? "size-8" : undefined}
      disabled={disabled} title={label} aria-label={iconOnly ? t("contentModel.crossCopy.namedAction", { name: source.name }) : undefined} onClick={() => setOpen(true)}>
      <CopyPlus aria-hidden />{!iconOnly && label}
    </Button>
    {open && <CrossOrganizationDuplicateDialog {...source} targets={targets} intent={intent} onClose={() => setOpen(false)} />}
  </>;
}

function CrossOrganizationDuplicateDialog(props: DuplicateSource & { targets: Organization[]; intent: MutableRefObject<UploadIntent | null>; onClose: () => void }) {
  const { t } = useTranslation();
  const tx = useIntegrationText(ERROR_TEXTS);
  const router = useRouter();
  const fieldId = useId();
  const [name, setName] = useState(() => t("contentModel.crossCopy.defaultName", { name: props.name }).slice(0, 200));
  const [organizationId, setOrganizationId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const needsMap = props.sourceType === "placement";
  const collections = useCollections(organizationId || null, "active", needsMap);
  const maps = collections.collections.filter(collection => !collection.archived_at && collection.capabilities.can_edit);
  const action = useContentAction();
  const inFlight = useRef(false);
  const validTeam = props.targets.some(team => team.id === organizationId);
  const validMap = !needsMap || (collections.status === "ready" && maps.some(map => map.id === workspaceId));
  const canSubmit = !!name.trim() && validTeam && validMap;
  const close = () => { if (!inFlight.current) props.onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    const input = { sourceType: props.sourceType, sourceId: props.sourceId, targetOrganizationId: organizationId, name: name.trim(), ...(needsMap ? { targetWorkspaceId: workspaceId } : {}) };
    const current = intentFor(props.intent, JSON.stringify(input));
    const request: DuplicateContentRequest = { ...input, idempotencyKey: current.key };
    try {
      const succeeded = await action.run(() => runContentAction(async () => {
        try {
          return (await contentRequest<{ data: DuplicateContentResult }>("/api/content/duplicate", { method: "POST", body: request })).data;
        } catch (error) {
          settleFailure(props.intent, error);
          throw error;
        }
      }, tx, result => {
        props.intent.current = null;
        const path = result.sourceType === "placement" ? `/manage/collections/${workspaceId}`
          : result.sourceType === "asset" ? `/manage/${props.assetType === "anchor" ? "anchors" : "assets"}/${result.id}`
          : `/manage/${result.sourceType === "collection" ? "collections" : result.sourceType === "activity" ? "activities" : "scenes"}/${result.id}`;
        toast.success(t("contentModel.crossCopy.success", { name: input.name, team: props.targets.find(team => team.id === result.organizationId)?.name }), {
          action: { label: t("contentModel.crossCopy.open"), onClick: () => router.push(teamHref(path, result.organizationId)) },
        });
      }));
      if (succeeded) props.onClose();
    } finally {
      inFlight.current = false;
    }
  };

  return <Dialog open onOpenChange={next => { if (!next) close(); }}>
    <DialogContent>
      <form onSubmit={submit} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{t("contentModel.crossCopy.action")}</DialogTitle>
          <DialogDescription>{t(`contentModel.crossCopy.description.${props.sourceType}`)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-name`}>{t("contentModel.crossCopy.name")}</Label>
          <Input id={`${fieldId}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={action.pending} required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-team`}>{t("contentModel.crossCopy.team")}</Label>
          <Select value={organizationId} onValueChange={value => { setOrganizationId(value); setWorkspaceId(""); action.reset(); }} disabled={action.pending || !props.targets.length}>
            <SelectTrigger id={`${fieldId}-team`} className="w-full min-w-0"><SelectValue placeholder={t("contentModel.crossCopy.chooseTeam")} /></SelectTrigger>
            <SelectContent>{props.targets.map(team => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent>
          </Select>
          {!props.targets.length && <Text as="p" variant="bodySm" tone="subdued">{t("contentModel.crossCopy.noTeams")}</Text>}
        </div>
        {needsMap && organizationId && <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-map`}>{t("contentModel.crossCopy.map")}</Label>
          <Select value={workspaceId} onValueChange={setWorkspaceId} disabled={action.pending || collections.status !== "ready" || !maps.length}>
            <SelectTrigger id={`${fieldId}-map`} className="w-full min-w-0"><SelectValue placeholder={t(collections.status === "loading" ? "contentModel.state.loading" : "contentModel.crossCopy.chooseMap")} /></SelectTrigger>
            <SelectContent>{maps.map(map => <SelectItem key={map.id} value={map.id}>{map.name}</SelectItem>)}</SelectContent>
          </Select>
          {collections.status === "loading" && <Text as="p" variant="bodySm" tone="subdued" role="status">{t("contentModel.state.loading")}</Text>}
          {collections.status === "ready" && !maps.length && <Text as="p" variant="bodySm" tone="subdued">{t("contentModel.crossCopy.noMaps")}</Text>}
          {collections.status === "error" && <div role="alert" className="space-y-2"><Text as="p" variant="bodySm" tone="critical">{t("contentModel.crossCopy.mapsFailed")}</Text><Button type="button" variant="outline" size="sm" onClick={collections.reload}>{t("contentModel.action.retry")}</Button></div>}
        </div>}
        {action.failure && <ContentFailureNotice failure={action.failure} />}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={action.pending}>{t("contentModel.action.cancel")}</Button>
          <Button type="submit" disabled={!canSubmit || action.pending}>{action.pending && <Loader2 className="animate-spin" aria-hidden />}{t(action.pending ? "contentModel.crossCopy.copying" : "contentModel.crossCopy.submit")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
