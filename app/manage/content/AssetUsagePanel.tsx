"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { ContentEmptyState, ContentErrorState, ContentListSkeleton } from "./ContentFeedback";
import { ContentSection } from "./ContentSection";
import type { AssetUsageEntry, AssetUsageKind, AssetUsageSummary, ContentLoadStatus } from "./types";

const KIND_ORDER: AssetUsageKind[] = ["scene", "placement", "activity"];

export interface AssetUsagePanelProps {
  compact?: boolean;
  usage: AssetUsageSummary;
  status?: ContentLoadStatus;
  onRetry?: () => void;
  /** Visible entries may be paged; request the next page. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

/**
 * Reverse dependencies grouped by how they pin the asset: saved scenes,
 * map placements (with their collection) and activity points. Anything the
 * server reports only as a count stays a count.
 */
export function AssetUsagePanel({ usage, status = "ready", onRetry, hasMore, loadingMore, onLoadMore, compact }: AssetUsagePanelProps) {
  const { t } = useTranslation();
  const groups = KIND_ORDER.map((kind) => ({ kind, entries: usage.entries.filter((entry) => entry.kind === kind) })).filter((group) => group.entries.length);
  const description = t("contentModel.usage.summary", { count: usage.totalCount });

  return (
    <ContentSection plain={compact} title={t("contentModel.usage.title")} description={status === "ready" ? description : undefined}>
      {status === "loading" && <ContentListSkeleton rows={3} label={t("contentModel.state.loading")} />}
      {status === "error" && <ContentErrorState onRetry={onRetry} />}
      {status === "ready" && usage.totalCount === 0 && (
          compact ? <Text as="p" variant="bodySm" tone="subdued">{t("contentModel.usage.emptyBody")}</Text>
            : <ContentEmptyState title={t("contentModel.usage.emptyTitle")} description={t("contentModel.usage.emptyBody")} />
      )}
      {status === "ready" && usage.totalCount > 0 && (
        <div className="divide-y">
          {groups.map((group) => (
            <div key={group.kind} className={compact ? "py-3" : "px-4 py-3"}>
              <Text as={compact ? "h4" : "h3"} variant="bodyXs" fontWeight="semibold" tone="subdued" className="mb-1.5">
                {t(`contentModel.usage.kind.${group.kind}`)}
              </Text>
              <ul className="space-y-1">
                {group.entries.map((entry) => <UsageRow key={entry.id} entry={entry} />)}
              </ul>
            </div>
          ))}
          {usage.restrictedCount > 0 && (
            <div className={`flex items-center gap-2 py-3 ${compact ? "" : "px-4"}`}>
              <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Text as="p" variant="bodySm" tone="subdued">{t("contentModel.usage.restricted", { count: usage.restrictedCount })}</Text>
            </div>
          )}
          {hasMore && onLoadMore && (
            <div className={compact ? "py-3" : "px-4 py-3"}>
              <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
                {loadingMore ? t("contentModel.state.loading") : t("contentModel.usage.showMore", { count: usage.totalCount - usage.restrictedCount - usage.entries.length })}
              </Button>
            </div>
          )}
        </div>
      )}
    </ContentSection>
  );
}

function UsageRow({ entry }: { entry: AssetUsageEntry }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
      <div className="min-w-0 flex-1 basis-48">
        {entry.href ? (
          <Link href={entry.href} className="text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            {entry.targetName}
          </Link>
        ) : (
          <Text as="span" variant="bodySm" fontWeight="medium">{entry.targetName}</Text>
        )}
        {entry.collectionName && <Text as="span" variant="bodyXs" tone="subdued" className="ms-2">{entry.collectionName}</Text>}
      </div>
      <div className="flex items-center gap-1.5">
        {entry.placementStatus && entry.placementStatus !== "active" && (
          <Text as="span" variant="bodyXs" tone="subdued">{t(`contentModel.placement.status.${entry.placementStatus}`)}</Text>
        )}
      </div>
    </li>
  );
}
