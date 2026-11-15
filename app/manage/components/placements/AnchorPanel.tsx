"use client";

import { ContentNotice } from "@/app/manage/content/ContentFeedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContentThumbnail } from "../../content/ContentThumbnail";
import { teamHref } from "../../lib/content-context";
import { thumbnailOf } from "../../lib/content-mappers";
import { placementApi } from "../../lib/content-api";
import { errorMessage } from "../../lib/content-errors";
import { usePlacementStore } from "../../lib/placement-store";
import { placementDisplayName, placementFileType } from "../../lib/placement-to-viewer";
import { MatchingPointAttachments } from "../AssetEditor/MatchingPointAttachments";
import { usePlacementMap } from "./PlacementMapContext";
import { anchorChangeRequest } from "./placement-utils";

/**
 * Collection-only associations. The target's identity, reference photos and
 * lifecycle are edited in its independent team library.
 */
export function AnchorPanel({ anchorId }: { anchorId: string }) {
  const { t } = useTranslation();
  const { tx, organizationId, anchors, workspaceCanEdit, canWrite } = usePlacementMap();
  const placements = usePlacementStore((state) => state.placements);
  const detail = usePlacementStore((state) => state.assetDetails[anchorId]);
  const anchor = detail ?? anchors.find((item) => item.id === anchorId) ?? null;
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
    <Card className="overflow-hidden" data-anchor-associations>
      <div className="flex items-center gap-2 border-b p-2">
        <ContentThumbnail type="anchor" name={anchor?.name || ""} thumbnailUrl={thumbnailOf(anchor)} className="size-10" />
        <div className="min-w-0 flex-1">
          <Text as="h2" variant="bodySm" fontWeight="semibold" truncate>{anchor?.name || tx("contentModel.integration.map.anchors.unnamed")}</Text>
          <Text as="p" variant="bodyXs" tone="subdued">{t("contentModel.library.anchor.mapAssociations")}</Text>
        </div>
        <Button variant="ghost" size="icon" asChild><Link href={teamHref(`/manage/anchors/${anchorId}`, organizationId)} target="_blank" rel="noopener noreferrer" aria-label={t("contentModel.library.anchor.edit")} title={t("contentModel.library.anchor.edit")}><ExternalLink className="size-4" aria-hidden /></Link></Button>
        <Button variant="ghost" size="icon" onClick={() => usePlacementStore.getState().selectAnchor(null)} aria-label={tx("contentModel.integration.map.action.close")}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="space-y-3 p-2">
        {!anchor && <ContentNotice title={tx("contentModel.integration.map.anchors.missing")} />}
        {placements.filter((p) => p.target.kind === "asset" && p.target.asset_id === anchorId && p.status !== "archived").map((p) => (
          <Button key={p.id} variant="outline" size="sm" className="w-full" onClick={() => usePlacementStore.getState().selectPlacement(p.id)}>{t("contentModel.library.anchor.editPlacement")}</Button>
        ))}
          <MatchingPointAttachments
            canManage={workspaceCanEdit && !!anchor}
            childrenAssets={children.map(label)}
            availableAssets={available.map(label)}
            attaching={attaching}
            error={error}
            onAttach={(id) => void attach(id, anchorId)}
            onDetach={(id) => void attach(id, null)}
          />
      </div>
    </Card>
  );
}
