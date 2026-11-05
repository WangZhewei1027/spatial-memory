"use client";

import { CREATABLE_TYPES } from "@/app/manage/assets/components/AssetContentField";
import { AssetCreateDialog } from "@/app/manage/assets/components/AssetCreateDialog";
import { ASSET_TEXTS } from "@/app/manage/assets/components/texts";
import { TeamShell } from "@/app/manage/components/TeamShell";
import {
  ContentWorkbench,
  DEFAULT_WORKBENCH_FILTERS,
  WORKBENCH_TYPE_FILTERS,
  type ContentLibraryKind,
  type WorkbenchFilters,
  type WorkbenchItem,
  type WorkbenchTypeFilter,
} from "@/app/manage/content";
import { isEndpointMissing, newIdempotencyKey, organizationApi, sceneApi } from "@/app/manage/lib/content-api";
import { teamCanWrite, teamHref, type TeamContext } from "@/app/manage/lib/content-context";
import { errorMessage, runContentAction } from "@/app/manage/lib/content-errors";
import { useIntegrationText } from "@/app/manage/lib/integration-text";
import { SceneImportDialog } from "@/app/manage/scenes/components/SceneImportDialog";
import type { AssetDto } from "@/lib/content-model/contracts";
import { DEFAULT_UPLOAD_TYPES } from "@/lib/upload/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWorkbenchData } from "./useWorkbenchData";


function readType(value: string | null): WorkbenchTypeFilter {
  return (WORKBENCH_TYPE_FILTERS as readonly string[]).includes(value ?? "") ? (value as WorkbenchTypeFilter) : "all";
}

/** Separate asset and scene libraries; the URL carries only team and asset type. */
export function WorkbenchRoute({ team, kind }: { team: TeamContext; kind: ContentLibraryKind }) {
  const { t } = useTranslation();
  const tx = useIntegrationText(ASSET_TEXTS);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const organizationId = team.organizationId as string;
  // The type filter lives in the URL (direct links and back/forward);
  // search text and lifecycle are page-local.
  const type = kind === "asset" ? readType(params.get("type")) : "all";
  const [local, setLocal] = useState<Pick<WorkbenchFilters, "query" | "state">>({ query: DEFAULT_WORKBENCH_FILTERS.query, state: DEFAULT_WORKBENCH_FILTERS.state });
  const filters = useMemo<WorkbenchFilters>(() => ({ ...local, type }), [local, type]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const createKey = useRef<string | null>(null);

  const data = useWorkbenchData(organizationId, kind, filters);
  const canWrite = teamCanWrite({ archivedAt: team.organization?.archived_at, orgRole: team.organization?.role, globalRole: team.currentUserRole });
  const teamName = team.organization?.name ?? tx("contentModel.integration.assets.unknownOrganization");
  const types = useMemo(() => {
    const allowed = (team.organization?.allowed_file_types ?? DEFAULT_UPLOAD_TYPES) as readonly string[];
    return CREATABLE_TYPES.filter((type) => allowed.includes(type));
  }, [team.organization]);

  const changeFilters = (next: WorkbenchFilters) => {
    setLocal({ query: next.query, state: next.state });
    if (next.type === type) return;
    const query = new URLSearchParams(params.toString());
    if (next.type === "all") query.delete("type");
    else query.set("type", next.type);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  const itemHref = useCallback(
    (item: WorkbenchItem) => teamHref(item.kind === "scene" ? `/manage/scenes/${item.id}` : `/manage/assets/${item.id}`, organizationId),
    [organizationId],
  );
  const created = (asset: AssetDto) => {
    data.reload();
    toast.success(tx("contentModel.integration.assets.created", { name: asset.name ?? "" }), {
      action: { label: tx("contentModel.integration.assets.open"), onClick: () => router.push(teamHref(`/manage/assets/${asset.id}`, organizationId)) },
    });
  };

  const readOnlyReason = team.organization?.role === "viewer" ? t("contentModel.workbench.readOnlyViewer") : t("contentModel.workbench.readOnlyOther");
  const listError = data.error ? (isEndpointMissing(data.error) ? tx("contentModel.integration.assets.endpointMissing") : errorMessage(data.error, tx)) : undefined;

  return (
    <TeamShell organizationId={organizationId}>
      <ContentWorkbench
        kind={kind}
        filters={filters}
        onFiltersChange={changeFilters}
        status={data.status}
        errorMessage={listError}
        onRetry={data.reload}
        items={data.items}
        pagination={{ ...data, moreError: data.moreError ? errorMessage(data.moreError, tx) : null }}
        getItemHref={itemHref}
        canWrite={canWrite}
        readOnlyReason={readOnlyReason}
        canUpload={types.length > 0}
        onUpload={() => setUploadOpen(true)}
        onCreateScene={(name) => {
          createKey.current ??= newIdempotencyKey();
          return runContentAction(() => organizationApi.createScene(organizationId, { name, idempotencyKey: createKey.current! }), tx, (scene) => {
            createKey.current = null;
            router.push(teamHref(`/manage/scenes/${scene.id}`, organizationId));
          });
        }}
        onImportScene={() => setImportOpen(true)}
        onCopyScene={(sceneId, name) => runContentAction(() => sceneApi.copy(sceneId, { name, idempotencyKey: newIdempotencyKey() }), tx, (scene) => {
          data.reload();
          toast.success(t("contentModel.workbench.copied", { name: scene.name }), {
            action: { label: tx("contentModel.integration.assets.open"), onClick: () => router.push(teamHref(`/manage/scenes/${scene.id}`, organizationId)) },
          });
        })}
        onArchiveScene={(sceneId) => runContentAction(() => sceneApi.save(sceneId, { expectedLockVersion: data.sceneLock(sceneId), state: "archived" }), tx, data.reload)}
        onRestoreScene={(sceneId) => runContentAction(() => sceneApi.save(sceneId, { expectedLockVersion: data.sceneLock(sceneId), state: "active" }), tx, data.reload)}
      />
      {canWrite && (
        <>
          <AssetCreateDialog open={uploadOpen} onOpenChange={setUploadOpen} organizationId={organizationId} teamName={teamName} types={types} onCreated={created} />
          <SceneImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            teamName={teamName}
            organizationId={organizationId}
            onImported={(sceneId) => router.push(teamHref(`/manage/scenes/${sceneId}`, organizationId))}
          />
        </>
      )}
    </TeamShell>
  );
}
