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
    <div className="console-layout">
      <ConsoleNavigation title={teamLabel} icon={Building2}>{navigation}</ConsoleNavigation>
      <main className="min-w-0 flex-1 px-2 py-4 sm:px-4 lg:px-7 lg:py-6">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
          {aside && <div className="flex flex-wrap items-center justify-end gap-2">{aside}</div>}
          {children}
        </div>
      </main>
    </div>
  );
}
