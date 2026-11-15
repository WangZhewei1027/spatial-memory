"use client";

import { TeamPageLoading } from "@/app/manage/components/TeamShell";
import { AssetDetail, ContentErrorState } from "@/app/manage/content";
import { isContentApiError, isEndpointMissing } from "@/app/manage/lib/content-api";
import { teamCanWrite, teamHref, useResourceTeam, useTeamContext } from "@/app/manage/lib/content-context";
import { errorMessage } from "@/app/manage/lib/content-errors";
import { toDetailData, toUsageSummary, usageByKind } from "@/app/manage/lib/content-mappers";
import { acceptFor } from "@/app/manage/lib/content-upload";
import { useIntegrationText, type IntegrationT } from "@/app/manage/lib/integration-text";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, PencilLine } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isFileType, type CreatableType } from "./AssetContentField";
import { AssetDetailNotices } from "./AssetDetailNotices";
import { AssetDuplicateDialog } from "./AssetDuplicateDialog";
import { AssetNameDialog } from "./AssetNameDialog";
import { AssetPreview, hasPreview } from "./AssetPreview";
import { ASSET_TEXTS } from "./texts";
import { useAssetDetail } from "./useAssetDetail";
import { useAssetWrites } from "./useAssetWrites";
import { ASSET_INSPECTOR_PARAM, openAssetInspector } from "../../lib/asset-inspector";
import { AnchorReferenceImages } from "../../components/AssetEditor/AnchorReferenceImages";

function loadErrorText(error: unknown, tx: IntegrationT) {
  if (isEndpointMissing(error)) return tx("contentModel.integration.assets.endpointMissing");
  if (isContentApiError(error) && error.status === 404) return tx("contentModel.integration.assetDetail.notFound");
  if (isContentApiError(error) && error.status === 403) return tx("contentModel.integration.assetDetail.forbidden");
  return errorMessage(error, tx);
}

/** /manage/assets/[id]: identity, content, usage and lifecycle of one team asset. */
export function AssetDetailRoute({ params, library = "asset" }: { params: Promise<{ id: string }>; library?: "asset" | "anchor" }) {
  const { id } = use(params);
  // Keyed by id so selection, stale and archive notices never leak into another asset.
  return <AssetDetailView key={id} id={id} library={library} />;
}

interface AssetDetailViewProps {
  id: string;
  inspector?: boolean;
  library?: "asset" | "anchor";
}

export function AssetDetailView({ id, inspector = false, library = "asset" }: AssetDetailViewProps) {
  const { t } = useTranslation();
  const tx = useIntegrationText(ASSET_TEXTS);
  const router = useRouter();
  const team = useTeamContext();
  const detail = useAssetDetail(id);
  const asset = detail.asset;
  const organizationId = asset?.organization_id ?? team.organizationId;
  const writes = useAssetWrites(detail, tx);
  const libraryPath = library === "anchor" ? "/manage/anchors" : "/manage/assets";
  // The asset's team drives the URL and header; a later header switch leaves for that team's assets.
  const { settled } = useResourceTeam(asset?.organization_id, libraryPath);
  const wrongLibrary = !!asset && (asset.file_type === "anchor") !== (library === "anchor");
  useEffect(() => {
    if (!asset || !wrongLibrary) return;
    const path = asset.file_type === "anchor" ? "/manage/anchors" : "/manage/assets";
    router.replace(teamHref(inspector ? path : `${path}/${asset.id}`, asset.organization_id, inspector ? { [ASSET_INSPECTOR_PARAM]: asset.id } : undefined), { scroll: false });
  }, [asset, wrongLibrary, inspector, router]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const workbenchHref = teamHref(libraryPath, organizationId);
  const backLink = (
    <Button variant="ghost" size="sm" asChild>
      <Link href={workbenchHref}><ArrowLeft aria-hidden />{library === "anchor" ? t("contentModel.library.anchor.back") : tx("contentModel.integration.assetDetail.back")}</Link>
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
  if (!settled || wrongLibrary) return content(<TeamPageLoading label={t("contentModel.state.loading")} />);

  const archived = asset.state === "archived";
  // Capabilities are computed by the server from the team role; every editing member may maintain.
  const canMaintain = asset.capabilities.can_maintain;
  const sameTeam = team.organization?.id === asset.organization_id;
  const canCopy = canMaintain || (sameTeam && teamCanWrite({ archivedAt: team.organization?.archived_at, orgRole: team.organization?.role, globalRole: team.currentUserRole }));
  const data = toDetailData(asset);
  const type = asset.file_type as CreatableType;
  // Recognition targets keep several reference images, managed in their own section.
  const anchor = asset.file_type === "anchor";

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
        preview={!anchor && hasPreview(asset) ? <AssetPreview content={asset} name={data.name} tx={tx} fullWidth={inspector} /> : undefined}
        canMaintain={canMaintain}
        canEditContent={!anchor}
        stale={writes.stale}
        onReload={writes.reload}
        initialText={asset.payload.kind === "text" ? asset.payload.text : asset.payload.kind === "link" ? asset.payload.url : undefined}
        uploadAccept={isFileType(type) ? acceptFor(type) || undefined : undefined}
        uploadProgress={null}
        onEditContent={writes.editContent}
        usage={toUsageSummary(detail.usage?.impact, asset.organization_id)}
        usageByKind={usageByKind(detail.usage?.impact)}
        usageStatus={detail.usageStatus}
        onRetryUsage={detail.retryUsage}
        onArchive={writes.archive}
        onRestore={writes.restore}
      >
        {anchor && <AnchorReferenceImages asset={asset} canEdit={canMaintain && !archived} onChange={writes.editResources} />}
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
        onSubmit={writes.rename}
      />
      <AssetDuplicateDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        assetId={asset.id}
        assetName={data.name}
        onDuplicated={(result) => inspector ? openAssetInspector(result.asset.id) : router.push(teamHref(`${libraryPath}/${result.asset.id}`, asset.organization_id))}
        tx={tx}
      />
    </>,
    <>
      {!inspector && backLink}
      {!archived && canMaintain && (
        <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}><PencilLine aria-hidden />{tx("contentModel.integration.assetDetail.rename")}</Button>
      )}
      {!archived && canCopy && (
        <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)}><Copy aria-hidden />{tx("contentModel.integration.assetDetail.duplicate")}</Button>
      )}
    </>,
  );
}
