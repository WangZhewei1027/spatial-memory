"use client";

import { useManageStore } from "@/app/manage/store";
import { ConsoleNavigation } from "@/components/console-navigation";
import { isSidebarItemVisible } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Building2, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";

interface SidebarItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

function useSidebarItems(): SidebarItem[] {
  const { t } = useTranslation();
  const currentUserRole = useManageStore((state) => state.currentUserRole);
  const selectedOrganization = useManageStore(
    (state) => state.selectedOrganization,
  );
  const orgRole = selectedOrganization?.role ?? null;

  const allItems: SidebarItem[] = [
    {
      label: t("admin.sidebar.settings", "Settings"),
      href: "/admin/settings",
      icon: Settings,
    },
    {
      label: t("admin.sidebar.members", "Members"),
      href: "/admin/members",
      icon: Users,
    },
  ];

  return allItems.filter((item) =>
    isSidebarItemVisible(item.href, currentUserRole, orgRole),
  );
}

function SidebarNav({
  items,
  onItemClick,
}: {
  items: SidebarItem[];
  onItemClick?: () => void;
}) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);

  const renderItem = (item: SidebarItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onItemClick}
        aria-current={active ? "page" : undefined}
        className={cn(
          "console-nav-link",
          active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav className="flex flex-col gap-1">
      {items.map(renderItem)}
    </nav>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const items = useSidebarItems();

  return (
    <div className="console-layout h-[calc(100dvh-var(--app-navbar-height))]">
      <ConsoleNavigation title={t("admin.sidebar.orgSection", "Team")} icon={Building2}>
        {(onNavigate) => <SidebarNav items={items} onItemClick={onNavigate} />}
      </ConsoleNavigation>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[var(--navigation-radius)] bg-background">{children}</main>
    </div>
  );
}
