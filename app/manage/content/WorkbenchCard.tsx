"use client";

import { useTranslation } from "react-i18next";
import { LibraryCard } from "./LibraryCard";
import { useContentFormat } from "./useContentFormat";
import { WORKBENCH_TYPE_ICONS, WorkbenchBadges, WorkbenchItemMenu, WorkbenchThumbnail, workbenchTypeKey, type SceneItemActions } from "./WorkbenchItemParts";
import type { WorkbenchItem } from "./types";

export interface WorkbenchCardProps {
  item: WorkbenchItem;
  href: string;
  onOpen?: () => void;
  selected?: boolean;
  /** Scene actions the viewer may perform; omitted entries are hidden. */
  actions?: SceneItemActions;
  busy?: boolean;
}

/**
 * Grid tile: the content's own picture leads, the name and type follow. The
 * whole tile is one link; the overflow menu sits above the link layer.
 */
export function WorkbenchCard({ item, href, onOpen, selected, actions = {}, busy }: WorkbenchCardProps) {
  const { t } = useTranslation();
  const format = useContentFormat();
  const TypeIcon = WORKBENCH_TYPE_ICONS[item.type];
  return (
    <LibraryCard
      name={item.name}
      href={href}
      onOpen={onOpen}
      selected={selected}
      linkId={`library-${item.kind}-${item.id}`}
      thumbnail={<WorkbenchThumbnail item={item} />}
      metadata={<>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <TypeIcon className="size-3.5 shrink-0" aria-hidden />
          {t(workbenchTypeKey(item.type))}
        </span>
        <time dateTime={item.updatedAt} className="whitespace-nowrap tabular-nums">{format.date(item.updatedAt)}</time>
      </>}
      badges={(item.state === "archived" || item.fileMissing) && <WorkbenchBadges item={item} />}
      actions={<WorkbenchItemMenu item={item} actions={actions} busy={busy} />}
    />
  );
}
