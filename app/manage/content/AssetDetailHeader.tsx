"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { ContentStatusBadge } from "./ContentStatusBadge";
import { ContentThumbnail } from "./ContentThumbnail";
import { ContentSection } from "./ContentSection";
import { useContentFormat } from "./useContentFormat";
import type { AssetDetailData } from "./types";

export interface AssetDetailHeaderProps {
  asset: AssetDetailData;
  canMaintain: boolean;
  /** Hide the content action when the asset type edits its content elsewhere. */
  canEditContent?: boolean;
  onEditContent: () => void;
  /** Optional larger preview (image, model, audio) supplied by the page. */
  preview?: ReactNode;
  inspector?: boolean;
  actions?: ReactNode;
}

/** Supporting facts follow the content in an inspector, and sit beside it on a detail page. */
export function AssetDetailMetadata({ asset, inspector = false }: { asset: AssetDetailData; inspector?: boolean }) {
  const { t } = useTranslation();
  const format = useContentFormat();
  const facts: Array<[string, string]> = [
    ...(!inspector ? [
      [t("contentModel.detail.type"), t(`fileTypes.${asset.type}`)] as [string, string],
      [t("contentModel.detail.source"), t(`contentModel.filter.origins.${asset.origin}`)] as [string, string],
    ] : []),
    [t("contentModel.detail.created"), format.date(asset.createdAt)],
    [t("contentModel.detail.updated"), format.date(asset.updatedAt)],
    // Informational only; it grants nothing.
    ...(asset.maintainer ? [[t("contentModel.detail.maintainer"), asset.maintainer.name] as [string, string]] : []),
  ];
  const details = (
    <dl className={inspector ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3"}>
      {facts.map(([label, value]) => (
        <div key={label} className={inspector ? "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-4" : "min-w-0"}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className={inspector ? "break-words text-right text-sm" : "truncate text-sm"} title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
  return inspector ? <ContentSection plain title={t("contentModel.detail.information")}>{details}</ContentSection> : details;
}

/** Identity leads; secondary actions and the preview remain grouped with the asset. */
export function AssetDetailHeader({ asset, canMaintain, canEditContent = true, onEditContent, preview, inspector, actions }: AssetDetailHeaderProps) {
  const { t } = useTranslation();
  const archived = asset.state === "archived";

  return (
    <header className={inspector ? "flex flex-col gap-4" : "flex flex-col gap-4 md:flex-row md:items-start"}>
      {!inspector && <div className="shrink-0">{preview ?? <ContentThumbnail type={asset.type} name={asset.name} thumbnailUrl={asset.thumbnailUrl} textExcerpt={asset.textExcerpt} />}</div>}
      <div className="min-w-0 flex-1 space-y-3">
        <div className={inspector ? "flex flex-col gap-3" : "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"}>
          <div className="min-w-0 space-y-1.5">
            <Text as={inspector ? "h3" : "h1"} variant={inspector ? "headingMd" : "headingLg"} breakWord>{asset.name}</Text>
            {inspector && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{t(`fileTypes.${asset.type}`)}</span>
              <span aria-hidden>·</span>
              <span>{t(`contentModel.filter.origins.${asset.origin}`)}</span>
            </div>}
            {(archived || asset.fileMissing) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {archived && <ContentStatusBadge kind="archived" />}
                {asset.fileMissing && <ContentStatusBadge kind="fileMissing" />}
              </div>
            )}
          </div>
          {canMaintain && canEditContent && !archived && (
            <Button onClick={onEditContent} className="self-start">
              <Upload aria-hidden />
              {t("contentModel.edit.action")}
            </Button>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        {!inspector && <AssetDetailMetadata asset={asset} />}
        {!canMaintain && (
          <Text as="p" variant="bodySm" tone="subdued">{t("contentModel.detail.useOnlyHint")}</Text>
        )}
      </div>
      {inspector && asset.type !== "anchor" && <div className="min-w-0">{preview ?? <ContentThumbnail type={asset.type} name={asset.name} thumbnailUrl={asset.thumbnailUrl} textExcerpt={asset.textExcerpt} />}</div>}
    </header>
  );
}
