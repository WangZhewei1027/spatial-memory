// Presentation types for the team content components. They describe what the
// UI renders, not API DTOs; the integrating page maps service data into them.

export type ContentAssetType =
  | "image"
  | "video"
  | "audio"
  | "model"
  | "text"
  | "link"
  | "document";

export type ContentLifecycle = "active" | "archived";
export type AssetOrigin = "team_upload" | "public_submission" | "legacy";
export type PlacementStatus = "draft" | "active" | "paused" | "archived";

export interface ContentPerson {
  id: string;
  name: string;
}

// ───────────────────────── workbench ─────────────────────────

export type ContentLibraryKind = "asset" | "scene";

/** Content tile shared by the separate asset and scene libraries. */
export type WorkbenchType = "scene" | ContentAssetType;
export type WorkbenchTypeFilter = "all" | ContentAssetType;

export interface WorkbenchItem {
  id: string;
  /** Scenes open the editor; assets open their detail page. */
  kind: "asset" | "scene";
  name: string;
  type: WorkbenchType;
  thumbnailUrl?: string | null;
  textExcerpt?: string | null;
  state: ContentLifecycle;
  updatedAt: string;
  updatedBy?: ContentPerson | null;
  /** Scenes only: draft/publication state. */
  /** Scenes only: placements across all collections. */
  placementCount?: number;
  activePlacementCount?: number | null;
  fileMissing?: boolean;
}

export interface WorkbenchFilters {
  query: string;
  type: WorkbenchTypeFilter;
  state: ContentLifecycle;
}

export const DEFAULT_WORKBENCH_FILTERS: WorkbenchFilters = { query: "", type: "all", state: "active" };

// ───────────────────────── asset detail ─────────────────────────

export interface AssetDetailData {
  id: string;
  name: string;
  type: ContentAssetType;
  thumbnailUrl?: string | null;
  textExcerpt?: string | null;
  state: ContentLifecycle;
  origin: AssetOrigin;
  /** Informational only: every editing team member may maintain the asset. */
  maintainer: ContentPerson | null;
  updatedAt: string;
  createdAt: string;
  fileMissing?: boolean;
}

export type AssetUsageKind = "scene" | "placement" | "activity";

export interface AssetUsageEntry {
  id: string;
  kind: AssetUsageKind;
  /** Map collection of a placement; omitted for scenes (they belong to the team). */
  collectionName?: string | null;
  targetName: string;
  href?: string;
  placementStatus?: PlacementStatus;
}

export interface AssetUsageSummary {
  entries: AssetUsageEntry[];
  /** Total dependencies. */
  totalCount: number;
  /** Dependencies the server reports only as a count; usually zero inside one team. */
  restrictedCount: number;
}

// ───────────────────────── scenes ─────────────────────────

/** What the scene dialogs need to name and describe one scene. */
export interface SceneRef {
  id: string;
  name: string;
  placementCount?: number;
  activePlacementCount?: number | null;
}

// ───────────────────────── map collections ─────────────────────────

export interface CollectionItem {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string | null;
  archived: boolean;
  /** Server capabilities of this collection. */
  canEdit: boolean;
  canArchive: boolean;
}

export interface CollectionInput {
  name: string;
  description: string;
}

export type ContentLoadStatus = "loading" | "ready" | "error";

/** Outcome of a mutating callback. `void` is treated as success. */
export type ContentActionResult =
  | { ok: true }
  | {
      ok: false;
      kind: "conflict" | "forbidden" | "error";
      message?: string;
      /** Already-localized impact lines, e.g. "东街合集 · 灯会入口". */
      details?: string[];
    };

export type ContentAction<Args extends unknown[] = []> = (
  ...args: Args
) => Promise<ContentActionResult | void>;
