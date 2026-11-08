/** Map state scoped to one team and collection, including resolved playable content. */
import type { AssetDetailDto, PlacementContentDto, PlacementDto, PlacementStatus } from "@/lib/content-model/contracts";
import { create } from "zustand";
import { contentMatchesPlacement, placementContentKey } from "./placement-to-viewer";

export interface MapPoint {
  longitude: number;
  latitude: number;
  height: number;
}

/** "current" = everything except archived (default). */
export type PlacementStatusFilter = "current" | PlacementStatus | "all";

export type PlacementListTab = "placements" | "anchors";

export interface PlacementMapNotice {
  tone: "warning" | "critical";
  message: string;
}

interface PlacementStore {
  /** `${organizationId}|${workspaceId ?? "__all__"}` the list belongs to. */
  scopeKey: string | null;
  placements: PlacementDto[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** Increments after every successful list load (editors rebase on it). */
  loadedCount: number;
  reloadNonce: number;

  statusFilter: PlacementStatusFilter;
  fileTypeFilter: string[];
  tagFilter: string[];
  tab: PlacementListTab;
  activitiesOpen: boolean;

  selectedPlacementId: string | null;
  selectedActivityPlacementId: string | null;
  selectedPlacementIds: string[];
  selectedAnchorId: string | null;
  clickedLocation: MapPoint | null;
  notice: PlacementMapNotice | null;

  /** Resolved playable content by scope, placement and target. */
  placementContents: Record<string, PlacementContentDto>;
  /** Separately authorized catalog details for source actions, never preview. */
  assetDetails: Record<string, AssetDetailDto>;

  beginLoad: (scopeKey: string) => void;
  loadSucceeded: (scopeKey: string, placements: PlacementDto[]) => void;
  loadFailed: (scopeKey: string, error: string) => void;
  requestReload: () => void;
  upsertPlacements: (placements: PlacementDto[]) => void;

  setStatusFilter: (value: PlacementStatusFilter) => void;
  setFileTypeFilter: (value: string[]) => void;
  setTagFilter: (value: string[]) => void;
  setTab: (tab: PlacementListTab) => void;
  setActivitiesOpen: (open: boolean) => void;

  selectPlacement: (id: string | null) => void;
  selectActivityPlacement: (id: string | null) => void;
  setSelectedPlacementIds: (ids: string[]) => void;
  selectAnchor: (id: string | null) => void;
  setClickedLocation: (point: MapPoint | null) => void;
  setNotice: (notice: PlacementMapNotice | null) => void;

  putPlacementContents: (scopeKey: string, contents: PlacementContentDto[]) => void;
  setAssetDetail: (scopeKey: string, assetId: string, detail: AssetDetailDto | null) => void;
  /** Called when the organization/project changes: drops everything scope-bound. */
  resetScope: () => void;
}

const SCOPE_RESET = {
  scopeKey: null,
  placements: [] as PlacementDto[],
  status: "idle" as const,
  error: null,
  selectedPlacementId: null,
  selectedActivityPlacementId: null,
  activitiesOpen: false,
  selectedPlacementIds: [] as string[],
  selectedAnchorId: null,
  notice: null,
  placementContents: {} as Record<string, PlacementContentDto>,
  assetDetails: {} as Record<string, AssetDetailDto>,
};

export const usePlacementStore = create<PlacementStore>()((set) => ({
  ...SCOPE_RESET,
  loadedCount: 0,
  reloadNonce: 0,
  statusFilter: "current",
  fileTypeFilter: [],
  tagFilter: [],
  tab: "placements",
  clickedLocation: null,

  beginLoad: (scopeKey) =>
    set((state) =>
      state.scopeKey === scopeKey
        ? { status: "loading", error: null }
        : { ...SCOPE_RESET, scopeKey, status: "loading", tagFilter: [], fileTypeFilter: [] },
    ),
  loadSucceeded: (scopeKey, placements) =>
    set((state) => {
      if (state.scopeKey !== scopeKey) return {};
      const ids = new Set(placements.map((placement) => placement.id));
      return {
        placements,
        placementContents: {},
        status: "ready",
        error: null,
        loadedCount: state.loadedCount + 1,
        selectedPlacementIds: state.selectedPlacementIds.filter((id) => ids.has(id)),
      };
    }),
  loadFailed: (scopeKey, error) => set((state) => (state.scopeKey === scopeKey ? { status: "error", error } : {})),
  requestReload: () => set((state) => ({ reloadNonce: state.reloadNonce + 1 })),
  upsertPlacements: (incoming) =>
    set((state) => {
      if (!incoming.length) return {};
      const byId = new Map(incoming.map((placement) => [placement.id, placement]));
      const merged = state.placements.map((placement) => byId.get(placement.id) ?? placement);
      const known = new Set(state.placements.map((placement) => placement.id));
      const added = incoming.filter((placement) => !known.has(placement.id));
      return { placements: [...added, ...merged] };
    }),

  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setFileTypeFilter: (fileTypeFilter) => set({ fileTypeFilter }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  setTab: (tab) => set({ tab }),
  setActivitiesOpen: (activitiesOpen) => set({ activitiesOpen, selectedActivityPlacementId: null }),

  selectPlacement: (selectedPlacementId) => set({ selectedPlacementId, selectedAnchorId: null, selectedActivityPlacementId: null }),
  setSelectedPlacementIds: (selectedPlacementIds) => set({ selectedPlacementIds }),
  selectAnchor: (selectedAnchorId) => set({ selectedAnchorId, selectedPlacementId: null, selectedActivityPlacementId: null }),
  selectActivityPlacement: (selectedActivityPlacementId) => set({ selectedActivityPlacementId, ...(selectedActivityPlacementId ? { activitiesOpen: true } : {}) }),
  setClickedLocation: (clickedLocation) => set({ clickedLocation }),
  setNotice: (notice) => set({ notice }),

  putPlacementContents: (scopeKey, contents) =>
    set((state) => {
      if (state.scopeKey !== scopeKey || !contents.length) return {};
      const placements = new Map(state.placements.map((placement) => [placement.id, placement]));
      const placementContents = { ...state.placementContents };
      for (const content of contents) {
        const placement = placements.get(content.placement_id);
        if (placement && contentMatchesPlacement(content, placement)) {
          placementContents[placementContentKey(scopeKey, placement)] = content;
        }
      }
      return { placementContents };
    }),
  setAssetDetail: (scopeKey, assetId, detail) =>
    set((state) => {
      if (state.scopeKey !== scopeKey || (detail && detail.id !== assetId)) return {};
      const assetDetails = { ...state.assetDetails };
      if (detail) assetDetails[assetId] = detail;
      else delete assetDetails[assetId];
      return { assetDetails };
    }),
  resetScope: () => set({ ...SCOPE_RESET, clickedLocation: null }),
}));
