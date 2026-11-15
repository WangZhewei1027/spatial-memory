"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MapPinned } from "lucide-react";
import { ContentStatusBadge } from "./ContentStatusBadge";
import { EditorHeaderBar } from "./EditorHeaderBar";

export interface CollectionHeaderBarProps {
  /** Null while the collection is loading. */
  name: string | null;
  archived?: boolean;
  backHref: string;
  /** Right side: the collection's mini-program QR code and secondary actions. */
  actions?: ReactNode;
}

/** Navigation island above the map: collection identity, return link and QR. */
export function CollectionHeaderBar({ name, archived, backHref, actions }: CollectionHeaderBarProps) {
  const { t } = useTranslation();
  return (
    <EditorHeaderBar
      name={name ?? t("contentModel.state.loading")}
      backHref={backHref}
      backLabel={t("contentModel.collections.title")}
      icon={<MapPinned className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      status={archived && <ContentStatusBadge kind="archived" className="shrink-0" />}
      actions={actions}
    />
  );
}
