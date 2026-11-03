"use client";

import { ManageLayoutSkeleton } from "@/app/manage/components/placements/ManageLayoutSkeleton";
import { PlacementMapView } from "@/app/manage/components/placements/PlacementMapView";
import { CollectionHeaderBar, ContentErrorState, ContentNotice } from "@/app/manage/content";
import { useCollections } from "@/app/manage/lib/collections";
import { collectionApi, isContentApiError } from "@/app/manage/lib/content-api";
import { teamHref, useCollectionInfo, useResourceTeam, useTeamContext } from "@/app/manage/lib/content-context";
import { ERROR_TEXTS, errorMessage, runContentAction } from "@/app/manage/lib/content-errors";
import { useIntegrationText, type IntegrationTexts } from "@/app/manage/lib/integration-text";
import { Button } from "@/components/ui/button";
import { WorkspaceQrButton } from "@/components/workspace-qr-button";
import { use, useMemo, type ReactNode } from "react";

const TEXTS: IntegrationTexts = {
  ...ERROR_TEXTS,
  "contentModel.integration.collectionDetail.notFound": ["合集不存在，或不属于你所在的团队。", "The collection does not exist or is not in your team."],
  "contentModel.integration.collectionDetail.archivedTitle": ["合集已归档", "Collection archived"],
  "contentModel.integration.collectionDetail.archivedBody": ["它的投放不在任何入口展示，内容只读。恢复后可继续编辑。", "Its placements show nowhere and the map is read-only. Restore it to edit again."],
  "contentModel.integration.collectionDetail.restore": ["恢复合集", "Restore"],
};

/**
 * /manage/collections/[id]: one map collection. The collection id is the
 * workspace UUID, so the existing placement map, its QR code
 * and old deep links keep working. Selection lives here only.
 */
export function CollectionDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CollectionDetailView key={id} id={id} />;
}

function CollectionDetailView({ id }: { id: string }) {
  const tx = useIntegrationText(TEXTS);
  const team = useTeamContext();
  const info = useCollectionInfo(id);
  const collection = info.collection;
  const organizationId = collection?.organization_id || team.organizationId;
  const siblings = useCollections(organizationId, "all");
  const organization = team.organizations.find((item) => item.id === organizationId) ?? null;
  const backHref = teamHref("/manage/collections", organizationId);
  const workspaces = useMemo(
    () => siblings.collections.map((item) => ({ id: item.id, name: item.name, description: item.description, organization_id: item.organization_id })),
    [siblings.collections],
  );

  // The owning team drives the URL and header; a later header switch leaves for that team's collections.
  const { settled } = useResourceTeam(collection?.organization_id, "/manage/collections");

  const archived = !!collection?.archived_at;
  const frame = (body: ReactNode) => (
    <main className="flex h-dvh flex-col overflow-hidden bg-muted/40">
      <CollectionHeaderBar
        name={collection?.name ?? null}
        archived={archived}
        backHref={backHref}
        actions={organizationId && collection && settled ? <WorkspaceQrButton organizationId={organizationId} workspaceId={id} /> : undefined}
      />
      <div className="relative min-h-0 flex-1">{body}</div>
    </main>
  );

  if (info.status === "loading" || info.status === "idle") return frame(<ManageLayoutSkeleton fill />);
  if (info.status === "error" || !collection) {
    const missing = isContentApiError(info.error) && (info.error.status === 404 || info.error.status === 403);
    return frame(
      <div className="mx-auto max-w-xl p-6">
        <div className="overflow-hidden rounded-lg border bg-background">
          <ContentErrorState headingAs="h2" message={missing ? tx("contentModel.integration.collectionDetail.notFound") : info.error ? errorMessage(info.error, tx) : undefined} onRetry={missing ? undefined : info.refresh} />
        </div>
      </div>,
    );
  }
  if (!settled) return frame(<ManageLayoutSkeleton fill />);
  const canEdit = !archived && !!collection.capabilities?.can_edit;
  return frame(
    <>
      {archived && (
        <div className="absolute inset-x-2 bottom-2 z-30 sm:inset-x-auto sm:start-3 sm:max-w-md">
          <ContentNotice
            className="bg-background shadow-sm"
            title={tx("contentModel.integration.collectionDetail.archivedTitle")}
            description={tx("contentModel.integration.collectionDetail.archivedBody")}
            action={collection.capabilities?.can_archive && (
              <Button variant="outline" size="sm" onClick={() => void runContentAction(() => collectionApi.restore(id), tx, info.refresh)}>
                {tx("contentModel.integration.collectionDetail.restore")}
              </Button>
            )}
          />
        </div>
      )}
      {/* Archive/restore changes every placement's capabilities: remount so the map reloads them. */}
      <PlacementMapView
        key={`${organizationId}:${id}:${archived ? "archived" : "open"}`}
        scope={{
          organizationId: organizationId as string,
          organization,
          workspaceId: id,
          workspaces: workspaces.length ? workspaces : [{ id, name: collection.name, description: collection.description, organization_id: collection.organization_id }],
          canEdit,
          capabilitiesLoading: false,
          fill: true,
        }}
      />
    </>,
  );
}
