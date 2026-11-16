"use client";

import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, MapPinned, MoreHorizontal, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContentStatusBadge } from "./ContentStatusBadge";
import { LibraryCard } from "./LibraryCard";
import { CrossOrganizationDuplicateButton } from "../components/CrossOrganizationDuplicate";
import { useContentFormat } from "./useContentFormat";
import type { CollectionItem } from "./types";

export interface CollectionCardProps {
  collection: CollectionItem;
  href: string;
  onEdit?: (collection: CollectionItem) => void;
  onArchive?: (collection: CollectionItem) => void;
  onRestore?: (collection: CollectionItem) => void;
  busy?: boolean;
}

/** Map collections share the thumbnail layout and density of scenes and assets. */
export function CollectionCard({ collection, href, onEdit, onArchive, onRestore, busy }: CollectionCardProps) {
  const { t } = useTranslation();
  const format = useContentFormat();
  const lifecycle = collection.archived ? onRestore : onArchive;
  return (
    <LibraryCard
      name={collection.name}
      href={href}
      target="_blank"
      description={collection.description}
      thumbnail={<span className={`flex size-full items-center justify-center ${collection.archived ? "opacity-60" : ""}`}>
        <MapPinned className="size-8 text-muted-foreground" aria-hidden />
      </span>}
      metadata={<>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><MapPinned className="size-3.5 shrink-0" aria-hidden />{t("contentModel.collections.kind.map")}</span>
        {collection.createdAt && <time dateTime={collection.createdAt} title={t("contentModel.collections.created", { date: format.date(collection.createdAt) })} className="whitespace-nowrap tabular-nums">{format.date(collection.createdAt)}</time>}
      </>}
      badges={collection.archived && <ContentStatusBadge kind="archived" />}
      actions={<div className="flex items-center">
        {collection.organizationId && <CrossOrganizationDuplicateButton sourceType="collection" sourceId={collection.id} sourceOrganizationId={collection.organizationId} name={collection.name} archived={collection.archived} disabled={busy} iconOnly />}
        {(onEdit || lifecycle) && <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" disabled={busy} aria-label={t("contentModel.collections.moreNamed", { name: collection.name })}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEdit && <DropdownMenuItem onSelect={() => onEdit(collection)}><PencilLine aria-hidden />{t("contentModel.collections.edit")}</DropdownMenuItem>}
          {lifecycle && <DropdownMenuItem onSelect={() => lifecycle(collection)}>
            {collection.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {collection.archived ? t("contentModel.collections.restore") : t("contentModel.collections.archive")}
          </DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>}
      </div>}
    />
  );
}
