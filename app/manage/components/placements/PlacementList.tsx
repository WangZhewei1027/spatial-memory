"use client";

import { ContentEmptyState, ContentErrorState, ContentListSkeleton } from "@/app/manage/content/ContentFeedback";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PlacementDto } from "@/lib/content-model/contracts";
import { useEffect, useMemo, useState } from "react";
import { usePlacementStore, type PlacementListTab } from "../../lib/placement-store";
import { placementFileType } from "../../lib/placement-to-viewer";
import { AnchorList } from "./AnchorList";
import { PlacementCard } from "./PlacementCard";
import { PlacementListHeader } from "./PlacementListHeader";
import { usePlacementMap } from "./PlacementMapContext";
import { listTabOf } from "./placement-utils";

const TABS: PlacementListTab[] = ["placements", "anchors"];

/**
 * Map content and recognition targets. Activities open from the map header.
 */
export function PlacementList({ visible }: { visible: PlacementDto[] }) {
  const { tx, tags, setViewerSelection } = usePlacementMap();
  const placements = usePlacementStore((state) => state.placements);
  const status = usePlacementStore((state) => state.status);
  const error = usePlacementStore((state) => state.error);
  const tab = usePlacementStore((state) => state.tab);
  const selectedId = usePlacementStore((state) => state.selectedPlacementId);
  const checkedIds = usePlacementStore((state) => state.selectedPlacementIds);
  const [selectMode, setSelectMode] = useState(false);

  const groups = useMemo(() => {
    const out: Record<PlacementListTab, PlacementDto[]> = { placements: [], anchors: [] };
    for (const placement of visible) out[listTabOf(placement)].push(placement);
    return out;
  }, [visible]);
  const fileTypes = useMemo(() => [...new Set(placements.map(placementFileType))].sort(), [placements]);

  // Map clicks may select a row in another group: follow it, then scroll it into view.
  useEffect(() => {
    if (!selectedId) return;
    const placement = usePlacementStore.getState().placements.find((item) => item.id === selectedId);
    if (!placement) return;
    const next = listTabOf(placement);
    if (usePlacementStore.getState().tab !== next) usePlacementStore.getState().setTab(next);
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(next === "anchors" && placement.target.kind === "asset" ? `anchor-card-${placement.target.asset_id}` : `placement-card-${selectedId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  const toggleSelectMode = () => {
    setSelectMode((value) => !value);
    usePlacementStore.getState().setSelectedPlacementIds([]);
    setViewerSelection([]);
  };

  const onSelect = (placement: PlacementDto) => {
    const store = usePlacementStore.getState();
    if (!selectMode) {
      store.selectPlacement(placement.id);
      return;
    }
    const ids = store.selectedPlacementIds.includes(placement.id)
      ? store.selectedPlacementIds.filter((id) => id !== placement.id)
      : [...store.selectedPlacementIds, placement.id];
    store.setSelectedPlacementIds(ids);
    setViewerSelection(ids);
  };

  const rows = groups[tab];
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <PlacementListHeader shownCount={visible.length} totalCount={placements.length} fileTypes={fileTypes} selectMode={selectMode} onToggleSelectMode={toggleSelectMode} />
      <Tabs value={tab} onValueChange={(value) => usePlacementStore.getState().setTab(value as PlacementListTab)} className="px-3 pt-2">
        <TabsList className="w-full">
          {TABS.map((key) => (
            <TabsTrigger key={key} value={key} className="flex-1 text-xs">
              {tx(`contentModel.integration.map.tab.${key}`)}
              {key === "placements" && <span className="ms-1 tabular-nums text-muted-foreground">{groups[key].length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "anchors" ? (
          <AnchorList anchorPlacements={groups.anchors} />
        ) : status === "loading" && !placements.length ? (
          <ContentListSkeleton label={tx("contentModel.integration.map.list.loading")} rows={4} />
        ) : status === "error" ? (
          <ContentErrorState message={error ?? undefined} onRetry={() => usePlacementStore.getState().requestReload()} />
        ) : rows.length === 0 ? (
          <ContentEmptyState
            title={tx(placements.length ? "contentModel.integration.map.list.noMatch" : `contentModel.integration.map.list.empty.${tab}`)}
            description={tx(placements.length ? "contentModel.integration.map.list.noMatchHint" : "contentModel.integration.map.list.emptyHint")}
          />
        ) : (
          <div className="divide-y">
            {rows.map((placement) => (
              <PlacementCard
                key={placement.id}
                placement={placement}
                tags={tags}
                selected={selectedId === placement.id}
                selectMode={selectMode}
                checked={checkedIds.includes(placement.id)}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
