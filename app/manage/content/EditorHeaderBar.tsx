"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigationIsland } from "@/components/ui/navigation-island";
import { Text } from "@/components/ui/typography";

interface EditorHeaderBarProps {
  name: string;
  backHref: string;
  backLabel: string;
  icon: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}

/** Full-window editors share the map's document identity and navigation island. */
export function EditorHeaderBar({ name, backHref, backLabel, icon, status, actions }: EditorHeaderBarProps) {
  return (
    <header className="shrink-0 px-[var(--navigation-gutter)] pt-[var(--navigation-gutter)]">
      <NavigationIsland className="navigation-row">
        <Button variant="ghost" size="sm" asChild className="shrink-0 px-2">
          <Link href={backHref}><ChevronLeft aria-hidden /><span className="max-sm:sr-only">{backLabel}</span></Link>
        </Button>
        <span className="h-4 border-l" aria-hidden />
        {icon}
        <Text as="h1" variant="bodySm" fontWeight="semibold" truncate className="min-w-0" title={name}>{name}</Text>
        {status}
        <div className="ms-auto flex shrink-0 items-center gap-1">{actions}</div>
      </NavigationIsland>
    </header>
  );
}
