"use client";

import { useTranslation } from "react-i18next";
import {
  Anchor,
  Archive,
  ArchiveRestore,
  Box,
  Clapperboard,
  Copy,
  FileText,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Music,
  Type,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ContentStatusBadge } from "./ContentStatusBadge";
import type { WorkbenchItem, WorkbenchType } from "./types";

export const WORKBENCH_TYPE_ICONS: Record<WorkbenchType, LucideIcon> = {
  scene: Clapperboard,
  model: Box,
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: Type,
  link: Link2,
  document: FileText,
  anchor: Anchor,
};

/** Locale key of a workbench type, singular ("场景", "3D模型"). */
export function workbenchTypeKey(type: WorkbenchType) {
  return `fileTypes.${type}`;
}

/**
 * Fills its box: a real image when the content has one, the text itself for
 * text assets, otherwise the type's icon on the muted surface.
 */
export function WorkbenchThumbnail({ item, iconClassName }: { item: WorkbenchItem; iconClassName?: string }) {
  const Icon = WORKBENCH_TYPE_ICONS[item.type];
  const dim = item.state === "archived" && "opacity-60";
  if (item.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- media host URLs, sized by the container
      <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" className={cn("size-full object-cover", dim)} />
    );
  }
  if (item.type === "text" && item.textExcerpt) {
    return (
      <span className={cn("flex size-full items-center justify-center p-3 text-start text-xs leading-5 text-muted-foreground", dim)}>
        <span className="line-clamp-4 break-words">{item.textExcerpt}</span>
      </span>
    );
  }
  return (
    <span className={cn("flex size-full items-center justify-center", dim)}>
      <Icon className={cn("size-8 text-muted-foreground", iconClassName)} aria-hidden />
    </span>
  );
}

/** Publication and lifecycle badges; assets show only exceptional states. */
export function WorkbenchBadges({ item }: { item: WorkbenchItem }) {
  const archived = item.state === "archived";
  return (
    <span className="flex flex-wrap items-center gap-1">
      {archived && <ContentStatusBadge kind="archived" />}
      {item.fileMissing && <ContentStatusBadge kind="fileMissing" />}
    </span>
  );
}

export interface SceneItemActions {
  onCopy?: (item: WorkbenchItem) => void;
  onArchive?: (item: WorkbenchItem) => void;
  onRestore?: (item: WorkbenchItem) => void;
}

/** Overflow menu for one scene; absent when the viewer cannot write. */
export function WorkbenchItemMenu({ item, actions, busy, className }: { item: WorkbenchItem; actions: SceneItemActions; busy?: boolean; className?: string }) {
  const { t } = useTranslation();
  const archived = item.state === "archived";
  const copy = !archived ? actions.onCopy : undefined;
  const lifecycle = archived ? actions.onRestore : actions.onArchive;
  if (item.kind !== "scene" || (!copy && !lifecycle)) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("size-8", className)} disabled={busy} aria-label={t("contentModel.scene.moreNamed", { name: item.name })}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {copy && (
          <DropdownMenuItem onSelect={() => copy(item)}>
            <Copy aria-hidden />
            {t("contentModel.scene.copy")}
          </DropdownMenuItem>
        )}
        {lifecycle && (
          <DropdownMenuItem onSelect={() => lifecycle(item)}>
            {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {archived ? t("contentModel.scene.restore") : t("contentModel.scene.archive")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
