"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AssetDetailHeader } from "./AssetDetailHeader";
import { AssetMaintenancePanel } from "./AssetMaintenancePanel";
import { AssetUsagePanel } from "./AssetUsagePanel";
import { AssetEditDialog, type AssetContentInput } from "./AssetEditDialog";
import { ContentNotice } from "./ContentFeedback";
import type {
  AssetDetailData,
  AssetUsageKind,
  AssetUsageSummary,
  ContentAction,
  ContentLoadStatus,
} from "./types";

export interface AssetDetailProps {
  inspector?: boolean;
  asset: AssetDetailData;
  preview?: ReactNode;
  /** Server capability: editing team members may edit content, rename and archive. */
  canMaintain: boolean;
  /** Set after a write returned a stale lock; the page reloads fresh data. */
  stale?: boolean;
  onReload?: () => void;

  initialText?: string;
  uploadAccept?: string;
  uploadProgress?: number | null;
  onEditContent: ContentAction<[input: AssetContentInput]>;

  usage: AssetUsageSummary;
  usageByKind: Record<AssetUsageKind, number>;
  usageStatus?: ContentLoadStatus;
  onRetryUsage?: () => void;
  usageHasMore?: boolean;
  usageLoadingMore?: boolean;
  onLoadMoreUsage?: () => void;

  onArchive: ContentAction;
  onRestore: ContentAction;

  /** Type-specific section (for example a recognition target's attachments), first in the body. */
  children?: ReactNode;
}

/** Asset detail: identity, content and usage in the main column; lifecycle beside. */
export function AssetDetail(props: AssetDetailProps) {
  const { t } = useTranslation();
  const [uploadOpen, setUploadOpen] = useState(false);
  const { asset } = props;
  const archived = asset.state === "archived";

  return (
    <div className="flex flex-col gap-6">
      <AssetDetailHeader asset={asset} inspector={props.inspector} canMaintain={props.canMaintain} onEditContent={() => setUploadOpen(true)} preview={props.preview} />

      {props.stale && (
        <ContentNotice
          tone="warning"
          title={t("contentModel.detail.staleTitle")}
          description={t("contentModel.detail.staleBody")}
          action={props.onReload && <Button variant="outline" size="sm" onClick={props.onReload}>{t("contentModel.action.reload")}</Button>}
        />
      )}
      {archived && <ContentNotice title={t("contentModel.detail.archivedTitle")} description={t("contentModel.detail.archivedBody")} />}
      {asset.fileMissing && <ContentNotice tone="critical" title={t("contentModel.detail.fileMissingTitle")} description={t("contentModel.detail.fileMissingBody")} />}

      <div className={props.inspector ? "flex flex-col gap-5" : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"}>
        <div className="flex min-w-0 flex-col gap-6">
          {props.children}
          <AssetUsagePanel
            compact={props.inspector}
            usage={props.usage}
            status={props.usageStatus}
            onRetry={props.onRetryUsage}
            hasMore={props.usageHasMore}
            loadingMore={props.usageLoadingMore}
            onLoadMore={props.onLoadMoreUsage}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <AssetMaintenancePanel
            compact={props.inspector}
            assetName={asset.name}
            state={asset.state}
            canMaintain={props.canMaintain}
            impact={props.usageByKind}
            onArchive={props.onArchive}
            onRestore={props.onRestore}
          />
        </div>
      </div>

      <AssetEditDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        assetName={asset.name}
        assetType={asset.type}
        key={String(uploadOpen)}
        initialText={props.initialText}
        accept={props.uploadAccept}
        progress={props.uploadProgress}
        onSubmit={props.onEditContent}
      />
    </div>
  );
}
