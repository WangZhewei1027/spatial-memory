"use client";

import type { ReactNode } from "react";
import { Text, type TextTone } from "@/components/ui/typography";

/** Keep status and actions on one stable row; full status remains accessible. */
export function PlacementActionBar({ status, tone = "subdued", children }: { status: string; tone?: TextTone; children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-2 border-t bg-background px-2 py-1.5" data-inspector-actions>
    <Text as="p" variant="bodyXs" tone={tone} truncate title={status} role="status" className="min-w-0 flex-1">{status}</Text>
    <div className="flex shrink-0 items-center gap-1">{children}</div>
  </div>;
}
