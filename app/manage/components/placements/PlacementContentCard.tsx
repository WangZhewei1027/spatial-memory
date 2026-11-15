"use client";

import type { ComponentProps } from "react";
import { Check, Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentThumbnail } from "../../content/ContentThumbnail";
import type { ContentAssetType } from "../../content/types";

interface PlacementContentCardProps extends Omit<ComponentProps<"button">, "children"> {
  name: string;
  contentType: ContentAssetType | "scene";
  typeLabel: string;
  thumbnailUrl?: string | null;
  textExcerpt?: string | null;
  selected?: boolean;
  actionLabel?: string;
}

/** Shared content identity for picker results and the selected creation source. */
export function PlacementContentCard({ name, contentType, typeLabel, thumbnailUrl, textExcerpt, selected, actionLabel, className, ...props }: PlacementContentCardProps) {
  return (
    <button
      {...props}
      type="button"
      aria-pressed={selected}
      className={cn("flex min-w-0 w-full items-center gap-3 rounded-md border px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", selected ? "border-primary bg-primary/10" : "hover:bg-muted/50", className)}
    >
      {contentType === "scene"
        ? <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted"><Clapperboard className="size-6 text-muted-foreground" aria-hidden /></span>
        : <ContentThumbnail type={contentType} name={name} thumbnailUrl={thumbnailUrl} textExcerpt={textExcerpt} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={name}>{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{typeLabel}</span>
      </span>
      {actionLabel && <span className="shrink-0 text-xs text-muted-foreground">{actionLabel}</span>}
      {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}
