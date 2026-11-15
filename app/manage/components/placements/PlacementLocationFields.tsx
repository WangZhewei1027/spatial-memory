"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { FieldLabel } from "../AssetEditor/FieldLabel";
import { usePlacementStore } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";
import { PlacementLocationPicker } from "./PlacementLocationPicker";

interface PlacementLocationFieldsProps {
  longitude: string;
  latitude: string;
  altitude: string;
  disabled: boolean;
  title?: string;
  onChange: (patch: { longitude?: string; latitude?: string; altitude?: string }) => void;
  extraAction?: React.ReactNode;
  invalid?: boolean;
}

/** Stable fields; map clicks are candidates until confirmed on the map. */
export function PlacementLocationFields({ longitude, latitude, altitude, disabled, title, onChange, extraAction, invalid }: PlacementLocationFieldsProps) {
  const { tx, mapOverlay } = usePlacementMap();
  const id = useId();
  const picking = usePlacementStore((state) => state.locationPickOwner === id);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (disabled) usePlacementStore.getState().endLocationPick(id);
    return () => usePlacementStore.getState().endLocationPick(id);
  }, [disabled, id]);
  const fields = [
    { key: "longitude" as const, value: longitude, step: "0.000001", label: tx("contentModel.integration.map.field.longitude"), min: -180, max: 180 },
    { key: "latitude" as const, value: latitude, step: "0.000001", label: tx("contentModel.integration.map.field.latitude"), min: -90, max: 90 },
    { key: "altitude" as const, value: altitude, step: "0.01", label: tx("contentModel.integration.map.field.altitude"), min: undefined, max: undefined },
  ];
  return (
    <section className="space-y-3" aria-labelledby={`${id}-title`} data-location-fields>
      <div className="flex items-center justify-between gap-2">
        <Text as="h3" id={`${id}-title`} variant="bodySm" fontWeight="semibold">{title || tx("contentModel.integration.map.field.location")}</Text>
        <Button ref={trigger} type="button" variant="outline" size="sm" className="shrink-0 gap-1 px-2 aria-pressed:bg-muted" disabled={disabled || !mapOverlay} aria-pressed={picking} data-location-pick-trigger onClick={() => usePlacementStore.getState().beginLocationPick(id)}>
          <MapPin className="size-4" aria-hidden />{tx("contentModel.integration.map.field.pickOnMap")}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.key} className={field.key === "altitude" ? "col-span-2 space-y-1" : "min-w-0 space-y-1"}>
            <FieldLabel htmlFor={`${id}-${field.key}`}>{field.label}</FieldLabel>
            <Input id={`${id}-${field.key}`} type="number" inputMode="decimal" step={field.step} min={field.min} max={field.max} value={field.value} disabled={disabled} aria-invalid={invalid || undefined} onChange={(event) => onChange({ [field.key]: event.target.value })} className="px-2 text-sm tabular-nums" />
          </div>
        ))}
      </div>
      {extraAction}
      {picking && !disabled && mapOverlay && createPortal(<PlacementLocationPicker owner={id} onApply={(point) => onChange({ longitude: String(point.longitude), latitude: String(point.latitude), altitude: String(point.height) })} onReturnFocus={() => trigger.current?.focus({ preventScroll: true })} />, mapOverlay)}
    </section>
  );
}
