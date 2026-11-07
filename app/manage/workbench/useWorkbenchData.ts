"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { AssetDto, SceneSummaryDto } from "@/lib/content-model/contracts";
import type { ContentLibraryKind, WorkbenchFilters, WorkbenchItem } from "../content/types";
import { getTeamLibraryPage, organizationApi } from "../lib/content-api";
import { isLibraryAsset, toWorkbenchAsset, toWorkbenchScene } from "../lib/content-mappers";
import { useLibraryPages, useLibrarySearch } from "./useLibraryPages";
import { subscribeContentChanges } from "../lib/content-events";

const NO_PEOPLE = new Map();

export function useWorkbenchData(organizationId: string, kind: ContentLibraryKind, filters: WorkbenchFilters) {
  const q = useLibrarySearch(filters.query.trim());
  const { state, type } = filters;
  const load = useCallback((offset: number, limit: number, signal: AbortSignal) => {
    const query = { q, state, limit, offset };
    if (kind === "scene") return getTeamLibraryPage(organizationId, "scenes", query, signal);
    return organizationApi.assets(organizationId, { ...query, view: "all", file_type: type === "all" ? undefined : type }, signal);
  }, [organizationId, kind, q, state, type]);
  const list = useLibraryPages<AssetDto | SceneSummaryDto>(load);
  useEffect(() => kind === "asset" ? subscribeContentChanges(list.refresh) : undefined, [kind, list.refresh]);
  const items = useMemo(() => list.items.flatMap((row): WorkbenchItem[] => {
    if ("file_type" in row) return isLibraryAsset(row) ? [toWorkbenchAsset(row)] : [];
    return [toWorkbenchScene(row, NO_PEOPLE)];
  }), [list.items]);

  return { ...list, items, sceneLock: (id: string) => list.items.find(item => item.id === id)?.lock_version ?? 0 };
}
