"use client";

import { Box, Clapperboard, FileText, Link2, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssetThumbnail } from "../components/AssetManager/AssetThumbnail";
import type { ContentAssetType } from "./types";

const ICON_TYPES: Partial<Record<ContentAssetType | "scene", LucideIcon>> = {
  scene: Clapperboard,
  model: Box,
  video: Video,
  link: Link2,
  document: FileText,
};

export interface ContentThumbnailProps {
  type: ContentAssetType | "scene";
  name: string;
  thumbnailUrl?: string | null;
  textExcerpt?: string | null;
  className?: string;
}

/**
 * Reuses the asset manager thumbnail for image, audio and text, and adds a
 * matching icon tile for types it does not draw. A supplied poster or model
 * snapshot always wins over the icon.
 */
export function ContentThumbnail({ type, name, thumbnailUrl, textExcerpt, className }: ContentThumbnailProps) {
  const Icon = ICON_TYPES[type];
  if (Icon && !thumbnailUrl) {
    return (
      <div className={cn("flex size-16 shrink-0 items-center justify-center rounded-md bg-muted", className)} aria-hidden>
        <Icon className="size-7 text-muted-foreground" />
      </div>
    );
  }
  return (
    <AssetThumbnail
      fileType={thumbnailUrl ? "image" : type}
      fileUrl={thumbnailUrl}
      textContent={textExcerpt}
      fileName={name}
      className={className}
    />
  );
}
