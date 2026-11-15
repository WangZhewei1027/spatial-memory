"use client";

import type { PlacementDto } from "@/lib/content-model/contracts";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { toast } from "sonner";
import { isLockConflict, placementApi } from "../lib/content-api";
import { errorMessage } from "../lib/content-errors";
import type { IntegrationT } from "../lib/integration-text";
import { usePlacementStore, type MapPoint } from "../lib/placement-store";
import { focusPayload, type ViewerPlacementItem } from "../lib/placement-to-viewer";

/** Drag result from the viewer; `assetId` is the id we sent = a Placement id. */
interface ViewerMove {
  assetId: string;
  longitude: number;
  latitude: number;
  height: number;
}

interface UsePlacementViewerInput {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Output of `toViewerItems` — ids are Placement ids. */
  items: ViewerPlacementItem[];
  mapCenter: { lat: number; lng: number } | null | undefined;
  /** Capability check for writes (false for `__all__`, viewers, shared rows). */
  canWrite: (placement: PlacementDto) => boolean;
  tx: IntegrationT;
}

function post(iframe: HTMLIFrameElement | null, type: string, payload: unknown) {
  iframe?.contentWindow?.postMessage({ type, payload, source: "manage", version: 1 }, "*");
}

/**
 * bridge to the map iframe. Same protocol as hooks/useViewerMessaging.ts,
 * but every id is a Placement id and drags persist through
 * `POST /api/placements/move` (all-or-nothing, per-item lock versions).
 * Refused or failed moves re-send SET_ASSETS so the map snaps back.
 */
export function usePlacementViewer({ iframeRef, items, mapCenter, canWrite, tx }: UsePlacementViewerInput) {
  const latest = useRef({ items, mapCenter, canWrite, tx });
  latest.current = { items, mapCenter, canWrite, tx };
  const pendingFocus = useRef<ReturnType<typeof focusPayload>>(null);
  const locationPicking = usePlacementStore((state) => state.locationPickOwner !== null);

  const sendAssets = useCallback(() => post(iframeRef.current, "SET_ASSETS", latest.current.items), [iframeRef]);
  const syncViewer = useCallback(() => {
    const iframe = iframeRef.current;
    const center = latest.current.mapCenter;
    if (center) post(iframe, "SET_ORIGIN", center);
    post(iframe, "SET_ASSETS", latest.current.items);
    post(iframe, "SET_LOCATION_PICKING", { enabled: usePlacementStore.getState().locationPickOwner !== null });
    if (pendingFocus.current) post(iframe, "FOCUS_ASSET", pendingFocus.current);
  }, [iframeRef]);

  // READY below also covers the viewer's asynchronous WebGL setup finishing
  // after the iframe load event.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.addEventListener("load", syncViewer);
    return () => iframe.removeEventListener("load", syncViewer);
  }, [iframeRef, syncViewer]);

  useEffect(() => {
    if (mapCenter) post(iframeRef.current, "SET_ORIGIN", mapCenter);
  }, [mapCenter, iframeRef]);

  useEffect(() => {
    sendAssets();
  }, [items, sendAssets]);

  useEffect(() => {
    post(iframeRef.current, "SET_LOCATION_PICKING", { enabled: locationPicking });
  }, [iframeRef, locationPicking]);

  useEffect(() => {
    const snapBack = () => post(iframeRef.current, "SET_ASSETS", latest.current.items);

    const persistMoves = async (moves: ViewerMove[]) => {
      if (!moves.length) return;
      const { tx: t, canWrite: writable } = latest.current;
      const store = usePlacementStore.getState();
      const byId = new Map(store.placements.map((placement) => [placement.id, placement]));
      const rows = moves.map((move) => ({ move, placement: byId.get(move.assetId) }));
      if (moves.some((move) => latest.current.items.some((item) => item.id === move.assetId && item.activityPlacementId))) {
        snapBack();
        toast.info(t("activities.moveHint"));
        return;
      }
      if (rows.some((row) => !row.placement || !writable(row.placement))) {
        snapBack();
        toast.warning(t("contentModel.integration.map.move.refused"));
        return;
      }
      try {
        const updated = await placementApi.move({
          moves: rows.map(({ move, placement }) => ({
            placementId: move.assetId,
            expectedLockVersion: placement!.lock_version,
            longitude: move.longitude,
            latitude: move.latitude,
            altitude: move.height,
          })),
        });
        usePlacementStore.getState().upsertPlacements(updated);
        toast.success(t("contentModel.integration.map.move.saved", { count: updated.length || moves.length }));
      } catch (error) {
        snapBack();
        if (isLockConflict(error)) {
          const message = t("contentModel.integration.map.move.conflict");
          usePlacementStore.getState().setNotice({ tone: "warning", message });
          usePlacementStore.getState().requestReload();
          toast.warning(message);
        } else {
          toast.error(errorMessage(error, t));
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data?.source !== "viewer" || event.source !== iframeRef.current?.contentWindow || event.origin !== window.location.origin) return;
      const store = usePlacementStore.getState();
      const known = (id: unknown): id is string => typeof id === "string" && store.placements.some((placement) => placement.id === id);
      switch (event.data?.type) {
        case "VIEWER_READY":
          if (event.source === iframeRef.current?.contentWindow && event.origin === window.location.origin) syncViewer();
          break;
        case "LOCATION_CLICKED":
          store.setClickedLocation(event.data.payload as MapPoint);
          break;
        case "ASSET_CLICKED": {
          const id = (event.data.payload as { assetId?: unknown })?.assetId;
          const activityMarker = latest.current.items.find((item) => item.id === id && item.activityPlacementId);
          if (activityMarker?.activityPlacementId) store.selectActivityPlacement(activityMarker.activityPlacementId);
          else if (known(id)) store.selectPlacement(id);
          break;
        }
        case "ASSETS_SELECTED": {
          const ids = ((event.data.payload as { assetIds?: unknown[] })?.assetIds ?? []).filter(known);
          store.setSelectedPlacementIds(ids);
          break;
        }
        case "ASSETS_MOVED":
          void persistMoves(((event.data.payload as { moves?: ViewerMove[] })?.moves ?? []));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    // Activity reactivation also replays state. Run after the origin/assets
    // effects so their SET_ORIGIN cannot override the queued focus afterward.
    syncViewer();
    return () => window.removeEventListener("message", onMessage);
  }, [iframeRef, syncViewer]);

  const focusPlacement = useCallback(
    (placement: PlacementDto) => {
      usePlacementStore.getState().selectPlacement(placement.id);
      const payload = focusPayload(placement);
      if (!payload) return;
      pendingFocus.current = payload;
      post(iframeRef.current, "FOCUS_ASSET", payload);
    },
    [iframeRef],
  );

  /** Mirror a list-driven multi-selection onto the map (the viewer does not echo it back). */
  const setViewerSelection = useCallback((ids: string[]) => post(iframeRef.current, "SET_SELECTION", { assetIds: ids }), [iframeRef]);
  const clearViewerSelection = useCallback(() => post(iframeRef.current, "CLEAR_SELECTION", {}), [iframeRef]);

  return { focusPlacement, setViewerSelection, clearViewerSelection, resendPlacements: sendAssets };
}
