"use client";

import { TEAM_ROUTES, isPathWithinRoutes } from "@/app/manage/constants";
import { useManageStore } from "@/app/manage/store";
import { buildBreadcrumbItems } from "@/components/breadcrumb-routes";
import { OrgSwitcher } from "@/components/org-switcher";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

export function BreadcrumbNav() {
  const { t, i18n } = useTranslation();
  const pathname = usePathname();

  const organizations = useManageStore((state) => state.organizations);
  const organizationLoading = useManageStore(
    (state) => state.organizationLoading,
  );

  const isOrgContextRoute = isPathWithinRoutes(pathname, TEAM_ROUTES);
  // Hide the whole switcher block (incl. its separator) when OrgSwitcher
  // itself would render nothing — otherwise two separators sit side by side.
  const showOrgSwitcher =
    isOrgContextRoute && (organizationLoading || organizations.length > 0);
  const breadcrumbItems = buildBreadcrumbItems(pathname, t, i18n.language);

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap gap-0.5 sm:gap-1">
          {breadcrumbItems.map((item, index) => {
            const isLast = index === breadcrumbItems.length - 1;
            // Home stays a link even when it is the only crumb (e.g. /auth/*)
            const isCurrentPage = isLast && index > 0;
            return (
              <Fragment key={item.href}>
                {index > 0 && (
                  <BreadcrumbSeparator
                    className={cn(
                      "text-muted-foreground/60",
                      // On mobile everything left of this separator is hidden,
                      // except the org-switcher chain leading to the current page
                      !(index > 1 && isLast && showOrgSwitcher) &&
                        "hidden sm:inline-flex",
                    )}
                  />
                )}

                {/* After Home, insert org switcher if applicable */}
                {index === 1 && showOrgSwitcher && (
                  <>
                    <BreadcrumbItem className="min-w-0 shrink-0">
                      <OrgSwitcher />
                    </BreadcrumbItem>
                    <BreadcrumbSeparator
                      className={cn(
                        "text-muted-foreground/60",
                        !isLast && "hidden sm:inline-flex",
                      )}
                    />
                  </>
                )}

                <BreadcrumbItem
                  className={cn(
                    "min-w-0",
                    // On mobile, hide Home and intermediate links to leave
                    // room for switchers
                    !isLast && "hidden sm:inline-flex",
                  )}
                >
                  {isCurrentPage ? (
                    <BreadcrumbPage className="truncate whitespace-nowrap font-medium" title={item.label}>
                      {item.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild className="whitespace-nowrap">
                      <Link href={item.href}>{item.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}

        </BreadcrumbList>
      </Breadcrumb>

    </div>
  );
}
