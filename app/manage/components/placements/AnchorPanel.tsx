"use client";

import { ContentNotice } from "@/app/manage/content/ContentFeedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetDetailView } from "../../assets/components/AssetDetailRoute";
import { placementApi } from "../../lib/content-api";
import { errorMessage } from "../../lib/content-errors";
import { usePlacementStore } from "../../lib/placement-store";
import { placementDisplayName, placementFileType } from "../../lib/placement-to-viewer";
import { MatchingPointAttachments } from "../AssetEditor/MatchingPointAttachments";
import { usePlacementMap } from "./PlacementMapContext";
import { anchorChangeRequest } from "./placement-utils";

/**
 * A recognition target is an anchor asset, so the map shows the library's
 * asset panel for it. Its own section manages "attached content": placements
 * whose `anchor_id` is this anchor. Content edits reload the map so markers,
 * thumbnails and cached placement content follow the new reference image.
 */
export function AnchorPanel({ anchorId }: { anchorId: string }) {
  const { t } = useTranslation();
  const { tx, anchors, workspaceCanEdit, canWrite } = usePlacementMap();
  const placements = usePlacementStore((state) => state.placements);
  const anchor = anchors.find((item) => item.id === anchorId) ?? null;
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const children = useMemo(() => placements.filter((placement) => placement.anchor_id === anchorId && placement.status !== "archived"), [placements, anchorId]);
  const available = useMemo(
    () => placements.filter((placement) => !placement.anchor_id && placement.status !== "archived" && canWrite(placement) && placementFileType(placement) !== "anchor"),
    [placements, canWrite],
  );

  const attach = async (placementId: string, next: string | null) => {
    const placement = placements.find((item) => item.id === placementId);
    if (!placement || !canWrite(placement)) {
      setError(tx("contentModel.integration.map.anchors.childReadOnly"));
      return;
    }
    setAttaching(true);
    setError(null);
    try {
      const { request, draftedOnDetach } = anchorChangeRequest(placement, next);
      const updated = await placementApi.update(placement.id, request);
      const store = usePlacementStore.getState();
      store.upsertPlacements([updated]);
      if (draftedOnDetach) {
        store.setNotice({ tone: "warning", message: tx("contentModel.integration.map.anchors.detachedToDraft", { name: placementDisplayName(updated) }) });
      }
    } catch (failure) {
      setError(errorMessage(failure, tx));
    } finally {
      setAttaching(false);
    }
  };

  const label = (placement: (typeof placements)[number]) => ({ id: placement.id, name: placementDisplayName(placement) });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/20 p-4">
        <Text as="h3" variant="bodySm" fontWeight="semibold" truncate className="min-w-0 flex-1">{t("assetInspector.title")}</Text>
        <Button variant="ghost" size="sm" onClick={() => usePlacementStore.getState().selectAnchor(null)} aria-label={tx("contentModel.integration.map.action.close")}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="space-y-4 p-4">
        {!anchor && <ContentNotice title={tx("contentModel.integration.map.anchors.missing")} />}
        <AssetDetailView id={anchorId} inspector embedded onChanged={() => usePlacementStore.getState().requestReload()}>
          <MatchingPointAttachments
            canManage={workspaceCanEdit && !!anchor}
            childrenAssets={children.map(label)}
            availableAssets={available.map(label)}
            attaching={attaching}
            error={error}
            onAttach={(id) => void attach(id, anchorId)}
            onDetach={(id) => void attach(id, null)}
          />
        </AssetDetailView>
      </div>
    </Card>
  );
}
