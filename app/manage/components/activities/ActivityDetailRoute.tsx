"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityDto } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Text } from "@/components/ui/typography";
import { ContentErrorState } from "../../content/ContentFeedback";
import { TeamPageLoading } from "../TeamShell";
import { teamHref, useResourceTeam } from "../../lib/content-context";
import { activityApi } from "../../lib/activity-api";
import { useActivityQuery } from "./useActivityQuery";
import { ActivityEditor } from "./ActivityEditor";
import { ActivityPlacements } from "./ActivityPlacements";
import { ActivityRecords } from "./ActivityRecords";

export function ActivityDetailRoute({ activityId }: { activityId: string }) {
  const { t } = useTranslation();
  const load = useCallback((signal: AbortSignal) => activityApi.get(activityId, signal), [activityId]);
  // Shared content events must not replace an unsaved activity draft.
  const query = useActivityQuery(activityId, load, false);
  const [saved, setSaved] = useState<ActivityDto | null>(null);
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const activity = saved && (!query.data || saved.lock_version >= query.data.lock_version) ? saved : query.data;
  const resourceTeam = useResourceTeam(activity?.organization_id, "/manage/activities");
  const reload = () => { setSaved(null); setReloadEpoch((value) => value + 1); query.reload(); };
  return query.error ? <ContentErrorState onRetry={reload} /> : !activity || !resourceTeam.settled ? <TeamPageLoading label={t("activities.loading")} /> : <div className="space-y-6"><Button variant="ghost" asChild><Link href={teamHref("/manage/activities", activity.organization_id)}>{t("activities.back")}</Link></Button><div className="space-y-3"><Text as="h1" variant="headingXl" breakWord>{activity.name}</Text><div className="flex gap-2"><Badge variant="secondary">{t(`activities.types.${activity.type}`)}</Badge><Badge variant="outline">{t(`activities.states.${activity.state}`)}</Badge></div></div><Tabs defaultValue="settings"><TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="settings">{t("activities.settings")}</TabsTrigger><TabsTrigger value="placements">{t("activities.placements")}</TabsTrigger><TabsTrigger value="records">{t("activities.records")}</TabsTrigger></TabsList><TabsContent value="settings" forceMount className="mt-5 data-[state=inactive]:hidden"><ActivityEditor key={`${activity.id}:${activity.lock_version}:${reloadEpoch}`} activity={activity} onSaved={(value) => { setSaved(value); query.reload(); }} onReload={reload} /></TabsContent><TabsContent value="placements" className="mt-5"><ActivityPlacements activity={activity} /></TabsContent><TabsContent value="records" className="mt-5"><ActivityRecords activity={activity} /></TabsContent></Tabs></div>;
}
