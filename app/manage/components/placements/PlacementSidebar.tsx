"use client";

import { ContentNotice } from "@/app/manage/content/ContentFeedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { MousePointerClick, Plus, X } from "lucide-react";
import { useEffect } from "react";
import { usePlacementStore } from "../../lib/placement-store";
import { AnchorPanel } from "./AnchorPanel";
import { PlacementCreatePanel } from "./PlacementCreatePanel";
import { PlacementEditor } from "./PlacementEditor";
import { usePlacementMap } from "./PlacementMapContext";

/** One task at a time; creation stays mounted so switching preserves its draft. */
export function PlacementSidebar() {
  const { tx, isAll, workspaceId, workspaceCanEdit, workspaceInfoLoading } = usePlacementMap();
  const selectedId = usePlacementStore((state) => state.selectedPlacementId);
  const anchorId = usePlacementStore((state) => state.selectedAnchorId);
  const placement = usePlacementStore((state) => state.placements.find((item) => item.id === state.selectedPlacementId) ?? null);
  const notice = usePlacementStore((state) => state.notice);
  const mode = usePlacementStore((state) => state.sidebarMode);
  const drafts = usePlacementStore((state) => state.placementDrafts);
  const createHasDraft = usePlacementStore((state) => state.createHasDraft);
  const canCreate = !isAll && !!workspaceId && workspaceCanEdit;
  const creating = canCreate && mode === "create";
  const dirty = createHasDraft || Object.keys(drafts).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2" data-placement-sidebar>
        {isAll && (
          <ContentNotice title={tx("contentModel.integration.map.scope.allTitle")} description={tx("contentModel.integration.map.scope.allBody")} />
        )}
        {!isAll && workspaceId && !workspaceInfoLoading && !workspaceCanEdit && (
          <ContentNotice title={tx("contentModel.integration.map.scope.readOnlyTitle")} description={tx("contentModel.integration.map.scope.readOnlyBody")} />
        )}
        {notice && (
          <ContentNotice
            tone={notice.tone}
            title={notice.message}
            action={
              <Button variant="ghost" size="sm" onClick={() => usePlacementStore.getState().setNotice(null)} aria-label={tx("contentModel.integration.map.action.dismiss")}>
                <X className="size-4" aria-hidden />
              </Button>
            }
          />
        )}
        <div className={creating ? "hidden" : "min-h-0 flex-1"}>
        {anchorId ? (
          <div className="h-full overflow-y-auto" key={anchorId}><AnchorPanel anchorId={anchorId} /></div>
        ) : placement ? (
          <PlacementEditor key={placement.id} placement={placement} />
        ) : selectedId ? null : (
          <Card className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center">
            <MousePointerClick className="size-8 text-muted-foreground/60" aria-hidden />
            <Text as="p" variant="bodySm" tone="subdued">{tx("contentModel.integration.map.sidebar.selectHint")}</Text>
            {canCreate && <Button onClick={() => usePlacementStore.getState().startCreate()}><Plus className="size-4" aria-hidden />{tx("contentModel.integration.map.create.title")}</Button>}
            {Object.entries(drafts).map(([id, draft]) => (
              <Button key={id} variant="outline" className="h-auto max-w-full whitespace-normal" onClick={() => usePlacementStore.getState().selectPlacement(id)}>
                {tx("contentModel.integration.map.editor.resumeDraft", { name: draft.values.name || draft.base.name || tx("contentModel.integration.map.source.unnamed") })}
              </Button>
            ))}
          </Card>
        )}
        </div>
        {canCreate && <div className={creating ? "min-h-0 flex-1" : "hidden"}><PlacementCreatePanel key={workspaceId} active={creating} /></div>}
    </div>
  );
}
