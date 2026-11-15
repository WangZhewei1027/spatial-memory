"use client";
import { subscribeContentChanges } from "../../lib/content-events";

import type { AssetDto, PlacementContentDto, PlacementDto } from "@/lib/content-model/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { assetApi, collectionApi, organizationApi, placementApi } from "../../lib/content-api";
import { errorMessage } from "../../lib/content-errors";
import type { IntegrationT } from "../../lib/integration-text";
import { usePlacementStore } from "../../lib/placement-store";
import { placementContentOf, placementScopeKey } from "../../lib/placement-to-viewer";
import type { Tag } from "../../types";

const RESOLVE_CONCURRENCY = 4;

interface PlacementDataInput {
  organizationId: string;
  /** Real project id, or null for `__all__` / no choice yet. */
  workspaceId: string | null;
  isAll: boolean;
  tx: IntegrationT;
}

/** Run `task` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function mergeById(lists: PlacementDto[][]): PlacementDto[] {
  const byId = new Map<string, PlacementDto>();
  for (const list of lists) for (const placement of list) byId.set(placement.id, placement);
  return [...byId.values()];
}

/**
 * Loads the placement list of the current scope into the placement store,
 * resolves fixed content through placement read access, and loads project
 * tags and anchors. Catalog detail is fetched separately for the selection.
 * Every request is aborted when the scope
 * changes and results are checked against the scope key, so a slow response
 * can never overwrite a newer selection.
 */
export function usePlacementData({ organizationId, workspaceId, isAll, tx }: PlacementDataInput) {
  const reloadNonce = usePlacementStore((state) => state.reloadNonce);
  const statusFilter = usePlacementStore((state) => state.statusFilter);
  const placements = usePlacementStore((state) => state.placements);
  const loadedScopeKey = usePlacementStore((state) => state.scopeKey);
  const selectedPlacementId = usePlacementStore((state) => state.selectedPlacementId);
  const selectedAnchorId = usePlacementStore((state) => state.selectedAnchorId);
  const scopeKey = !isAll && !workspaceId ? null : placementScopeKey(organizationId, workspaceId);
  const wantArchived = statusFilter === "archived" || statusFilter === "all";
  const txRef = useRef(tx);
  txRef.current = tx;

  useEffect(() => subscribeContentChanges(() => usePlacementStore.getState().requestReload()), []);

  // A new organization or project must reauthorize every cached read.
  useEffect(() => {
    usePlacementStore.getState().resetScope();
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey) return;
    const store = usePlacementStore.getState();
    store.beginLoad(scopeKey);
    const abort = new AbortController();
    const request = isAll || !workspaceId
      ? organizationApi.placements(organizationId, abort.signal)
      : Promise.all([
          collectionApi.placements(workspaceId, {  }, abort.signal),
          // The default list may omit archived rows; ask for them explicitly when the filter needs them.
          wantArchived ? collectionApi.placements(workspaceId, { status: "archived",  }, abort.signal) : Promise.resolve([]),
        ]).then(mergeById);
    request
      .then((list) => {
        if (!abort.signal.aborted) usePlacementStore.getState().loadSucceeded(scopeKey, list);
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        usePlacementStore.getState().loadFailed(scopeKey, errorMessage(error, txRef.current));
      });
    return () => abort.abort();
  }, [organizationId, workspaceId, isAll, scopeKey, wantArchived, reloadNonce]);

  // Preview requires placement read access, not access to its source catalog.
  useEffect(() => {
    const store = usePlacementStore.getState();
    if (!scopeKey || store.scopeKey !== scopeKey || loadedScopeKey !== scopeKey) return;
    const pending = store.placements.filter((placement) => !placementContentOf(placement, store.placementContents, scopeKey));
    if (!pending.length) return;
    const abort = new AbortController();
    let batch: PlacementContentDto[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!abort.signal.aborted && batch.length) usePlacementStore.getState().putPlacementContents(scopeKey, batch);
      batch = [];
    };
    void pool(pending, RESOLVE_CONCURRENCY, async (placement) => {
      if (abort.signal.aborted) return;
      try {
        const content = await placementApi.content(placement.id, workspaceId, abort.signal);
        if (!abort.signal.aborted) {
          batch.push(content);
          // Coalesce fast responses without waiting for the slowest preview.
          flushTimer ??= setTimeout(flush, 100);
        }
      } catch {
        // A failed fixed-content read leaves the existing unavailable preview.
        // A list reload retries it; catalog access is never a fallback.
      }
    }).then(flush);
    return () => {
      abort.abort();
      clearTimeout(flushTimer);
      batch = [];
    };
  }, [placements, loadedScopeKey, scopeKey, workspaceId, reloadNonce]);

  const selected = loadedScopeKey === scopeKey ? placements.find((placement) => placement.id === selectedPlacementId) : undefined;
  const sourceAssetId = selected?.target.kind === "asset" ? selected.target.asset_id : selectedAnchorId;
  const sourceLockVersion = selected?.target.kind === "asset" ? selected.target.asset_lock_version : null;
  useEffect(() => {
    if (!scopeKey || !sourceAssetId || usePlacementStore.getState().scopeKey !== scopeKey) return;
    const abort = new AbortController();
    usePlacementStore.getState().setAssetDetail(scopeKey, sourceAssetId, null);
    assetApi.get(sourceAssetId, abort.signal)
      .then((detail) => {
        if (!abort.signal.aborted) usePlacementStore.getState().setAssetDetail(scopeKey, sourceAssetId, detail);
      })
      .catch(() => {
        // Source actions stay unavailable; the placement preview is independent.
      });
    return () => abort.abort();
  }, [scopeKey, sourceAssetId, sourceLockVersion, reloadNonce]);

  const tags = useTags(organizationId, workspaceId, isAll, reloadNonce);
  const anchors = useAnchors(workspaceId, reloadNonce);
  return { tags, ...anchors };
}

