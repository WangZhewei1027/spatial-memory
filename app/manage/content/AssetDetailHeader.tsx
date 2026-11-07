"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { ContentStatusBadge } from "./ContentStatusBadge";
import { ContentThumbnail } from "./ContentThumbnail";
import { useContentFormat } from "./useContentFormat";
import type { AssetDetailData } from "./types";

export interface AssetDetailHeaderProps {
  asset: AssetDetailData;
  canMaintain: boolean;
  onEditContent: () => void;
  /** Optional larger preview (image, model, audio) supplied by the page. */
  preview?: ReactNode;
  inspector?: boolean;
}

/** Identity block with the surface's single primary action: edit asset content. */
export function AssetDetailHeader({ asset, canMaintain, onEditContent, preview, inspector }: AssetDetailHeaderProps) {
  const { t } = useTranslation();
  const format = useContentFormat();
  const archived = asset.state === "archived";
  const facts: Array<[string, string]> = [
    [t("contentModel.detail.type"), t(`fileTypes.${asset.type}`)],
    [t("contentModel.detail.source"), t(`contentModel.filter.origins.${asset.origin}`)],
    [t("contentModel.detail.created"), format.date(asset.createdAt)],
    [t("contentModel.detail.updated"), format.date(asset.updatedAt)],
    // Informational only; it grants nothing.
    ...(asset.maintainer ? [[t("contentModel.detail.maintainer"), asset.maintainer.name] as [string, string]] : []),
  ];

  return (
    <header className={inspector ? "flex flex-col gap-4" : "flex flex-col gap-4 md:flex-row md:items-start"}>
      <div className="shrink-0">{preview ?? <ContentThumbnail type={asset.type} name={asset.name} thumbnailUrl={asset.thumbnailUrl} textExcerpt={asset.textExcerpt} />}</div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className={inspector ? "flex flex-col gap-3" : "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"}>
          <div className="min-w-0 space-y-1.5">
            <Text as={inspector ? "h3" : "h1"} variant={inspector ? "headingMd" : "headingLg"} breakWord>{asset.name}</Text>
            {(archived || asset.fileMissing) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {archived && <ContentStatusBadge kind="archived" />}
                {asset.fileMissing && <ContentStatusBadge kind="fileMissing" />}
              </div>
            )}
          </div>
          {canMaintain && !archived && (
            <Button onClick={onEditContent} className="self-start">
              <Upload aria-hidden />
              {t("contentModel.edit.action")}
            </Button>
          )}
        </div>
        <dl className={inspector ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3"}>
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="truncate text-sm" title={value}>{value}</dd>
            </div>
          ))}
        </dl>
        {!canMaintain && (
          <Text as="p" variant="bodySm" tone="subdued">{t("contentModel.detail.useOnlyHint")}</Text>
        )}
      </div>
    </header>
  );
}
