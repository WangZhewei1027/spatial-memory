"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Box, ChevronDown, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigationMenu } from "@/components/ui/navigation-menu";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Text } from "@/components/ui/typography";

const PROJECT_DOCS = "https://github.com/WangZhewei1027/spatial-memory/blob/main/docs";

const groups = [
  {
    title: "home.nav.product",
    links: [
      { label: "home.nav.tools", href: "/#platform" },
      { label: "home.nav.workflow", href: "/#workflow" },
      { label: "home.hero.phone", href: "/#experience" },
    ],
  },
  {
    title: "home.nav.solutions",
    links: [
      { label: "home.nav.useCases", href: "/#solutions" },
      { label: "home.nav.dongming", href: "https://www.dhl.shanghai.nyu.edu/memorycospace" },
      { label: "home.nav.labProjects", href: "https://www.dhl.shanghai.nyu.edu/projects" },
    ],
  },
  {
    title: "home.nav.guides",
    links: [
      { label: "home.cta.instructions", href: "/instructions" },
      { label: "home.nav.sceneGuide", href: "/instructions#scenes" },
      { label: "home.nav.mapGuide", href: "/instructions#placements" },
      { label: "home.nav.wechatGuide", href: "/instructions#mini-program" },
      { label: "home.faq.title", href: "/#faq-title" },
    ],
  },
  {
    title: "home.nav.developers",
    links: [
      { label: "home.nav.miniappApi", href: `${PROJECT_DOCS}/miniapp-api.md` },
      { label: "home.nav.cli", href: "https://github.com/WangZhewei1027/spatial-memory-web-cli/blob/main/docs/usage.md" },
      { label: "home.nav.agent", href: `${PROJECT_DOCS}/scene-agent.md` },
    ],
  },
];

export function PublicNavigation() {
  const { t } = useTranslation();
  const navigationLabel = t("home.nav.menu");

  function renderLink({ href, label }: { href: string; label: string }) {
    const className = "flex min-h-11 items-center justify-between gap-4 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
    if (href.startsWith("https://")) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
          {t(label)}
          <span className="sr-only">{t("home.nav.newTab")}</span>
          <ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </a>
      );
    }
    return <Link href={href} className={className}>{t(label)}</Link>;
  }

  return (
    <>
      <Link href="/" aria-label={`Spatial Memory · ${t("nav.home")}`}
        className="inline-flex shrink-0 items-center gap-2 rounded-md px-1 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Box aria-hidden className="size-5" />Spatial Memory
      </Link>

      <NavigationMenu.Root aria-label={navigationLabel} className="hidden lg:block">
        <NavigationMenu.List className="flex items-center gap-1">
          {groups.map(group => (
            <NavigationMenu.Item key={group.title} className="relative">
              <NavigationMenu.Trigger asChild>
                <Button variant="ghost" className="group gap-1.5 data-[state=open]:bg-accent">
                  {t(group.title)}
                  <ChevronDown aria-hidden className="size-4 text-muted-foreground group-data-[state=open]:rotate-180" />
                </Button>
              </NavigationMenu.Trigger>
              <NavigationMenu.Content className="absolute left-1/2 top-full w-64 -translate-x-1/2 pt-2">
                <ul className="rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-md">
                  {group.links.map(item => (
                    <li key={item.href}><NavigationMenu.Link asChild>{renderLink(item)}</NavigationMenu.Link></li>
                  ))}
                </ul>
              </NavigationMenu.Content>
            </NavigationMenu.Item>
          ))}
        </NavigationMenu.List>
      </NavigationMenu.Root>

      <div className="ml-auto lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={navigationLabel}><Menu aria-hidden /></Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 max-w-full gap-0" closeLabel={t("common.close")} aria-describedby={undefined}>
            <SheetHeader className="border-b pe-10"><SheetTitle>{navigationLabel}</SheetTitle></SheetHeader>
            <nav aria-label={navigationLabel} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
              {groups.map(group => (
                <div key={group.title}>
                  <Text as="h2" variant="bodySm" fontWeight="semibold" className="px-3 pb-1">{t(group.title)}</Text>
                  <ul>
                    {group.links.map(item => (
                      <li key={item.href}><SheetClose asChild>{renderLink(item)}</SheetClose></li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
