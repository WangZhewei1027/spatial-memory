"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { usePlacementStore, type MapPoint } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";
import { formatCoordinate } from "./placement-utils";

/** Map-local confirmation: the same rows and actions stay mounted while picking. */
export function PlacementLocationPicker({ owner, onApply, onReturnFocus }: { owner: string; onApply: (point: MapPoint) => void; onReturnFocus: () => void }) {
  const { tx } = usePlacementMap();
  const point = usePlacementStore((state) => state.clickedLocation);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus({ preventScroll: true });
  }, [owner]);

  const finish = (apply: boolean) => {
    const store = usePlacementStore.getState();
    if (store.locationPickOwner !== owner) return;
    if (apply && store.clickedLocation) onApply(store.clickedLocation);
    store.endLocationPick(owner, true);
    requestAnimationFrame(onReturnFocus);
  };

  return (
    <section aria-label={tx("contentModel.integration.map.field.pickOnMap")} className="pointer-events-auto absolute bottom-10 left-1/2 flex w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 items-center gap-2 rounded-md bg-background px-2 py-1 shadow-lg" data-location-picker onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); finish(false); } }}>
      <div className="h-9 min-w-0 flex-1" role="status" aria-live="polite">
        <Text as="p" variant="bodyXs" truncate title={point ? `${formatCoordinate(point.longitude)}, ${formatCoordinate(point.latitude)}` : undefined} className="tabular-nums">{point ? `${formatCoordinate(point.longitude)}, ${formatCoordinate(point.latitude)}` : tx("contentModel.integration.map.field.picking")}</Text>
        <Text as="p" variant="bodyXs" tone="subdued" className="tabular-nums">{point ? tx("contentModel.integration.map.field.heightSummary", { altitude: formatCoordinate(point.height, 2) }) : "\u00a0"}</Text>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button ref={cancel} type="button" variant="outline" size="sm" onClick={() => finish(false)}>{tx("contentModel.integration.map.action.cancel")}</Button>
        <Button type="button" size="sm" disabled={!point} onClick={() => finish(true)}>{tx("contentModel.integration.map.field.useClicked")}</Button>
      </div>
    </section>
  );
}
