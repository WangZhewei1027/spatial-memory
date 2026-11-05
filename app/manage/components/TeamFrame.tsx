"use client";

import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { ConsoleNavigation } from "@/components/console-navigation";
import { ContentNav } from "./ContentNav";

export interface TeamFrameProps {
  organizationId: string | null;
  teamName?: string;
  showSettings: boolean;
  aside?: ReactNode;
  children: ReactNode;
}

/** Shared library frame, independent of auth and data loading. */
export function TeamFrame({ organizationId, teamName, showSettings, aside, children }: TeamFrameProps) {
  const { t } = useTranslation();
  const navigation = (onNavigate?: () => void) => <ContentNav organizationId={organizationId} showSettings={showSettings} onNavigate={onNavigate} />;
  const teamLabel = teamName || t("contentModel.library.team");

  return (
    <div className="console-layout team-workspace">
      <ConsoleNavigation title={teamLabel} icon={Building2}>{navigation}</ConsoleNavigation>
      <main className="team-workarea flex min-w-0 flex-1 flex-col gap-4 p-3 sm:p-4 lg:p-5">
        {aside && <div className="flex flex-wrap items-center justify-end gap-2">{aside}</div>}
        {children}
      </main>
    </div>
  );
}
