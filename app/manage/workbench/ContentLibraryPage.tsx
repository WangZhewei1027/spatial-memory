"use client";
import type { ContentLibraryKind } from "../content/types";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ContentFeatureState } from "../components/ContentFeatureState";
import { TeamPageLoading } from "../components/TeamShell";
import { useTeamContext } from "../lib/content-context";
import { WorkbenchRoute } from "../workbench/WorkbenchRoute";

export function ContentLibraryPage({ kind }: { kind: ContentLibraryKind }) {
  return <Suspense><ManagePageContent kind={kind} /></Suspense>;
}
function ManagePageContent({ kind }: { kind: ContentLibraryKind }) {
  const team = useTeamContext();
  const { t } = useTranslation();
  if (!team.organizationId) return team.loading
    ? <TeamPageLoading label={t("contentModel.state.loading")} />
    : <ContentFeatureState state="no-organization" />;
  return <WorkbenchRoute key={`${team.organizationId}:${kind}`} team={team} kind={kind} />;
}
