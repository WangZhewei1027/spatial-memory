"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NavbarSidebar } from "@/components/navbar-sidebar";
import { BreadcrumbNav } from "@/components/breadcrumb-nav";
import { UserAvatarMenu } from "@/components/user-avatar-menu";
import { NavigationIsland } from "@/components/ui/navigation-island";
import { isFullWindowEditorPath } from "@/app/manage/constants";

export function Navbar() {
  const pathname = usePathname();
  // Map and scene editors have their own full-window toolbars.
  if (isFullWindowEditorPath(pathname)) return null;

  return (
    <header className="app-navbar">
      <NavigationIsland className="navigation-row justify-between text-sm">
        <Suspense>
          <BreadcrumbNav />
        </Suspense>
        <div className="flex items-center gap-2 flex-shrink-0">
          <LanguageSwitcher />
          {/* Desktop: avatar dropdown */}
          <div className="hidden md:flex items-center gap-2">
            <Suspense>
              <UserAvatarMenu />
            </Suspense>
          </div>
          {/* Mobile: avatar drawer */}
          <div className="md:hidden">
            <NavbarSidebar />
          </div>
        </div>
      </NavigationIsland>
    </header>
  );
}
