"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard, FileJson, MoreHorizontal, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LibraryLayout, type LibraryPagination } from "./LibraryLayout";
import { ContentFailureNotice } from "./ContentFeedback";
import { SceneArchiveDialog } from "./SceneArchiveDialog";
import { SceneCopyDialog } from "./SceneCopyDialog";
import { SceneNameDialog } from "./SceneNameDialog";
import type { ContentActionFailure } from "./useContentAction";
import { WorkbenchItems } from "./WorkbenchItems";
import { WorkbenchEmpty } from "./WorkbenchEmpty";
import { WorkbenchToolbar } from "./WorkbenchToolbar";
import {
  DEFAULT_WORKBENCH_FILTERS,
  type ContentLibraryKind,
  type ContentAction,
  type ContentLoadStatus,
  type SceneRef,
  type WorkbenchFilters,
  type WorkbenchItem,
} from "./types";

export interface ContentWorkbenchProps {
  kind: ContentLibraryKind;
  filters: WorkbenchFilters;
  onFiltersChange: (filters: WorkbenchFilters) => void;
  status: ContentLoadStatus;
  errorMessage?: string;
  onRetry?: () => void;
  items: WorkbenchItem[];
  pagination: LibraryPagination;
  getItemHref: (item: WorkbenchItem) => string;
  /** Team-level write access. False shows the read-only explanation instead of create actions. */
  canWrite: boolean;
  /** Why the page is read-only (viewer role or archived team). */
  readOnlyReason?: string;
  /** Upload is offered only when the team allows at least one uploadable type. */
  canUpload?: boolean;
  onUpload: () => void;
  /** Resolves after the scene exists; the page usually opens the editor. */
  onCreateScene: ContentAction<[name: string]>;
  onImportScene?: () => void;
  onCopyScene: ContentAction<[sceneId: string, name: string]>;
  onArchiveScene: ContentAction<[sceneId: string]>;
  onRestoreScene: ContentAction<[sceneId: string]>;
}

const refOf = (item: WorkbenchItem): SceneRef => ({ id: item.id, name: item.name, placementCount: item.placementCount, activePlacementCount: item.activePlacementCount });

/** Shared thumbnail library, scoped to either scenes or basic assets. */
export function ContentWorkbench(props: ContentWorkbenchProps) {
  const { t } = useTranslation();
  const { kind, filters, canWrite, status, items } = props;
  const [createOpen, setCreateOpen] = useState(false);
  const [copying, setCopying] = useState<SceneRef | null>(null);
  const [archiving, setArchiving] = useState<SceneRef | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [failure, setFailure] = useState<ContentActionFailure | null>(null);
  const canUpload = kind === "asset" && canWrite && props.canUpload !== false;

  const restore = async (item: WorkbenchItem) => {
    setRestoring(item.id);
    setFailure(null);
    try {
      const result = await props.onRestoreScene(item.id);
      if (result && !result.ok) setFailure(result);
    } catch (error) {
      setFailure({ ok: false, kind: "error", message: error instanceof Error ? error.message : undefined });
    } finally {
      setRestoring(null);
    }
  };

  const uploadButton = (variant: "default" | "outline") => (
    <Button variant={variant} onClick={props.onUpload}><Upload aria-hidden />{t("contentModel.workbench.upload")}</Button>
  );
  const sceneButton = (variant: "default" | "outline") => (
    <Button variant={variant} onClick={() => setCreateOpen(true)}><Clapperboard aria-hidden />{t("contentModel.workbench.createScene")}</Button>
  );

  return (
    <>
      <LibraryLayout
        title={t(`contentModel.library.${kind}.title`)}
        readOnlyReason={canWrite ? undefined : props.readOnlyReason}
        actions={canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            {kind === "scene" ? sceneButton("default") : canUpload && uploadButton("default")}
            {kind === "scene" && props.onImportScene && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("contentModel.workbench.moreCreate")}><MoreHorizontal aria-hidden /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={props.onImportScene}><FileJson aria-hidden />{t("contentModel.workbench.importScene")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        toolbar={<WorkbenchToolbar kind={kind} filters={filters} onFiltersChange={props.onFiltersChange} />}
        pagination={props.pagination}
      >
        {failure && <ContentFailureNotice failure={failure} />}

        <WorkbenchItems
          status={status}
          errorMessage={props.errorMessage}
          onRetry={props.onRetry}
          items={items}
          getItemHref={props.getItemHref}
          busyId={restoring}
          actions={canWrite ? { onCopy: (item) => setCopying(refOf(item)), onArchive: (item) => setArchiving(refOf(item)), onRestore: restore } : undefined}
          empty={<WorkbenchEmpty kind={kind} filters={filters} canWrite={canWrite} canUpload={canUpload} onClear={() => props.onFiltersChange({ ...DEFAULT_WORKBENCH_FILTERS })} onUpload={props.onUpload} onCreateScene={() => setCreateOpen(true)} />}
        />
      </LibraryLayout>

      <SceneNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("contentModel.scene.createTitle")}
        description={t("contentModel.scene.createBody")}
        submitLabel={t("contentModel.scene.createAction")}
        onSubmit={props.onCreateScene}
      />
      <SceneCopyDialog scene={copying} onOpenChange={(open) => { if (!open) setCopying(null); }} onCopy={props.onCopyScene} />
      <SceneArchiveDialog scene={archiving} onOpenChange={(open) => { if (!open) setArchiving(null); }} onArchive={props.onArchiveScene} />
    </>
  );
}
