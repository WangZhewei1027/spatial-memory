"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { ActivityDto } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContentEmptyState, ContentErrorState } from "../../content/ContentFeedback";
import { TeamPageLoading } from "../TeamShell";
import { ContentFeatureState } from "../ContentFeatureState";
import { teamCanWrite, teamHref, useTeamContext } from "../../lib/content-context";
import { LibraryLayout } from "../../content/LibraryLayout";
import { LIBRARY_GRID, LibraryGridSkeleton } from "../../content/LibraryCard";
import { getTeamLibraryPage } from "../../lib/content-api";
import { subscribeContentChanges } from "../../lib/content-events";
import { useLibraryPages, useLibrarySearch } from "../../workbench/useLibraryPages";
import type { CollectionState } from "@/lib/content-model/contracts";
import { ActivityCreateDialog } from "./ActivityCreateDialog";
import { ActivityCard } from "./ActivityCard";

export function ActivitiesRoute() {
  const team = useTeamContext();
  return team.organizationId ? <ActivityLibrary key={team.organizationId} organizationId={team.organizationId} canCreate={teamCanWrite({ archivedAt: team.organization?.archived_at, orgRole: team.organization?.role, globalRole: team.currentUserRole })} /> : team.loading ? <TeamPageLoading label="…" /> : <ContentFeatureState state="no-organization" />;
}

function ActivityLibrary({ organizationId, canCreate }: { organizationId: string; canCreate: boolean }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<CollectionState>("active");
  const q = useLibrarySearch(search);
  const load = useCallback((offset: number, limit: number, signal: AbortSignal) =>
    getTeamLibraryPage(organizationId, "activities", { q, state, offset, limit }, signal), [organizationId, q, state]);
  const list = useLibraryPages(load);
  useEffect(() => subscribeContentChanges(list.reload), [list.reload]);
  const onCreated = (activity: ActivityDto) => {
    list.reload();
    toast.success(t("activities.created", { name: activity.name }), {
      action: { label: t("activities.editContent"), onClick: () => window.open(teamHref(`/manage/activities/${activity.id}`, organizationId), "_blank", "noopener,noreferrer") },
    });
  };
  return (
    <LibraryLayout
      title={t("activities.title")}
      actions={canCreate && <ActivityCreateDialog organizationId={organizationId} onCreated={onCreated}><Button><Plus aria-hidden />{t("activities.create")}</Button></ActivityCreateDialog>}
      readOnlyReason={canCreate ? undefined : t("activities.readOnly")}
      pagination={list}
      toolbar={
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-0 flex-1 sm:max-w-sm" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("activities.search")} aria-label={t("activities.search")} />
          <Select value={state} onValueChange={value => setState(value as CollectionState)}>
            <SelectTrigger aria-label={t("activities.state")}><SelectValue /></SelectTrigger>
            <SelectContent>{["active", "archived", "all"].map(item => <SelectItem key={item} value={item}>{t(`activities.states.${item}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      }
    >
      {list.status === "loading" ? (
        <LibraryGridSkeleton label={t("activities.loading")} />
      ) : list.status === "error" ? (
        <div className="my-auto"><ContentErrorState onRetry={list.reload} /></div>
      ) : !list.items.length ? (
        <div className="my-auto"><ContentEmptyState headingAs="h2" title={t("activities.empty")} description={t("activities.emptyHint")} /></div>
      ) : (
        <ul aria-label={t("activities.title")} className={LIBRARY_GRID}>
          {list.items.map(activity => <ActivityCard key={activity.id} activity={activity}
            href={teamHref(`/manage/activities/${activity.id}`, organizationId)} />)}
        </ul>
      )}
    </LibraryLayout>
  );
}
