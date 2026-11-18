"use client";
import type { ContentLibraryKind } from "../content/types";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ContentFeatureState } from "../components/ContentFeatureState";
import { TeamPageLoading } from "../components/TeamShell";
import { useTeamContext } from "../lib/content-context";
import { LibrarySourceTabs } from "./LibrarySourceTabs";
import { WorkbenchRoute } from "../workbench/WorkbenchRoute";

export function ContentLibraryPage({ kind }: { kind: ContentLibraryKind }) {
  return <Suspense><ManagePageContent kind={kind} /></Suspense>;
}
function ManagePageContent({ kind }: { kind: ContentLibraryKind }) {
  const team = useTeamContext();
  const { t } = useTranslation();
  const teamState = team.organizationId ? null : team.loading
    ? <TeamPageLoading label={t("contentModel.state.loading")} />
    : <ContentFeatureState state="no-organization" />;
  if (kind !== "anchor") return <LibrarySourceTabs key={`${team.organizationId}:${kind}`} kind={kind} team={team} teamState={teamState} />;
  return teamState ?? <WorkbenchRoute key={`${team.organizationId}:${kind}`} team={team} kind={kind} />;
}
