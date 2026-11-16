"use client";

import { useState } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { CircleHelp } from "lucide-react";
import { Button } from "./button";
import { Text } from "./typography";

/** Supplemental help available on hover, keyboard focus, or a touch/click toggle. */
export function InfoTooltip({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger asChild>
          <Button
            ref={setTrigger}
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label={label}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}
          >
            <CircleHelp aria-hidden />
          </Button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={trigger?.closest<HTMLElement>('[role="dialog"]') ?? undefined}>
          <TooltipPrimitive.Content
            sideOffset={6}
            collisionPadding={16}
            className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-sm"
            onEscapeKeyDown={(event) => { event.preventDefault(); setOpen(false); }}
            onPointerDownOutside={(event) => {
              if (event.target instanceof Node && trigger?.contains(event.target)) event.preventDefault();
            }}
          >
            <Text as="p" variant="bodySm">{children}</Text>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
