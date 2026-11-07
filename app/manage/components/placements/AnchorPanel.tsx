"use client";

import { ContentNotice } from "@/app/manage/content/ContentFeedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { ExternalLink, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { placementApi } from "../../lib/content-api";
import { teamHref } from "../../lib/content-context";
import { errorMessage } from "../../lib/content-errors";
import { primaryResource } from "../../lib/content-mappers";
import { usePlacementStore } from "../../lib/placement-store";
import { isMappable, placementContentKey, placementDisplayName, placementFileType } from "../../lib/placement-to-viewer";
import { MatchingPointPanel } from "../AssetEditor/MatchingPointPanel";
import { useMatchingStatus } from "../AssetEditor/hooks/useMatchingStatus";
import { anchorPlacementOf } from "./AnchorList";
import { usePlacementMap } from "./PlacementMapContext";

const noop = () => {};

/**
 * Recognition target (anchor asset) panel. Uses the matching-point
 * panel and status hook (`/api/assets/[id]/matching` stays anchor-specific);
 * "attached content" are placements whose `anchor_id` is this anchor.
 * Replacing the reference image updates every use of the asset.
 */
export function AnchorPanel({ anchorId }: { anchorId: string }) {
  const { tx, organizationId, anchors, workspaceCanEdit, canWrite, focusPlacement } = usePlacementMap();
  const placements = usePlacementStore((state) => state.placements);
  const anchor = anchors.find((item) => item.id === anchorId) ?? null;
  const mapPlacement = anchorPlacementOf(anchorId, placements);
  const contents = usePlacementStore((state) => state.placementContents);
  const scope = usePlacementStore((state) => state.scopeKey);
  const pinned = mapPlacement && scope ? contents[placementContentKey(scope, mapPlacement)] : null;
  const imageUrl = mapPlacement
    ? (pinned?.kind === "asset" ? pinned.resources.find((file) => file.role === "reference" || file.role === "primary")?.url ?? null : null)
    : primaryResource(anchor)?.url ?? null;
  const matching = useMatchingStatus(anchorId, imageUrl);
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
      const updated = await placementApi.update(placement.id, { expectedLockVersion: placement.lock_version, anchorId: next });
      usePlacementStore.getState().upsertPlacements([updated]);
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
        <div className="min-w-0 flex-1">
          <Text as="h3" variant="bodySm" fontWeight="semibold" truncate>{tx("contentModel.integration.map.anchors.panelTitle")}</Text>
          <Text as="p" variant="bodyXs" tone="subdued" truncate>{anchor?.name || tx("contentModel.integration.map.anchors.unnamed")}</Text>
        </div>
        <Button variant="ghost" size="sm" onClick={() => usePlacementStore.getState().selectAnchor(null)} aria-label={tx("contentModel.integration.map.action.close")}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="space-y-4 p-4">
        {!anchor && <ContentNotice title={tx("contentModel.integration.map.anchors.missing")} />}
        <div className="flex flex-wrap gap-2">
          {mapPlacement && isMappable(mapPlacement) ? (
            <Button size="sm" variant="outline" onClick={() => focusPlacement(mapPlacement)}>
              <MapPin className="size-4" aria-hidden />
              {tx("contentModel.integration.map.anchors.openPlacement")}
            </Button>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">{tx("contentModel.integration.map.anchors.notOnMap")}</Text>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link href={teamHref(`/manage/assets/${anchorId}`, organizationId)}>
              <ExternalLink className="size-4" aria-hidden />
              {tx("contentModel.integration.map.source.openAsset")}
            </Link>
          </Button>
        </div>
        <MatchingPointPanel
          imageUrl={imageUrl}
          imageFile={null}
          isEditing={false}
          status={matching.status}
          updatedAt={matching.updatedAt}
          statusError={matching.error}
          onRefresh={matching.refresh}
          error={error}
          canManage={workspaceCanEdit && !!anchor}
          childrenAssets={children.map(label)}
          availableAssets={available.map(label)}
          attaching={attaching}
          onImageSelect={noop}
          onImageRemove={noop}
          onAttach={(id) => void attach(id, anchorId)}
          onDetach={(id) => void attach(id, null)}
        />
      </div>
    </Card>
  );
}
