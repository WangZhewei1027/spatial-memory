"use client";
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Text } from "@/components/ui/typography";

/** One consistent disclosure for the inspector's parameter groups. */
export function SceneInspectorSection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className="scene-inspector-section" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight aria-hidden="true" /><Text as="h3" variant="bodySm" fontWeight="semibold">{title}</Text></summary>
    <div className="scene-inspector-section-body">{children}</div>
  </details>;
}
