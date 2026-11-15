"use client";

import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContentEmptyState } from "./ContentFeedback";
import type { ContentLibraryKind, WorkbenchFilters } from "./types";

/** Empty region that names the next step for the current filter. */
export function WorkbenchEmpty({ kind, filters, canWrite, canUpload, onClear, onUpload, onCreateScene }: {
  kind: ContentLibraryKind; filters: WorkbenchFilters; canWrite: boolean; canUpload: boolean; onClear: () => void; onUpload: () => void; onCreateScene: () => void;
}) {
  const { t } = useTranslation();
  const clear = <Button variant="outline" size="sm" onClick={onClear}>{t("contentModel.action.clearFilters")}</Button>;
  if (filters.query.trim()) {
    return <ContentEmptyState headingAs="h2" title={t("contentModel.workbench.empty.filteredTitle")} description={t("contentModel.workbench.empty.filteredBody")} actions={clear} />;
  }
  if (filters.state === "archived") {
    return <ContentEmptyState headingAs="h2" title={t("contentModel.workbench.empty.archivedTitle")} description={t(`contentModel.library.${kind}.archivedBody`)} actions={clear} />;
  }
  if (kind === "scene") {
    return (
      <ContentEmptyState
        headingAs="h2"
        title={t("contentModel.workbench.empty.sceneTitle")}
        description={t(canWrite ? "contentModel.workbench.empty.sceneBody" : `contentModel.library.${kind}.viewerBody`)}
        actions={canWrite && <Button size="sm" onClick={onCreateScene}>{t("contentModel.workbench.createScene")}</Button>}
      />
    );
  }
  if (kind === "anchor") {
    return <ContentEmptyState headingAs="h2" title={t("contentModel.library.anchor.emptyTitle")} description={t(`contentModel.library.anchor.${canUpload ? "emptyBody" : "viewerBody"}`)}
      actions={canUpload && <Button size="sm" onClick={onUpload}>{t("contentModel.library.anchor.create")}</Button>} />;
  }
  if (filters.type !== "all") {
    return (
      <ContentEmptyState
        headingAs="h2"
        title={t("contentModel.workbench.empty.typeTitle", { type: t(`contentModel.workbench.types.${filters.type}`) })}
        description={t(canUpload ? "contentModel.workbench.empty.assetBody" : `contentModel.library.${kind}.viewerBody`)}
        actions={canUpload ? <Button size="sm" onClick={onUpload}>{t("contentModel.workbench.upload")}</Button> : clear}
      />
    );
  }
  return (
    <ContentEmptyState
      headingAs="h2"
      title={t("contentModel.library.asset.emptyTitle")}
      description={t(canUpload ? "contentModel.workbench.empty.assetBody" : "contentModel.library.asset.viewerBody")}
      actions={canUpload && <Button size="sm" onClick={onUpload}><Upload aria-hidden />{t("contentModel.workbench.upload")}</Button>}
    />
  );
}
