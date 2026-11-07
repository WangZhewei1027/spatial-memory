"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { AssetArchiveDialog } from "./AssetArchiveDialog";
import { ContentFailureNotice } from "./ContentFeedback";
import { ContentSection } from "./ContentSection";
import { useContentAction } from "./useContentAction";
import type { AssetUsageKind, ContentAction, ContentLifecycle } from "./types";

export interface AssetMaintenancePanelProps {
  compact?: boolean;
  assetName: string;
  state: ContentLifecycle;
  /** Server capability: any editing team member may archive or restore. */
  canMaintain: boolean;
  impact: Record<AssetUsageKind, number>;
  onArchive: ContentAction;
  onRestore: ContentAction;
}

/** Lifecycle of one team asset. Archiving is reversible and never breaks existing references. */
export function AssetMaintenancePanel(props: AssetMaintenancePanelProps) {
  const { t } = useTranslation();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const restore = useContentAction();
  const archived = props.state === "archived";

  return (
    <ContentSection plain={props.compact} title={t("contentModel.maintenance.title")}>
      <div className={props.compact ? "space-y-3" : "space-y-2 px-4 py-3"}>
        <Text as="p" variant="bodySm" tone="subdued">
          {archived ? t("contentModel.maintenance.archivedBody") : t("contentModel.maintenance.archiveHint")}
        </Text>
        {props.canMaintain && (archived ? (
          <Button variant="outline" size="sm" onClick={() => restore.run(props.onRestore)} disabled={restore.pending}>
            {restore.pending ? <Loader2 className="animate-spin" aria-hidden /> : <ArchiveRestore aria-hidden />}
            {t("contentModel.maintenance.restore")}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
            <Archive aria-hidden />
            {t("contentModel.maintenance.archive")}
          </Button>
        ))}
        {restore.failure && <ContentFailureNotice failure={restore.failure} />}
      </div>
      <AssetArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} assetName={props.assetName} impact={props.impact} onArchive={props.onArchive} />
    </ContentSection>
  );
}
