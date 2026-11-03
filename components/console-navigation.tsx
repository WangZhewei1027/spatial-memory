"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigationIsland } from "@/components/ui/navigation-island";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Text } from "@/components/ui/typography";

interface ConsoleNavigationProps {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: (onNavigate?: () => void) => ReactNode;
}

/** The same navigation in a desktop island and an accessible mobile drawer. */
export function ConsoleNavigation({ title, icon: Icon, children }: ConsoleNavigationProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="console-sidebar hidden md:block">
        <NavigationIsland className="space-y-4 p-3">
          <div className="flex min-h-11 min-w-0 items-center gap-3 px-3">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Text as="p" variant="bodySm" fontWeight="semibold" truncate title={title}>{title}</Text>
          </div>
          {children()}
        </NavigationIsland>
      </aside>
      <div className="shrink-0 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <NavigationIsland>
            <SheetTrigger asChild>
              <Button variant="ghost" className="navigation-row w-full justify-start rounded-[var(--navigation-radius)]" title={title}>
                <Menu className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{title}</span>
              </Button>
            </SheetTrigger>
          </NavigationIsland>
          <SheetContent side="left" className="w-72" aria-describedby={undefined}>
            <SheetHeader className="pe-10"><SheetTitle className="truncate" title={title}>{title}</SheetTitle></SheetHeader>
            <div className="min-h-0 overflow-y-auto px-3 pb-4">{children(() => setOpen(false))}</div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
