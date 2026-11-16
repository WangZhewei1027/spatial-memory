"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, MessageSquare } from "lucide-react";
import type { ActivityDto } from "@/lib/activities/contracts";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Text } from "@/components/ui/typography";
import { ContentErrorState } from "../../content/ContentFeedback";
import { EditorHeaderBar } from "../../content/EditorHeaderBar";
import { teamHref, useResourceTeam, useTeamContext } from "../../lib/content-context";
import { activityApi } from "../../lib/activity-api";
import { ManageGridLayout } from "../placements/ManageGridLayout";
import { ManageLayoutSkeleton } from "../placements/ManageLayoutSkeleton";
import { useActivityQuery } from "./useActivityQuery";
import { CrossOrganizationDuplicateButton } from "../CrossOrganizationDuplicate";
import { ActivityEditor } from "./ActivityEditor";
import { ActivityPlacements } from "./ActivityPlacements";
import { ActivityRecords } from "./ActivityRecords";

export function ActivityDetailRoute({ activityId }: { activityId: string }) {
  const { t } = useTranslation();
  const team = useTeamContext();
  const load = useCallback((signal: AbortSignal) => activityApi.get(activityId, signal), [activityId]);
  // Shared content events must not replace an unsaved activity draft.
  const query = useActivityQuery(activityId, load, false);
  const [saved, setSaved] = useState<ActivityDto | null>(null);
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<string | null>(null);
  const activity = saved && (!query.data || saved.lock_version >= query.data.lock_version) ? saved : query.data;
  const resourceTeam = useResourceTeam(activity?.organization_id, "/manage/activities");
  const reload = () => { setSaved(null); setReloadEpoch((value) => value + 1); query.reload(); };
  const onSaved = (value: ActivityDto) => { setSaved(value); query.reload(); };
  const Icon = activity?.type === "shop_checkin" ? MapPin : MessageSquare;
  const frame = (body: ReactNode, actions?: ReactNode) => (
    <main className="flex h-dvh flex-col overflow-hidden bg-muted/40">
      <EditorHeaderBar
        name={activity?.name ?? t("activities.loading")}
        backHref={teamHref("/manage/activities", activity?.organization_id ?? team.organizationId)}
        backLabel={t("activities.title")}
        icon={<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        status={activity?.state === "archived" && <Badge variant="outline" className="shrink-0 max-sm:hidden">{t("activities.states.archived")}</Badge>}
        actions={<>{activity && <CrossOrganizationDuplicateButton sourceType="activity" sourceId={activity.id} sourceOrganizationId={activity.organization_id} name={activity.name} archived={activity.state === "archived"} iconOnly />}{actions}</>}
      />
      <div className="relative min-h-0 flex-1">{body}</div>
    </main>
  );

  if (query.error) return frame(<div className="mx-auto max-w-xl p-6"><ContentErrorState onRetry={reload} /></div>);
  if (!activity || !resourceTeam.settled) return frame(<ManageLayoutSkeleton fill />);
  const editorKey = `${activity.id}:${activity.lock_version}:${reloadEpoch}`;

  const shop = activity.type === "shop_checkin";
  return (
    <ActivityEditor key={editorKey} activity={activity} onSaved={onSaved} onReload={reload} onInspectPoint={() => setSidebarTab("point")}
      renderWorkspace={({ settings, map, actions, pointDetails }) => frame(
        <ManageGridLayout fill
          list={<section aria-labelledby="activity-settings-title" className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
            <div className="shrink-0 border-b px-4 py-3"><Text as="h2" id="activity-settings-title" variant="bodySm" fontWeight="semibold">{t("activities.settings")}</Text></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{settings}</div>
          </section>}
          viewer={map}
          sidebar={<Tabs value={sidebarTab ?? (shop ? "point" : "placements")} onValueChange={setSidebarTab} className="flex h-full min-h-0 flex-col gap-0 overflow-hidden rounded-lg border bg-background">
            <div className="shrink-0 border-b p-3"><TabsList className={`grid w-full group-data-[orientation=horizontal]/tabs:h-auto ${shop ? "grid-cols-3" : "grid-cols-2"}`}>
              {shop && <TabsTrigger value="point" aria-label={t("activities.pointDetails")} className="h-auto min-h-8 px-1 whitespace-normal">{t("activities.editorTabs.point")}</TabsTrigger>}
              <TabsTrigger value="placements" aria-label={t("activities.placements")} className="h-auto min-h-8 px-1 whitespace-normal">{t(shop ? "activities.editorTabs.map" : "activities.placements")}</TabsTrigger>
              <TabsTrigger value="records" aria-label={t("activities.records")} className="h-auto min-h-8 px-1 whitespace-normal">{t(shop ? "activities.editorTabs.records" : "activities.records")}</TabsTrigger>
            </TabsList></div>
            {shop && <TabsContent value="point" forceMount className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">{pointDetails}</TabsContent>}
            <TabsContent value="placements" forceMount className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden"><ActivityPlacements activity={activity} compact /></TabsContent>
            <TabsContent value="records" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"><ActivityRecords activity={activity} /></TabsContent>
          </Tabs>}
        />, actions,
      )}
    />
  );

}
