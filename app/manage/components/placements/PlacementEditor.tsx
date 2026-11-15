"use client";

import { ContentFailureNotice, ContentNotice } from "@/app/manage/content/ContentFeedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Text } from "@/components/ui/typography";
import type { PlacementDto } from "@/lib/content-model/contracts";
import { Archive, Copy, Loader2, MoreHorizontal, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlacementStore } from "../../lib/placement-store";
import { placementDisplayName } from "../../lib/placement-to-viewer";
import { PlacementArchiveDialog } from "./PlacementArchiveDialog";
import { PlacementFieldsForm } from "./PlacementFieldsForm";
import { usePlacementMap } from "./PlacementMapContext";
import { PlacementSourceSection } from "./PlacementSourceSection";
import { usePlacementActions } from "./usePlacementActions";
import { usePlacementForm } from "./usePlacementForm";

/**
 * sidebar editor for one placement: source content (read-only facts and
 * version switch) clearly separated from the placement's own fields.
 * Every control is gated by `capabilities`, never by the org role.
 */
export function PlacementEditor({ placement }: { placement: PlacementDto }) {
  const { t } = useTranslation();
  const { tx, isAll, workspaceId, canWrite, canCopy } = usePlacementMap();
  const form = usePlacementForm(placement);
  const actions = usePlacementActions();
  const [copying, setCopying] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const editable = canWrite(placement);
  const copyable = canCopy(placement) && !!workspaceId;

  const copy = async () => {
    if (!workspaceId) return;
    setCopying(true);
    try {
      await actions.copy([placement], workspaceId);
    } finally {
      setCopying(false);
    }
  };

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden" data-placement-editor>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <Text as="h2" variant="bodyMd" fontWeight="semibold" truncate title={placementDisplayName(placement)}>{placementDisplayName(placement)}</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {tx("contentModel.integration.map.editor.title")} · {t(`contentModel.placement.status.${placement.status}`)}
          </Text>
        </div>
        {(copyable || (editable && placement.status !== "archived")) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={tx("contentModel.integration.map.editor.more")}><MoreHorizontal className="size-4" aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {copyable && <DropdownMenuItem onSelect={() => void copy()} disabled={copying}><Copy className="mr-2 size-4" aria-hidden />{tx("contentModel.integration.map.editor.copy")}</DropdownMenuItem>}
              {editable && placement.status !== "archived" && <DropdownMenuItem onSelect={() => setArchiveOpen(true)} disabled={form.saving}><Archive className="mr-2 size-4" aria-hidden />{tx("contentModel.integration.map.editor.archive")}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="ghost" size="sm" onClick={() => usePlacementStore.getState().selectPlacement(null)} aria-label={tx("contentModel.integration.map.action.close")}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4" data-inspector-scroll>
        {!editable ? (
          <ContentNotice title={tx(isAll ? "contentModel.integration.map.editor.readOnlyAll" : "contentModel.integration.map.editor.readOnly")} />
        ) : null}

        {form.conflict && (
          <ContentNotice
            tone="warning"
            title={tx("contentModel.integration.map.editor.conflictTitle")}
            description={tx("contentModel.integration.map.editor.conflictBody")}
            action={<Button variant="outline" size="sm" onClick={form.reload}>{tx("contentModel.integration.map.action.reloadPlacement")}</Button>}
          />
        )}
        {form.failure && <ContentFailureNotice failure={form.failure} />}

        <PlacementSourceSection placement={placement} editable={editable} formDirty={form.dirty} />
        <PlacementFieldsForm placement={placement} values={form.values} editable={editable && !form.saving} problem={form.problem} onChange={form.update} />
      </div>
      {editable && <div className="shrink-0 space-y-2 border-t bg-background p-3" data-inspector-actions>
        <Text as="p" variant="bodySm" tone={form.dirty ? "warning" : "subdued"} role="status">
          {tx(form.saving ? "contentModel.integration.map.editor.saving" : form.dirty ? "contentModel.integration.map.editor.draftKept" : "contentModel.integration.map.editor.saved")}
        </Text>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={form.discard} disabled={!form.dirty || form.saving}>{tx("contentModel.integration.map.action.discard")}</Button>
          <Button size="sm" onClick={form.save} disabled={!form.dirty || form.saving}>
            {form.saving && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}{tx("contentModel.integration.map.action.save")}
          </Button>
        </div>
      </div>}
      <PlacementArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} placements={[placement]} onConfirm={() => actions.archive([placement])} />
    </Card>
  );
}