function useTags(organizationId: string, workspaceId: string | null, isAll: boolean, reloadNonce: number) {
  const [result, setResult] = useState<{ key: string; tags: Tag[] } | null>(null);
  const key = isAll ? `org:${organizationId}` : workspaceId ? `ws:${workspaceId}` : null;
  useEffect(() => {
    if (!key) return;
    const abort = new AbortController();
    const query = key.startsWith("org:") ? `organization_id=${encodeURIComponent(organizationId)}` : `workspace_id=${encodeURIComponent(workspaceId ?? "")}`;
    fetch(`/api/tags?${query}`, { signal: abort.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { tags: [] }))
      .then((body: { tags?: Tag[] }) => setResult({ key, tags: body.tags ?? [] }))
      .catch(() => {
        if (!abort.signal.aborted) setResult({ key, tags: [] });
      });
    return () => abort.abort();
  }, [key, organizationId, workspaceId, reloadNonce]);
  return result && result.key === key ? result.tags : [];
}

/** Team target catalog used for placement associations; edits live in /manage/anchors. */
function useAnchors(workspaceId: string | null, reloadNonce: number) {
  const [result, setResult] = useState<{ key: string; anchors: AssetDto[]; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!workspaceId) return;
    const abort = new AbortController();
    collectionApi
      .assets(workspaceId, { file_type: "anchor", limit: 200 }, abort.signal)
      .then((page) => setResult({ key: workspaceId, anchors: page.data ?? [], error: null }))
      .catch((error) => {
        if (!abort.signal.aborted) setResult({ key: workspaceId, anchors: [], error: error instanceof Error ? error.message : String(error) });
      });
    return () => abort.abort();
  }, [workspaceId, reloadNonce, nonce]);
  const reloadAnchors = useCallback(() => setNonce((value) => value + 1), []);
  const current = workspaceId && result?.key === workspaceId ? result : null;
  return {
    anchors: current?.anchors ?? [],
    anchorsStatus: !workspaceId ? ("idle" as const) : current ? (current.error ? ("error" as const) : ("ready" as const)) : ("loading" as const),
    anchorsError: current?.error ?? null,
    reloadAnchors,
  };
}
