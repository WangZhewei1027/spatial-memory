"use client";

import { TeamPageLoading } from "@/app/manage/components/TeamShell";
import { AssetDetail, ContentErrorState } from "@/app/manage/content";
import { isContentApiError, isEndpointMissing } from "@/app/manage/lib/content-api";
import { teamCanWrite, teamHref, useResourceTeam, useTeamContext } from "@/app/manage/lib/content-context";
import { errorMessage } from "@/app/manage/lib/content-errors";
import { toDetailData, toUsageSummary, usageByKind } from "@/app/manage/lib/content-mappers";
import { acceptFor } from "@/app/manage/lib/content-upload";
import { useIntegrationText, type IntegrationT } from "@/app/manage/lib/integration-text";
import type { ContentActionResult } from "@/app/manage/content/types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, PencilLine } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isFileType, type CreatableType } from "./AssetContentField";
import { AssetDetailNotices } from "./AssetDetailNotices";
import { AssetDuplicateDialog } from "./AssetDuplicateDialog";
import { AssetNameDialog } from "./AssetNameDialog";
import { AssetPreview, hasPreview } from "./AssetPreview";
import { ASSET_TEXTS } from "./texts";
import { useAssetDetail } from "./useAssetDetail";
import { useAssetWrites } from "./useAssetWrites";
import { openAssetInspector } from "../../lib/asset-inspector";

function loadErrorText(error: unknown, tx: IntegrationT) {
  if (isEndpointMissing(error)) return tx("contentModel.integration.assets.endpointMissing");
  if (isContentApiError(error) && error.status === 404) return tx("contentModel.integration.assetDetail.notFound");
  if (isContentApiError(error) && error.status === 403) return tx("contentModel.integration.assetDetail.forbidden");
  return errorMessage(error, tx);
}

/** /manage/assets/[id]: identity, content, usage and lifecycle of one team asset. */
export function AssetDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Keyed by id so selection, stale and archive notices never leak into another asset.
  return <AssetDetailView key={id} id={id} />;
}

interface AssetDetailViewProps {
  id: string;
  inspector?: boolean;
  /**
   * Hosted inside another page (the collection map): the host owns the URL and
   * team, so no team routing, and library-only navigation is hidden.
   */
  embedded?: boolean;
  /** Called after a successful content, name or lifecycle write. */
  onChanged?: () => void;
  /** Type-specific section shown first in the panel body. */
  children?: ReactNode;
}

export function AssetDetailView({ id, inspector = false, embedded = false, onChanged, children }: AssetDetailViewProps) {
  const { t } = useTranslation();
  const tx = useIntegrationText(ASSET_TEXTS);
  const router = useRouter();
  const team = useTeamContext();
  const detail = useAssetDetail(id);
  const asset = detail.asset;
  const organizationId = asset?.organization_id ?? team.organizationId;
  const writes = useAssetWrites(detail, tx);
  // The asset's team drives the URL and header; a later header switch leaves for that team's assets.
  const routed = useResourceTeam(embedded ? null : asset?.organization_id, "/manage/assets");
  const settled = embedded || routed.settled;
  const notify = <A extends unknown[]>(write: (...args: A) => Promise<ContentActionResult>) => async (...args: A) => {
    const result = await write(...args);
    if (result.ok) onChanged?.();
    return result;
  };
  const [renameOpen, setRenameOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const workbenchHref = teamHref("/manage/assets", organizationId);
  const backLink = (
    <Button variant="ghost" size="sm" asChild>
      <Link href={workbenchHref}><ArrowLeft aria-hidden />{tx("contentModel.integration.assetDetail.back")}</Link>
    </Button>
  );
  const content = (body: ReactNode, actions?: ReactNode) => (
    <>{actions && <div className={`flex flex-wrap items-center gap-2 ${inspector ? "justify-start" : "justify-end"}`}>{actions}</div>}{body}</>
  );

  if (!asset) {
    if (detail.assetStatus === "loading") return content(<TeamPageLoading label={t("contentModel.state.loading")} />);
    const error = detail.assetError;
    return content(
      <div className="overflow-hidden rounded-lg border bg-background">
        <ContentErrorState message={loadErrorText(error, tx)} onRetry={detail.retryAsset} />
      </div>,
      inspector ? undefined : backLink,
    );
  }
  if (!settled) return content(<TeamPageLoading label={t("contentModel.state.loading")} />);

  const archived = asset.state === "archived";
  // Capabilities are computed by the server from the team role; every editing member may maintain.
  const canMaintain = asset.capabilities.can_maintain;
  const sameTeam = team.organization?.id === asset.organization_id;
  const canCopy = canMaintain || (sameTeam && teamCanWrite({ archivedAt: team.organization?.archived_at, orgRole: team.organization?.role, globalRole: team.currentUserRole }));
  const data = toDetailData(asset);
  const type = asset.file_type as CreatableType;

  return content(
    <>
      <AssetDetailNotices
        refreshError={detail.assetError}
        onRetry={detail.retryAsset}
        archiveImpact={writes.archiveImpact}
        onDismissArchive={writes.dismissArchiveImpact}
        tx={tx}
      />
      <AssetDetail
        inspector={inspector}
        asset={data}
        preview={hasPreview(asset) ? <AssetPreview content={asset} name={data.name} tx={tx} fullWidth={inspector} /> : undefined}
        canMaintain={canMaintain}
        stale={writes.stale}
        onReload={writes.reload}
        initialText={asset.payload.kind === "text" ? asset.payload.text : asset.payload.kind === "link" ? asset.payload.url : undefined}
        uploadAccept={isFileType(type) ? acceptFor(type) || undefined : undefined}
        uploadProgress={null}
        onEditContent={notify(writes.editContent)}
        usage={toUsageSummary(detail.usage?.impact, asset.organization_id)}
        usageByKind={usageByKind(detail.usage?.impact)}
        usageStatus={detail.usageStatus}
        onRetryUsage={detail.retryUsage}
        onArchive={notify(writes.archive)}
        onRestore={notify(writes.restore)}
      >
        {children}
      </AssetDetail>
      <AssetNameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={tx("contentModel.integration.assetDetail.renameTitle")}
        description={tx("contentModel.integration.assetDetail.renameBody")}
        nameLabel={tx("contentModel.integration.assetDetail.name")}
        submitLabel={tx("contentModel.integration.assetDetail.save")}
        cancelLabel={tx("contentModel.integration.assetDetail.cancel")}
        initialName={asset.name ?? ""}
        onSubmit={notify(writes.rename)}
      />
      <AssetDuplicateDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        assetId={asset.id}
        assetName={data.name}
        onDuplicated={(result) => inspector ? openAssetInspector(result.asset.id) : router.push(teamHref(`/manage/assets/${result.asset.id}`, asset.organization_id))}
        tx={tx}
      />
    </>,
    <>
      {!inspector && backLink}
      {!archived && canMaintain && (
        <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}><PencilLine aria-hidden />{tx("contentModel.integration.assetDetail.rename")}</Button>
      )}
      {!archived && canCopy && !embedded && (
        <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)}><Copy aria-hidden />{tx("contentModel.integration.assetDetail.duplicate")}</Button>
      )}
    </>,
  );
}
