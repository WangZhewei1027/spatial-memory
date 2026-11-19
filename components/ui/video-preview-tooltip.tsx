"use client";

import { useState, type ReactElement } from "react";
import { Tooltip } from "radix-ui";

/** Keeps the trigger's click action while showing a larger, silent video on hover or focus. */
export function VideoPreviewTooltip({ src, name, children }: { src?: string; name: string; children: ReactElement }) {
  const [side, setSide] = useState<"right" | "bottom" | null>(null);
  if (!src) return children;

  function onOpenChange(open: boolean) {
    if (!open) setSide(null);
    else setSide(window.matchMedia("(min-width: 640px)").matches ? "right" : "bottom");
  }

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root open={side !== null} onOpenChange={onOpenChange}>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side={side ?? "right"} sideOffset={8} collisionPadding={12} hideWhenDetached aria-label={name}
            className="z-50 w-96 max-w-[var(--radix-tooltip-content-available-width)] overflow-hidden rounded-lg bg-popover shadow-lg">
            <video key={src} src={src} autoPlay loop muted playsInline aria-hidden
              className="block max-h-[min(60dvh,var(--radix-tooltip-content-available-height))] w-full object-contain" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
