"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { organizationApi } from "../../lib/content-api";
import { resourceFromAsset, type PerformanceKind } from "./scene-performance";
import type { SceneResource } from "./types";

interface CatalogOptions {
  organizationId: string | null;
  enabled: boolean;
  kind: PerformanceKind | "all";
  search: string;
  refreshKey: number;
}
interface CatalogState {
  key: string;
  items: SceneResource[];
  loading: boolean;
  loadingMore: boolean;
  error: unknown | null;
  hasMore: boolean;
}
const PAGE_SIZE = 20;
const MAX_SCAN_PAGES = 5;
const emptyState = (key: string): CatalogState => ({ key, items: [], loading: false, loadingMore: false, error: null, hasMore: false });

/** Team paging is independent of scene references and never controls their visibility. */
export function useSceneLibraryCatalog({ organizationId, enabled, kind, search, refreshKey }: CatalogOptions) {
  const key = JSON.stringify([organizationId, kind, search, refreshKey]);
  const [state, setState] = useState<CatalogState>(() => emptyState(key));
  const request = useRef<{ controller: AbortController; epoch: number } | null>(null);
  const epoch = useRef(0);
  const cursor = useRef(0);
  const more = useRef(false);
  const failed = useRef(false);

  const load = useCallback(async (reset: boolean) => {
    if (!enabled || !organizationId || (!reset && request.current)) return;
    request.current?.controller.abort();
    const controller = new AbortController();
    const currentEpoch = ++epoch.current;
    request.current = { controller, epoch: currentEpoch };
    if (reset) cursor.current = 0;
    failed.current = false;
    const initial = cursor.current === 0;
    setState(current => ({ ...(reset || current.key !== key ? emptyState(key) : current), loading: initial, loadingMore: !initial, error: null }));
    const isCurrent = () => !controller.signal.aborted && currentEpoch === epoch.current;

    try {
      // "All" includes documents/links the scene cannot render. Advance by raw
      // rows, scanning past unsupported pages instead of reporting an empty bin.
      // Bound each action so a large non-media catalog remains cancellable.
      for (let scanned = 0; scanned < MAX_SCAN_PAGES; scanned++) {
        const offset = cursor.current;
        const page = await organizationApi.assets(organizationId, {
          view: "all", q: search || undefined, file_type: kind === "all" ? undefined : kind,
          state: "active", limit: PAGE_SIZE, offset,
        }, controller.signal);
        if (!isCurrent()) return;
        const items = page.data
          .filter(asset => asset.capabilities.can_use_in_workspace !== false)
          .map(resourceFromAsset).filter((resource): resource is SceneResource => resource !== null);
        cursor.current = offset + page.data.length;
        more.current = page.data.length > 0 && cursor.current < (page.page?.total ?? cursor.current);
        setState(current => ({ ...current, items: Array.from(new Map([...current.items, ...items].map(item => [item.assetId, item])).values()), hasMore: more.current }));
        if (items.length || !more.current) break;
      }
    } catch (error) {
      if (!isCurrent()) return;
      failed.current = true;
      // The cursor advances only after a successful response, so retry resumes
      // at the failed page without discarding already loaded media.
      setState(current => ({ ...current, error }));
    } finally {
      if (isCurrent()) {
        request.current = null;
        setState(current => ({ ...current, loading: false, loadingMore: false }));
      }
    }
  }, [enabled, organizationId, kind, search, key]);

  useEffect(() => {
    const generation = epoch;
    cursor.current = 0;
    more.current = false;
    failed.current = false;
    setState(emptyState(key));
    if (enabled && organizationId) void load(true);
    return () => {
      generation.current++;
      request.current?.controller.abort();
      request.current = null;
    };
  }, [enabled, organizationId, key, load]);

  const active = enabled && !!organizationId;
  const visible = active && state.key === key ? state : { ...emptyState(key), loading: active };
  return {
    items: visible.items, loading: visible.loading, loadingMore: visible.loadingMore,
    error: visible.error, hasMore: visible.hasMore,
    loadMore: () => { if (more.current && !failed.current) void load(false); },
    retry: () => { if (failed.current) void load(false); },
  };
}
