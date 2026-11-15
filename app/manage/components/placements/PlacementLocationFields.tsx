"use client";

import { useId } from "react";
import { Crosshair, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "../AssetEditor/FieldLabel";
import { usePlacementStore } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";
import { Text } from "@/components/ui/typography";
import { PlacementFieldGroup } from "./PlacementFieldGroup";
import { formatCoordinate } from "./placement-utils";

interface PlacementLocationFieldsProps {
  longitude: string;
  latitude: string;
  altitude: string;
  disabled: boolean;
  onChange: (patch: { longitude?: string; latitude?: string; altitude?: string }) => void;
  /** Extra explicit source, e.g. "use photo GPS" in the create forms. */
  extraAction?: React.ReactNode;
  invalid?: boolean;
}

/**
 * Longitude / latitude / altitude inputs. A map click never overwrites them
 * by itself; "use clicked map location" copies it explicitly.
 */
export function PlacementLocationFields({ longitude, latitude, altitude, disabled, onChange, extraAction, invalid }: PlacementLocationFieldsProps) {
  const { tx } = usePlacementMap();
  const clicked = usePlacementStore((state) => state.clickedLocation);
  const id = useId();
  const candidateApplied = clicked && longitude !== "" && latitude !== "" && Number(longitude) === clicked.longitude && Number(latitude) === clicked.latitude && Number(altitude) === clicked.height;
  const fields = [
    { key: "longitude" as const, value: longitude, step: "0.000001", label: tx("contentModel.integration.map.field.longitude") },
    { key: "latitude" as const, value: latitude, step: "0.000001", label: tx("contentModel.integration.map.field.latitude") },
    { key: "altitude" as const, value: altitude, step: "0.01", label: tx("contentModel.integration.map.field.altitude") },
  ];
  return (
    <div className="space-y-2">
      <FieldLabel>{tx("contentModel.integration.map.field.location")}</FieldLabel>
      <Text as="p" variant="bodySm" tone="subdued" className="break-words tabular-nums">
        {longitude && latitude ? `${formatCoordinate(Number(longitude))}, ${formatCoordinate(Number(latitude))}` : tx("contentModel.integration.map.field.noLocation")}
      </Text>
      {!disabled && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => usePlacementStore.getState().setMobilePanel(null)}><MapPin className="size-4" aria-hidden />{tx("contentModel.integration.map.field.pickOnMap")}</Button>
        {extraAction}
      </div>}
      {!disabled && clicked && !candidateApplied && <div className="space-y-2 rounded-md bg-muted/40 p-2">
        <Text as="p" variant="bodySm" tone="subdued" className="break-words tabular-nums">{tx("contentModel.integration.map.field.candidate", { longitude: formatCoordinate(clicked.longitude), latitude: formatCoordinate(clicked.latitude) })}</Text>
        <Button type="button" variant="outline" size="sm" className="h-auto max-w-full whitespace-normal" onClick={() => onChange({ longitude: String(clicked.longitude), latitude: String(clicked.latitude), altitude: String(clicked.height) })}>
          <Crosshair className="size-4 shrink-0" aria-hidden />{tx("contentModel.integration.map.field.useClicked")}
        </Button>
      </div>}
      {!disabled && !clicked && (!longitude || !latitude) && <Text as="p" variant="bodySm" tone="subdued">{tx("contentModel.integration.map.field.clickHint")}</Text>}
      <PlacementFieldGroup title={tx("contentModel.integration.map.field.precise")} invalid={invalid}>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.key} className={field.key === "altitude" ? "col-span-2 space-y-1" : "min-w-0 space-y-1"}>
            <FieldLabel htmlFor={`${id}-${field.key}`}>{field.label}</FieldLabel>
            <Input
              id={`${id}-${field.key}`}
              type="number"
              inputMode="decimal"
              step={field.step}
              value={field.value}
              disabled={disabled}
              onChange={(event) => onChange({ [field.key]: event.target.value })}
              className="px-2 text-sm"
            />
          </div>
        ))}
      </div>
      </PlacementFieldGroup>
    </div>
  );
}
