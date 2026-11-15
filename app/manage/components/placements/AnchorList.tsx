"use client";

import { Focus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssetDto, PlacementDto } from "@/lib/content-model/contracts";
import { ContentEmptyState, ContentErrorState, ContentListSkeleton, ContentNotice } from "@/app/manage/content/ContentFeedback";
import { AssetThumbnail } from "../AssetManager/AssetThumbnail";
import { primaryResource } from "../../lib/content-mappers";
import { isMappable } from "../../lib/placement-to-viewer";
import { usePlacementStore } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";

/** Placement that puts this anchor on the map (anchors may also exist without one). */
export function anchorPlacementOf(anchorId: string, placements: readonly PlacementDto[]) {
  return placements.find((placement) => placement.target.kind === "asset" && placement.target.asset_id === anchorId && placement.status !== "archived") ?? null;
}

/**
 * Recognition targets of the current project — asset rows of type "anchor",
 * kept apart from the generic placement list (plan §6).
 */
export function AnchorList({ anchorPlacements }: { anchorPlacements: PlacementDto[] }) {
  const { tx, workspaceId, anchors, anchorsStatus, anchorsError, reloadAnchors, focusPlacement } = usePlacementMap();
  const placements = usePlacementStore((state) => state.placements);
  const selectedAnchorId = usePlacementStore((state) => state.selectedAnchorId);
  const selectedPlacementId = usePlacementStore((state) => state.selectedPlacementId);

  if (!workspaceId) {
    return (
      <div className="space-y-2 p-3">
        <ContentNotice title={tx("contentModel.integration.map.anchors.projectRequired")} />
        {anchorPlacements.length > 0 && (
          <ul className="divide-y">
            {anchorPlacements.map((placement) => (
              <li key={placement.id}>
                <AnchorRow name={placement.name ?? (placement.target.kind === "asset" ? placement.target.asset_name : null)} url={null} selected={selectedPlacementId === placement.id} placement={placement} onSelect={() => focusPlacement(placement)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (anchorsStatus === "loading") return <ContentListSkeleton label={tx("contentModel.integration.map.list.loading")} rows={3} />;
  if (anchorsStatus === "error") return <ContentErrorState message={anchorsError ?? undefined} onRetry={reloadAnchors} />;
  if (!anchors.length) return <ContentEmptyState title={tx("contentModel.integration.map.anchors.empty")} description={tx("contentModel.integration.map.anchors.emptyHint")} />;

  return (
    <ul className="divide-y">
      {anchors.map((anchor: AssetDto) => {
        const placement = anchorPlacementOf(anchor.id, placements);
        const selected = selectedAnchorId === anchor.id || (!!placement && selectedPlacementId === placement.id);
        return (
          <li key={anchor.id} id={`anchor-card-${anchor.id}`}>
            <AnchorRow
              name={anchor.name}
              url={primaryResource(anchor)?.url ?? null}
              selected={selected}
              placement={placement}
              onSelect={() => usePlacementStore.getState().selectAnchor(anchor.id)}
            />
          </li>
        );
      })}
    </ul>
  );
}

function AnchorRow({ name, url, selected, placement, onSelect }: { name: string | null; url: string | null; selected: boolean; placement: PlacementDto | null; onSelect: () => void }) {
  const { tx, focusPlacement } = usePlacementMap();
  const label = name || tx("contentModel.integration.map.anchors.unnamed");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2 border-l px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected ? "border-l-primary bg-primary/10" : "border-l-transparent hover:bg-muted/50",
      )}
    >
      <AssetThumbnail fileType="anchor" fileUrl={url} fileName={label} className="size-12 [&_svg]:size-5" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={label}>{label}</p>
        <p className="text-xs text-muted-foreground">
          {placement && isMappable(placement) ? tx("contentModel.integration.map.anchors.onMap") : tx("contentModel.integration.map.anchors.notOnMap")}
        </p>
      </div>
      {placement && isMappable(placement) && (
        <Button
          variant="ghost"
          size="sm"
          className="size-9 shrink-0 p-0 md:size-7"
          onClick={(event) => {
            event.stopPropagation();
            focusPlacement(placement);
          }}
          aria-label={tx("contentModel.integration.map.card.focus")}
          title={tx("contentModel.integration.map.card.focus")}
        >
          <Focus className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
