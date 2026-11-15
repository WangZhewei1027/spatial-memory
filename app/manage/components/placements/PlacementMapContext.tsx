"use client";

import { createContext, useContext } from "react";
import type { AssetDto, PlacementDto } from "@/lib/content-model/contracts";
import type { UploadType } from "@/lib/upload/types";
import type { Organization, Tag, Workspace } from "../../types";
import type { IntegrationT } from "../../lib/integration-text";

export interface PlacementMapContextValue {
  tx: IntegrationT;
  organizationId: string;
  organization: Organization | null;
  /** Real project id; null in `__all__` (browse only) or before a choice. */
  workspaceId: string | null;
  isAll: boolean;
  workspaces: Workspace[];
  /** Server capability of the current project (never derived from org role). */
  workspaceCanEdit: boolean;
  workspaceInfoLoading: boolean;
  tags: Tag[];
  anchors: AssetDto[];
  anchorsStatus: "idle" | "loading" | "ready" | "error";
  anchorsError: string | null;
  reloadAnchors: () => void;
  /** Upload types the organization allows (team setting). */
  allowedUploadTypes: UploadType[];
  canWrite: (placement: PlacementDto) => boolean;
  canCopy: (placement: PlacementDto) => boolean;
  focusPlacement: (placement: PlacementDto) => void;
  setViewerSelection: (ids: string[]) => void;
  clearViewerSelection: () => void;
  /** Shared overlay host; its contents never affect grid or iframe geometry. */
  mapOverlay: HTMLDivElement | null;
  workspaceName: (id: string | null | undefined) => string;
}

const PlacementMapContext = createContext<PlacementMapContextValue | null>(null);

export const PlacementMapProvider = PlacementMapContext.Provider;

export function usePlacementMap(): PlacementMapContextValue {
  const value = useContext(PlacementMapContext);
  if (!value) throw new Error("usePlacementMap must be used inside PlacementMapView");
  return value;
}
