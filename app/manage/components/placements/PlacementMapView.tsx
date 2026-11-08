"use client";

import type { PlacementDto } from "@/lib/content-model/contracts";
import { DEFAULT_UPLOAD_TYPES, type UploadType } from "@/lib/upload/types";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePlacementViewer } from "../../hooks/usePlacementViewer";
import { usePlacementStore } from "../../lib/placement-store";
import { placementScopeKey, toActivityViewerItems, toViewerItems } from "../../lib/placement-to-viewer";
import type { Organization, Workspace } from "../../types";
import { ViewerFrame } from "../ViewerFrame";
import { ManageGridLayout } from "./ManageGridLayout";
import { PlacementList } from "./PlacementList";
import { PlacementMapProvider, type PlacementMapContextValue } from "./PlacementMapContext";
import { PlacementSelectionBar } from "./PlacementSelectionBar";
import { PlacementSidebar } from "./PlacementSidebar";
import { usePlacementText } from "./placement-texts";
import { listTabOf, matchesFilters } from "./placement-utils";
import { usePlacementData } from "./usePlacementData";
import { activityApi } from "../../lib/activity-api";
import { useActivityQuery } from "../activities/useActivityQuery";

/** One map collection as the placement map sees it (the collection id is its workspace UUID). */
export interface PlacementMapScope {
  organizationId: string;
  organization: Organization | null;
  /** The open collection. */
  workspaceId: string;
  /** The team's collections, for collection names and copy targets. */
  workspaces: Workspace[];
  /** Server capability of the collection (`capabilities.can_edit`, not archived). */
  canEdit: boolean;
  capabilitiesLoading: boolean;
  /** Collection detail lays the grid out under its own header bar. */
  fill?: boolean;
}

/**
 * placement map of one collection: Placement list | map iframe | sidebar.
 * Rights come only from server capabilities (`placement.capabilities` and the
 * collection's `capabilities.can_edit`).
 */
export function PlacementMapView({ scope }: { scope: PlacementMapScope }) {
  const tx = usePlacementText();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { organizationId, workspaceId, organization, workspaces } = scope;
  const workspaceCanEdit = scope.canEdit;

  const data = usePlacementData({ organizationId, workspaceId, isAll: false, tx });
  const placements = usePlacementStore((state) => state.placements);
  const placementContents = usePlacementStore((state) => state.placementContents);
  const loadedScopeKey = usePlacementStore((state) => state.scopeKey);
  const scopeKey = placementScopeKey(organizationId, workspaceId);
  const statusFilter = usePlacementStore((state) => state.statusFilter);
  const fileTypeFilter = usePlacementStore((state) => state.fileTypeFilter);
  const tagFilter = usePlacementStore((state) => state.tagFilter);

  const visible = useMemo(
    () => loadedScopeKey === scopeKey ? placements.filter((placement) => matchesFilters(placement, { status: statusFilter, fileTypes: fileTypeFilter, tagIds: tagFilter })) : [],
    [placements, loadedScopeKey, scopeKey, statusFilter, fileTypeFilter, tagFilter],
  );
  const loadActivities = useCallback((signal: AbortSignal) => activityApi.collectionPlacements(workspaceId, signal), [workspaceId]);
  const activityPlacements = useActivityQuery(scopeKey, loadActivities);
  const loadActivityDefinitions = useCallback((signal: AbortSignal) => activityApi.list(organizationId, signal), [organizationId]);
  const activityDefinitions = useActivityQuery(organizationId, loadActivityDefinitions);
  const items = useMemo(() => [...toViewerItems(visible, placementContents, scopeKey), ...toActivityViewerItems(activityPlacements.data ?? [], activityDefinitions.data ?? [])], [visible, placementContents, scopeKey, activityPlacements.data, activityDefinitions.data]);

  const canWrite = useCallback(
    (placement: PlacementDto) =>
      placement.capabilities.can_edit,
    [],
  );
  const canCopy = useCallback(
    (placement: PlacementDto) => workspaceCanEdit && placement.capabilities.can_copy,
    [workspaceCanEdit],
  );

  const viewer = usePlacementViewer({ iframeRef, items, mapCenter: organization?.map_center, canWrite, tx });

  // `?placementId=` selects and focuses once the list contains it.
  const params = useSearchParams();
  const requestedId = params.get("placementId");
  const requestedTab = params.get("tab");
  useEffect(() => {
    if (requestedTab === "activities") usePlacementStore.getState().setActivitiesOpen(true);
  }, [requestedTab, workspaceId]);
  const applied = useRef<string | null>(null);
  const { focusPlacement } = viewer;
  useEffect(() => {
    if (!requestedId || applied.current === requestedId) return;
    const placement = placements.find((item) => item.id === requestedId);
    if (!placement) return;
    applied.current = requestedId;
    const store = usePlacementStore.getState();
    if (placement.status === "archived") store.setStatusFilter("all");
    store.setTab(listTabOf(placement));
    focusPlacement(placement);
  }, [requestedId, placements, focusPlacement]);

  const workspaceName = useCallback(
    (id: string | null | undefined) => (id ? workspaces.find((item) => item.id === id)?.name ?? id.slice(0, 8) : ""),
    [workspaces],
  );
  const allowedUploadTypes = (organization?.allowed_file_types ?? DEFAULT_UPLOAD_TYPES) as UploadType[];

  const value: PlacementMapContextValue = {
    tx,
    organizationId,
    organization,
    workspaceId,
    isAll: false,
    workspaces,
    workspaceCanEdit,
    workspaceInfoLoading: scope.capabilitiesLoading,
    tags: data.tags,
    anchors: data.anchors,
    anchorsStatus: data.anchorsStatus,
    anchorsError: data.anchorsError,
    reloadAnchors: data.reloadAnchors,
    allowedUploadTypes,
    canWrite,
    canCopy,
    focusPlacement: viewer.focusPlacement,
    setViewerSelection: viewer.setViewerSelection,
    clearViewerSelection: viewer.clearViewerSelection,
    workspaceName,
  };

  return (
    <PlacementMapProvider value={value}>
      <ManageGridLayout
        fill={scope.fill}
        list={<PlacementList visible={visible} />}
        viewer={
          <>
            <PlacementSelectionBar />
            <ViewerFrame iframeRef={iframeRef} organizationId={organizationId} />
          </>
        }
        sidebar={<PlacementSidebar />}
      />
    </PlacementMapProvider>
  );
}
