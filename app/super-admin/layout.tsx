"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  Users,
  Building2,
  Shield,
  Loader2,
  ArrowLeft,
  AlertTriangle,
  Settings,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConsoleNavigation } from "@/components/console-navigation";
import { isSuperAdmin } from "@/lib/permissions";

interface SidebarItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

function SidebarNav({
  items,
  onItemClick,
}: {
  items: SidebarItem[];
  onItemClick?: () => void;
}) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/super-admin/users") {
      return pathname === "/super-admin" || pathname === "/super-admin/users";
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
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
      })}
    </nav>
  );
}

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/role")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isSuperAdmin(data?.role)) {
          router.replace("/403");
          return;
        }
        setAuthorized(true);
      })
      .catch(() => router.replace("/403"))
      .finally(() => setLoading(false));
  }, [router]);

  const items: SidebarItem[] = [
    {
      label: t("superAdmin.sidebar.users", "User Management"),
      href: "/super-admin/users",
      icon: Users,
    },
    {
      label: t("superAdmin.sidebar.organizations", "Organizations"),
      href: "/super-admin/organizations",
      icon: Building2,
    },
    {
      label: t("superAdmin.sidebar.errorLogs", "Error Logs"),
      href: "/super-admin/error-logs",
      icon: AlertTriangle,
    },
    {
      label: t("superAdmin.sidebar.cleanup", "Cleanup"),
      href: "/super-admin/clean",
      icon: Trash2,
    },
    {
      label: t("superAdmin.sidebar.settings", "System Settings"),
      href: "/super-admin/settings",
      icon: Settings,
    },
  ];

  if (loading || !authorized) {
    return (
      <div className="min-h-[calc(100dvh-var(--app-navbar-height))] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="console-layout h-[calc(100dvh-var(--app-navbar-height))]">
      <ConsoleNavigation title={t("superAdmin.title", "Super Admin")} icon={Shield}>
        {(onNavigate) => (
          <div className="space-y-6">
            <SidebarNav items={items} onItemClick={onNavigate} />
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <Link href="/" onClick={onNavigate}>
                <ArrowLeft className="size-4" aria-hidden />
                {t("common.back", "Back")}
              </Link>
            </Button>
          </div>
        )}
      </ConsoleNavigation>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-[var(--navigation-radius)] bg-background">{children}</main>
    </div>
  );
}
