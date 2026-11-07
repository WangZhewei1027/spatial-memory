"use client";

import Link from "next/link";
import type { HTMLAttributeAnchorTarget, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/** Shared density for collections, scenes and assets; sparse results keep the same tile width. */
export const LIBRARY_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(11rem,calc((100%_-_0.75rem)/2)),1fr))] gap-3";

export interface LibraryCardProps {
  name: string;
  href: string;
  target?: HTMLAttributeAnchorTarget;
  onOpen?: () => void;
  selected?: boolean;
  linkId?: string;
  thumbnail: ReactNode;
  metadata: ReactNode;
  description?: string | null;
  badges?: ReactNode;
  actions?: ReactNode;
}

/** The content opens from the whole card; its menu stays a separate focusable control. */
export function LibraryCard({ name, href, target, onOpen, selected, linkId, thumbnail, metadata, description, badges, actions }: LibraryCardProps) {
  return (
    <li className={cn("group relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background transition-colors focus-within:ring-1 focus-within:ring-ring hover:border-foreground/25", selected && "border-primary ring-1 ring-primary")}>
      <div className="aspect-[4/3] overflow-hidden border-b bg-muted">{thumbnail}</div>
      <div className="min-w-0 flex-1 space-y-1 px-2.5 pb-2.5 pt-1.5">
        <div className="flex min-h-8 min-w-0 items-center gap-1">
          <Link id={linkId} href={href} target={target} aria-current={selected ? "true" : undefined}
            onNavigate={onOpen ? (event) => { event.preventDefault(); onOpen(); } : undefined}
            rel={target === "_blank" ? "noopener noreferrer" : undefined} title={name} className="min-w-0 flex-1 truncate rounded-sm text-sm font-medium text-foreground focus-visible:outline-none after:absolute after:inset-0 after:content-['']">{name}</Link>
          {actions && <div className="relative z-10 -me-1 shrink-0">{actions}</div>}
        </div>
        {description && <Text as="p" variant="bodySm" tone="subdued" truncate title={description}>{description}</Text>}
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">{metadata}</p>
        {badges}
      </div>
    </li>
  );
}

export function LibraryGridSkeleton({ label, count = 10 }: { label: string; count?: number }) {
  return (
    <ul role="status" aria-label={label} className={LIBRARY_GRID}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-lg border">
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="space-y-1 px-2.5 pb-2.5 pt-1.5">
            <div className="flex h-8 items-center"><Skeleton className="h-4 w-3/4" /></div>
            <Skeleton className="h-4 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}
