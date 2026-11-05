"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ContentErrorState } from "./ContentFeedback";
import { LIBRARY_GRID, LibraryGridSkeleton } from "./LibraryCard";
import { WorkbenchCard } from "./WorkbenchCard";
import type { SceneItemActions } from "./WorkbenchItemParts";
import type { ContentLoadStatus, WorkbenchItem } from "./types";

export interface WorkbenchItemsProps {
  status: ContentLoadStatus;
  errorMessage?: string;
  onRetry?: () => void;
  items: WorkbenchItem[];
  getItemHref: (item: WorkbenchItem) => string;
  actions?: SceneItemActions;
  busyId?: string | null;
  /** Rendered when the list is ready and empty. */
  empty: ReactNode;
}

/** Thumbnail grid of team content with matching loading, error and empty regions. */
export function WorkbenchItems({ status, errorMessage, onRetry, items, getItemHref, actions, busyId, empty }: WorkbenchItemsProps) {
  const { t } = useTranslation();
  const label = t("contentModel.workbench.listLabel");

  if (status === "loading") {
    return <LibraryGridSkeleton label={t("contentModel.state.loading")} />;
  }
  if (status === "error") {
    return (
      <div className="my-auto">
        <ContentErrorState headingAs="h2" message={errorMessage} onRetry={onRetry} />
      </div>
    );
  }
  if (items.length === 0) return <div className="my-auto">{empty}</div>;

  return (
    <ul aria-label={label} className={LIBRARY_GRID}>
      {items.map((item) => (
        <WorkbenchCard key={`${item.kind}:${item.id}`} item={item} href={getItemHref(item)} actions={actions} busy={busyId === item.id} />
      ))}
    </ul>
  );
}
