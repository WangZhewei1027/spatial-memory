"use client";

import { useId } from "react";
import { ListChecks, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { FileTypeFilter } from "../AssetManager/FileTypeFilter";
import { TagFilter } from "../AssetManager/TagFilter";
import { usePlacementStore, type PlacementStatusFilter } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";

const STATUS_FILTERS: PlacementStatusFilter[] = ["current", "active", "paused", "draft", "archived", "all"];

interface PlacementListHeaderProps {
  shownCount: number;
  totalCount: number;
  fileTypes: string[];
  selectMode: boolean;
  onToggleSelectMode: () => void;
}

/** Counts, refresh, multi-select and the status / type / tag filters of one collection. */
export function PlacementListHeader({ shownCount, totalCount, fileTypes, selectMode, onToggleSelectMode }: PlacementListHeaderProps) {
  const { tx, tags, isAll, workspaceId, workspaceCanEdit } = usePlacementMap();
  const statusId = useId();
  const loading = usePlacementStore((state) => state.status === "loading");
  const statusFilter = usePlacementStore((state) => state.statusFilter);
  const fileTypeFilter = usePlacementStore((state) => state.fileTypeFilter);
  const tagFilter = usePlacementStore((state) => state.tagFilter);
  const store = usePlacementStore.getState;

  return (
    <div className="space-y-2 border-b p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Text as="h2" variant="bodySm" fontWeight="semibold" truncate>{tx("contentModel.integration.map.list.title")}</Text>
          <Text as="p" variant="bodyXs" tone="subdued">{tx("contentModel.integration.map.list.count", { shown: shownCount, total: totalCount })}</Text>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant={selectMode ? "secondary" : "ghost"}
            size="sm"
            className="size-8 p-0"
            aria-pressed={selectMode}
            onClick={onToggleSelectMode}
            aria-label={tx("contentModel.integration.map.list.selectMode")}
            title={tx("contentModel.integration.map.list.selectMode")}
          >
            <ListChecks className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            disabled={loading}
            onClick={() => store().requestReload()}
            aria-label={tx("contentModel.integration.map.list.refresh")}
            title={tx("contentModel.integration.map.list.refresh")}
          >
            <RotateCw className={loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden />
          </Button>
        </div>
      </div>
      {!isAll && workspaceId && workspaceCanEdit && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => store().startCreate()}>
          <Plus className="size-4" aria-hidden />{tx("contentModel.integration.map.create.title")}
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={statusId} className="sr-only">{tx("contentModel.integration.map.filter.status")}</label>
        <Select value={statusFilter} onValueChange={(value) => store().setStatusFilter(value as PlacementStatusFilter)}>
          <SelectTrigger id={statusId} className="h-8 w-auto min-w-28 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((value) => (
              <SelectItem key={value} value={value}>{tx(`contentModel.integration.map.filter.${value}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FileTypeFilter fileTypes={fileTypes} selectedFileTypes={fileTypeFilter} onFileTypesChange={(value) => store().setFileTypeFilter(value)} />
        <TagFilter tags={tags} selectedTagIds={tagFilter} onTagsChange={(value) => store().setTagFilter(value)} />
      </div>
    </div>
  );
}
