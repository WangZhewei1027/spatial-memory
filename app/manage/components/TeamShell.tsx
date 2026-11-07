"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isSidebarItemVisible } from "@/lib/permissions";
import { isFullWindowEditorPath } from "../constants";
import { useManageStore } from "../store";
import { ContentListSkeleton } from "../content/ContentFeedback";
import { TeamFrame } from "./TeamFrame";

/** Whether the current user sees anything under 团队设置 (members or settings). */
export function useCanSeeTeamSettings() {
  const globalRole = useManageStore((state) => state.currentUserRole);
  const orgRole = useManageStore((state) => state.selectedOrganization?.role ?? null);
  return isSidebarItemVisible("/admin/members", globalRole, orgRole) || isSidebarItemVisible("/admin/settings", globalRole, orgRole);
}

/** Owned by /manage/layout, outside all page loading and data boundaries. */
export function TeamShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const organizationId = useManageStore((state) => state.selectedOrganizationId);
  const showSettings = useCanSeeTeamSettings();
  const teamName = useManageStore((state) => state.organizations.find((team) => team.id === organizationId)?.name);
  // Map and scene editors keep their existing full-window workspace.
  if (isFullWindowEditorPath(pathname)) return children;
  const library = /^\/manage(?:\/(assets|scenes|collections|activities))?\/?$/.test(pathname);
  return (
    <TeamFrame organizationId={organizationId} teamName={teamName} showSettings={showSettings} library={library}>
      {children}
    </TeamFrame>
  );
}

/** Row skeleton for a team page whose state is still loading. */
export function TeamPageLoading({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <ContentListSkeleton label={label} />
    </div>
  );
}
