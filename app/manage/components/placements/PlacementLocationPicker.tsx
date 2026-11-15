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
    <section aria-label={tx("contentModel.integration.map.field.pickOnMap")} className="pointer-events-auto absolute bottom-10 left-1/2 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 space-y-3 rounded-lg bg-background p-3 shadow-lg" data-location-picker onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); finish(false); } }}>
      <div className="h-10" role="status" aria-live="polite">
        <Text as="p" variant="bodySm" className="truncate tabular-nums">{point ? `${formatCoordinate(point.longitude)}, ${formatCoordinate(point.latitude)}` : tx("contentModel.integration.map.field.picking")}</Text>
        <Text as="p" variant="bodyXs" tone="subdued" className="tabular-nums">{point ? tx("contentModel.integration.map.field.heightSummary", { altitude: formatCoordinate(point.height, 2) }) : "\u00a0"}</Text>
      </div>
      <div className="flex justify-end gap-2">
        <Button ref={cancel} type="button" variant="outline" size="sm" onClick={() => finish(false)}>{tx("contentModel.integration.map.action.cancel")}</Button>
        <Button type="button" size="sm" disabled={!point} onClick={() => finish(true)}>{tx("contentModel.integration.map.field.useClicked")}</Button>
      </div>
    </section>
  );
}
