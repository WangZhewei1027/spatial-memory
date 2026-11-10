import type { PayloadScalar, PlacementDto, PlacementRenderConfig, UpdatePlacementRequest } from "@/lib/content-model/contracts";
import type { PlacementListTab, PlacementStatusFilter } from "../../lib/placement-store";
import { placementFileType } from "../../lib/placement-to-viewer";

/** Activity placements are loaded independently; content anchors keep their group. */
export function listTabOf(placement: PlacementDto): PlacementListTab {
  const type = placementFileType(placement);
  if (type === "anchor") return "anchors";
  return "placements";
}

/**
 * Update that attaches a placement to a recognition target, or detaches it
 * (`anchorId` null). An active placement needs GPS or a recognition target
 * to be discoverable, so detaching one without a map location also turns it
 * into a draft; `draftedOnDetach` lets the caller say so.
 */
export function anchorChangeRequest(placement: PlacementDto, anchorId: string | null): { request: UpdatePlacementRequest; draftedOnDetach: boolean } {
  const draftedOnDetach = anchorId === null && placement.status === "active" && !placement.location;
  return {
    request: { expectedLockVersion: placement.lock_version, anchorId, ...(draftedOnDetach ? { status: "draft" as const } : {}) },
    draftedOnDetach,
  };
}

export interface PlacementFilters {
  status: PlacementStatusFilter;
  fileTypes: string[];
  tagIds: string[];
}

export function matchesFilters(placement: PlacementDto, filters: PlacementFilters): boolean {
  if (filters.status === "current" && placement.status === "archived") return false;
  if (filters.status !== "current" && filters.status !== "all" && placement.status !== filters.status) return false;
  if (filters.fileTypes.length && !filters.fileTypes.includes(placementFileType(placement))) return false;
  if (filters.tagIds.length && !filters.tagIds.some((id) => placement.tag_ids.includes(id))) return false;
  return true;
}

/** Scalar-only copy of a presentation config map (the server rejects nested values such as `link`). */
export function scalarEntries(map: PlacementRenderConfig["config"] | Record<string, unknown> | undefined): Record<string, PayloadScalar> {
  const out: Record<string, PayloadScalar> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) out[key] = value as PayloadScalar;
  }
  return out;
}

export function formatCoordinate(value: number | null | undefined, digits = 6) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

/** Parse an optional numeric input ("" → null, invalid → NaN). */
export function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : Number.NaN;
}
