"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import type { ActivityLocation } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { ViewerFrame } from "../ViewerFrame";

export interface ActivityMapMarker {
  id: string;
  name: string;
  location: ActivityLocation | null;
}

interface ActivityLocationMapProps {
  markers: ActivityMapMarker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLocationChange: (id: string, location: ActivityLocation) => void;
  center?: { lat: number; lng: number } | null;
  disabled: boolean;
  title: string;
  fill?: boolean;
}

type MapStatus = "loading" | "ready" | "unavailable";
const MAP_READY_TIMEOUT_MS = 20_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function locationFrom(value: unknown): ActivityLocation | null {
  const data = record(value);
  if (!data || typeof data.longitude !== "number" || typeof data.latitude !== "number") return null;
  if (!Number.isFinite(data.longitude) || !Number.isFinite(data.latitude) || Math.abs(data.longitude) > 180 || Math.abs(data.latitude) > 90) return null;
  return { longitude: data.longitude, latitude: data.latitude };
}

/** Owns an isolated viewer; every edit updates this form's drafts, never a saved Placement. */
export function ActivityLocationMap(props: ActivityLocationMapProps) {
  const { t } = useTranslation();
  const { markers, selectedId, center, title } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const ready = useRef(false);
  const focusedId = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<MapStatus>("loading");

  const post = useCallback((type: string, payload: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: "manage", version: 1, type, payload },
      window.location.origin,
    );
  }, []);

  const syncDrafts = useCallback(() => {
    const current = latest.current;
    post("SET_ASSETS", current.markers.flatMap((marker) => {
      const location = locationFrom(marker.location);
      return location ? [{
        id: marker.id,
        name: marker.name,
        file_type: "text",
        file_url: null,
        text_content: marker.name,
        anchor_id: null,
        metadata: { ...location, height: 0 },
      }] : [];
    }));
    post("SET_SELECTION", { assetIds: current.selectedId ? [current.selectedId] : [] });
  }, [post]);

  const focusSelected = useCallback(() => {
    const current = latest.current;
    const marker = current.markers.find((entry) => entry.id === current.selectedId);
    const location = locationFrom(marker?.location);
    if (marker && location) post("FOCUS_ASSET", { id: marker.id, ...location, height: 0 });
    focusedId.current = current.selectedId;
  }, [post]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    ready.current = false;
    focusedId.current = null;
    const unavailable = () => {
      if (disposed) return;
      ready.current = false;
      setStatus("unavailable");
    };
    const timer = window.setTimeout(unavailable, MAP_READY_TIMEOUT_MS);
    const onError = () => {
      window.clearTimeout(timer);
      unavailable();
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (disposed || event.source !== iframe.contentWindow || event.origin !== window.location.origin) return;
      const message = record(event.data);
      if (message?.source !== "viewer") return;
      if (message.type === "VIEWER_READY") {
        window.clearTimeout(timer);
        ready.current = true;
        const origin = latest.current.center;
        if (origin && locationFrom({ longitude: origin.lng, latitude: origin.lat })) post("SET_ORIGIN", origin);
        syncDrafts();
        focusSelected();
        setStatus("ready");
        return;
      }
      if (!ready.current) return;
      const current = latest.current;
      const payload = record(message.payload);
      if (message.type === "ASSET_CLICKED") {
        const id = payload?.assetId;
        if (typeof id === "string" && current.markers.some((marker) => marker.id === id)) current.onSelect(id);
      } else if (message.type === "LOCATION_CLICKED") {
        const location = locationFrom(payload);
        const selected = current.markers.find((marker) => marker.id === current.selectedId);
        if (current.disabled || !selected || !location) {
          syncDrafts();
          return;
        }
        current.onLocationChange(selected.id, location);
      } else if (message.type === "ASSETS_MOVED") {
        if (current.disabled || !Array.isArray(payload?.moves)) {
          syncDrafts();
          return;
        }
        const moves = payload.moves.map((value: unknown) => {
          const move = record(value);
          const id = move?.assetId;
          const location = locationFrom(move);
          return typeof id === "string" && location && current.markers.some((marker) => marker.id === id)
            ? { id, location }
            : null;
        });
        // Reject the whole gesture if any marker is stale or the payload is malformed.
        if (moves.some((move) => !move)) {
          syncDrafts();
          return;
        }
        for (const move of moves) if (move) current.onLocationChange(move.id, move.location);
      }
    };
    window.addEventListener("message", onMessage);
    iframe.addEventListener("error", onError);
    return () => {
      disposed = true;
      ready.current = false;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("error", onError);
    };
  }, [attempt, focusSelected, post, syncDrafts]);

  useEffect(() => {
    if (!ready.current) return;
    syncDrafts();
    // Coordinate edits move markers without moving the camera on every click.
    if (focusedId.current !== selectedId) focusSelected();
  }, [markers, selectedId, syncDrafts, focusSelected]);

  useEffect(() => {
    if (!ready.current || !center || !locationFrom({ longitude: center.lng, latitude: center.lat })) return;
    const selected = latest.current.markers.find((marker) => marker.id === latest.current.selectedId);
    if (!locationFrom(selected?.location)) post("SET_ORIGIN", center);
  }, [center, post]);

  const retry = () => {
    ready.current = false;
    setStatus("loading");
    setAttempt((value) => value + 1);
  };

  return (
    <div role="region" aria-label={title} aria-busy={status === "loading"} className={`relative min-w-0 overflow-hidden bg-muted ${props.fill ? "h-full" : "h-80 rounded-lg border sm:h-96"}`}>
      <ViewerFrame key={attempt} iframeRef={iframeRef} title={title} />
      {status !== "ready" && (
        <div role={status === "unavailable" ? "alert" : "status"} className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          {status === "loading" && <Skeleton className="h-24 w-full max-w-sm" />}
          <Text as="p" variant="bodySm" tone="subdued" className="max-w-sm">{t(status === "loading" ? "activities.locationMapLoading" : "activities.locationMapUnavailable")}</Text>
          {status === "unavailable" && <Button type="button" variant="outline" onClick={retry}><RotateCw aria-hidden />{t("contentModel.action.retry")}</Button>}
        </div>
      )}
    </div>
  );
}
