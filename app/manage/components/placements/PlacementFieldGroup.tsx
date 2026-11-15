"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Text } from "@/components/ui/typography";

/** Quiet inspector disclosure; configured values remain visible when collapsed. */
export function PlacementFieldGroup({ title, summary, invalid = false, children }: { title: string; summary?: string; invalid?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open || invalid} onToggle={(event) => setOpen(event.currentTarget.open)} className="group border-t pt-2">
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 size-4 shrink-0 group-open:rotate-90" aria-hidden />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <Text as="span" variant="bodyXs" fontWeight="medium" className="shrink-0">{title}</Text>
          {summary && <Text as="span" variant="bodyXs" tone="subdued" alignment="end" truncate title={summary} className="min-w-0 flex-1">{summary}</Text>}
        </span>
      </summary>
      <div className="space-y-2 pt-2">{children}</div>
    </details>
  );
}
