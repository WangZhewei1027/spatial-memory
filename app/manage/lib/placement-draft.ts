import type { PlacementDto, PlacementStatus } from "@/lib/content-model/contracts";

export interface PlacementFormValues {
  name: string;
  status: PlacementStatus;
  longitude: string;
  latitude: string;
  altitude: string;
  anchorId: string | null;
  isHuge: boolean;
  scale: string;
  textColor: string;
  textSize: string;
  tagIds: string[];
}

/** Session-only edits retain the exact version they were based on. */
export interface PlacementDraft {
  base: PlacementDto;
  values: PlacementFormValues;
}
