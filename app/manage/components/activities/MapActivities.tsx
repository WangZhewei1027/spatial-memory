"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowUpRight, Plus } from "lucide-react";
import type { ActivityDto, ActivityPlacementDto } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { ContentEmptyState, ContentErrorState, ContentListSkeleton } from "../../content/ContentFeedback";
import { activityApi } from "../../lib/activity-api";
import { teamHref } from "../../lib/content-context";
import { usePlacementStore } from "../../lib/placement-store";
import { useActivityQuery } from "./useActivityQuery";
import { ActivityPlacementForm } from "./ActivityPlacementForm";

export interface MapActivitiesProps {
  workspaceId: string;
  workspaceName: string;
  organizationId: string;
  canEdit: boolean;
}

export function MapActivities({ workspaceId, workspaceName, organizationId, canEdit }: MapActivitiesProps) {
  const { t } = useTranslation();
  const load = useCallback((signal: AbortSignal) => activityApi.collectionPlacements(workspaceId, signal), [workspaceId]);
  const placements = useActivityQuery(workspaceId, load);
  const loadActivities = useCallback((signal: AbortSignal) => activityApi.list(organizationId, signal), [organizationId]);
  const activities = useActivityQuery(organizationId, loadActivities);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const editingId = usePlacementStore((state) => state.selectedActivityPlacementId);
  const [editingSnapshot, setEditingSnapshot] = useState<ActivityPlacementDto | null>(null);
  useEffect(() => {
    if (!editingId) setEditingSnapshot(null);
    else if (editingSnapshot?.id !== editingId) {
      const row = placements.data?.find((placement) => placement.id === editingId);
      if (row) setEditingSnapshot(row);
    }
  }, [editingId, placements.data, editingSnapshot?.id]);
  const editing = editingSnapshot?.id === editingId ? editingSnapshot : null;
  const setEditing = (placement: ActivityPlacementDto | null) => usePlacementStore.getState().selectActivityPlacement(placement?.id ?? null);
  const linkedActivityIds = new Set(placements.data?.map((placement) => placement.activity_id));
  const editableActivities = (activities.data ?? []).filter((activity) => activity.state === "active" && activity.capabilities.can_edit);
  const availableActivities = editableActivities.filter((activity) => !linkedActivityIds.has(activity.id));
  const choicesReady = !activities.loading && !activities.error && !placements.loading && !placements.error;
  const allActivitiesLinked = choicesReady && editableActivities.length > 0 && !availableActivities.length;
  const selected = editing ? activities.data?.find((activity) => activity.id === editing.activity_id) : availableActivities.find((activity) => activity.id === selectedId);
  const close = () => { setCreating(false); setEditing(null); setSelectedId(""); placements.reload(); };
  const collections = [{ id: workspaceId, name: workspaceName, capabilities: { can_edit: canEdit } }];

  if (creating || editingId) return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
        <Button variant="ghost" className="min-h-10 shrink-0" aria-label={t("activities.back")} onClick={close}>
          <ArrowLeft aria-hidden />{t("common.back")}
        </Button>
        {selected && <Button variant="ghost" asChild className="h-auto min-h-10 whitespace-normal text-start">
          <Link href={teamHref(`/manage/activities/${selected.id}`, organizationId)}>{t(selected.capabilities.can_edit ? "activities.editContent" : "activities.viewContent")}<ArrowUpRight aria-hidden /></Link>
        </Button>}
      </div>
      {!editingId && choicesReady && availableActivities.length > 0 && <div className="shrink-0 px-5 pt-5 sm:px-6">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full" aria-label={t("activities.chooseActivity")}><SelectValue placeholder={t("activities.chooseActivity")} /></SelectTrigger>
          <SelectContent>{availableActivities.map((activity) => <SelectItem key={activity.id} value={activity.id}>{activity.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      {activities.loading || placements.loading ? <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6"><ContentListSkeleton label={t("activities.loading")} rows={2} /></div>
        : activities.error || placements.error ? <div className="min-h-0 overflow-y-auto"><ContentErrorState onRetry={() => { activities.reload(); placements.reload(); }} /></div>
        : selected ? <ActivityPlacementForm key={editing?.id ?? selected.id} activity={selected} placement={editing ?? undefined} collections={collections} workspaceId={workspaceId} onSaved={close} onCancel={close} />
        : <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          <Text as="p" variant="bodySm" tone="subdued">{t(allActivitiesLinked ? "activities.allActivitiesLinked" : !availableActivities.length ? "activities.noAvailableActivities" : "activities.chooseActivityHint")}</Text>
          <Button variant="outline" onClick={close}>{t("activities.cancel")}</Button>
        </div>}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <Text as="p" variant="bodySm" tone="subdued" className="mb-5">{t("activities.mapHint")}</Text>
        {canEdit && choicesReady && !availableActivities.length && <Text as="p" variant="bodySm" tone="subdued" className="mb-4">{t(allActivitiesLinked ? "activities.allActivitiesLinked" : "activities.noAvailableActivities")}</Text>}
        {activities.error && <ContentErrorState onRetry={activities.reload} />}
        {placements.loading ? <ContentListSkeleton label={t("activities.loading")} rows={3} />
          : placements.error ? <ContentErrorState onRetry={placements.reload} />
          : !placements.data?.length ? <ContentEmptyState title={t("activities.noPlacements")} />
          : <ul className="divide-y">{placements.data.map((placement) => <MapActivityRow key={placement.id} placement={placement} activity={activities.data?.find((activity) => activity.id === placement.activity_id)} onEdit={() => setEditing(placement)} />)}</ul>}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Button variant="ghost" asChild className="h-auto min-h-10 whitespace-normal"><Link href={teamHref("/manage/activities", organizationId)}>{t("activities.manage")}<ArrowUpRight aria-hidden /></Link></Button>
        {canEdit && choicesReady && availableActivities.length > 0 && <Button className="h-auto min-h-10 whitespace-normal" onClick={() => setCreating(true)}><Plus aria-hidden />{t("activities.placeExisting")}</Button>}
      </div>
    </div>
  );
}
function MapActivityRow({ placement, activity, onEdit }: { placement: ActivityPlacementDto; activity?: ActivityDto; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <li className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="min-w-0 space-y-2">
        <Text as="h3" variant="bodyMd" fontWeight="semibold" breakWord>{placement.activity_name}</Text>
        <div className="flex flex-wrap items-center gap-2">
          <Text as="span" variant="bodySm" tone="subdued">{t(`activities.types.${placement.activity_type}`)}</Text>
          <Badge variant="outline">{t(`activities.placementStates.${placement.status}`)}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-1 sm:gap-1">
        <Button variant="outline" className="h-auto min-h-10 whitespace-normal px-3" disabled={!activity} onClick={onEdit}>{t(placement.capabilities.can_edit ? "activities.editPlacement" : "activities.viewPlacement")}</Button>
        <Button variant="ghost" asChild className="h-auto min-h-10 whitespace-normal px-3"><Link href={teamHref(`/manage/activities/${placement.activity_id}`, placement.organization_id)}>{t(activity?.capabilities.can_edit ? "activities.editContent" : "activities.viewContent")}</Link></Button>
      </div>
    </li>
  );
}
