"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Clapperboard, MapPinned, Settings2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { teamHref } from "../lib/content-context";
import { useIntegrationText, type IntegrationTexts } from "../lib/integration-text";

export const NAV_TEXTS: IntegrationTexts = {
  "contentModel.integration.nav.label": ["团队导航", "Team navigation"],
  "contentModel.integration.nav.assets": ["基础素材", "Assets"],
  "contentModel.integration.nav.scenes": ["场景", "Scenes"],
  "contentModel.integration.nav.collections": ["地图合集", "Map collections"],
  "contentModel.integration.nav.settings": ["团队设置", "Team settings"],
};

const ITEMS = [
  { href: "/manage/collections", key: "collections", icon: MapPinned, active: (path: string) => path === "/manage/collections" || path.startsWith("/manage/collections/") },
  { href: "/manage/activities", key: "activities", icon: Sparkles, active: (path: string) => path === "/manage/activities" || path.startsWith("/manage/activities/") },
  { href: "/manage/scenes", key: "scenes", icon: Clapperboard, active: (path: string) => path === "/manage/scenes" || path.startsWith("/manage/scenes/") },
  { href: "/manage/assets", key: "assets", icon: Boxes, active: (path: string) => path === "/manage" || path === "/manage/assets" || path.startsWith("/manage/assets/") },
  { href: "/admin", key: "settings", icon: Settings2, active: (path: string) => path === "/admin" || path.startsWith("/admin/") },
] as const;

/**
 * Sidebar of the team console: map collections, scenes and basic assets. Links
 * carry only the team, never a workspace, so a shared URL opens the same team.
 */
export function ContentNav({ organizationId, showSettings = true, className, onNavigate }: { organizationId?: string | null; showSettings?: boolean; className?: string; onNavigate?: () => void }) {
  const tx = useIntegrationText(NAV_TEXTS);
  const pathname = usePathname() ?? "";
  const items = ITEMS.filter((item) => showSettings || item.key !== "settings");
  return (
    <nav aria-label={tx("contentModel.integration.nav.label")} className={cn("flex flex-1 flex-col gap-1", className)}>
      {items.map(({ href, key, icon: Icon, active }) => {
        const current = active(pathname);
        return (
          <Link
            key={href}
            href={key === "settings" ? href : teamHref(href, organizationId)}
            onClick={onNavigate}
            aria-current={current ? "page" : undefined}
            className={cn(
              "console-nav-link",
              key === "settings" && "mt-6 md:mt-auto",
              current ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {tx(`contentModel.integration.nav.${key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
