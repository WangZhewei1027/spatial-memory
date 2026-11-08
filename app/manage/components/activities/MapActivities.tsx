"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { ActivityDto, ActivityPlacementDto } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { ContentEmptyState, ContentErrorState, ContentListSkeleton } from "../../content/ContentFeedback";
import { activityApi, type ActivityPlacementUpdate } from "../../lib/activity-api";
import { isLockConflict } from "../../lib/content-api";
import { teamHref } from "../../lib/content-context";
import { usePlacementStore } from "../../lib/placement-store";
import { useActivityQuery } from "./useActivityQuery";
import { ActivityPlacementForm } from "./ActivityPlacementForm";
import { ActivityFailure } from "./ActivityFeedback";

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
  const highlightedId = usePlacementStore((state) => state.selectedActivityPlacementId);
  // Retired map links keep their identity and participation history for relinking.
  const linkedPlacements = (placements.data ?? []).filter((placement) => placement.status !== "archived");
  const linkedActivityIds = new Set(linkedPlacements.map((placement) => placement.activity_id));
  const availableActivities = (activities.data ?? []).filter((activity) => activity.state === "active" && activity.capabilities.can_edit && !linkedActivityIds.has(activity.id));
  const choicesReady = !activities.loading && !activities.error && !placements.loading && !placements.error;
  const selected = availableActivities.find((activity) => activity.id === selectedId);
  const previousLink = placements.data?.find((placement) => placement.activity_id === selectedId && placement.status === "archived");
  const close = () => { setCreating(false); setSelectedId(""); placements.reload(); };
  const collections = [{ id: workspaceId, name: workspaceName, capabilities: { can_edit: canEdit } }];

  if (creating) return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 px-5 pt-5 sm:px-6">
        <Label htmlFor="map-activity-choice">{t("activities.chooseActivity")}</Label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger id="map-activity-choice" className="w-full"><SelectValue placeholder={t("activities.chooseActivity")} /></SelectTrigger>
          <SelectContent>{availableActivities.map((activity) => <SelectItem key={activity.id} value={activity.id}>{activity.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {activities.error || placements.error ? <ContentErrorState onRetry={() => { activities.reload(); placements.reload(); }} />
        : selected ? <ActivityPlacementForm key={selected.id} activity={selected} placement={previousLink} collections={collections} workspaceId={workspaceId} showHeading={false} onSaved={close} onCancel={close} />
        : <div className="flex justify-end px-5 py-4 sm:px-6"><Button variant="outline" onClick={close}>{t("activities.cancel")}</Button></div>}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 sm:px-6">
        {activities.error && <ContentErrorState onRetry={activities.reload} />}
        {placements.loading ? <ContentListSkeleton label={t("activities.loading")} rows={3} />
          : placements.error ? <ContentErrorState onRetry={placements.reload} />
          : !linkedPlacements.length ? <ContentEmptyState title={t("activities.noPlacements")} />
          : <ul className="divide-y">{linkedPlacements.map((placement) => (
            <MapActivityRow key={placement.id} placement={placement} activity={activities.data?.find((activity) => activity.id === placement.activity_id)} canEdit={canEdit} highlighted={highlightedId === placement.id} onReload={placements.reload} />
          ))}</ul>}
      </div>
      {canEdit && <div className="flex shrink-0 justify-end border-t px-5 py-3 sm:px-6">
        <Button className="min-h-10" disabled={!choicesReady || !availableActivities.length} onClick={() => setCreating(true)}><Plus aria-hidden />{t("activities.placeExisting")}</Button>
      </div>}
    </div>
  );
}

function MapActivityRow({ placement, activity, canEdit, highlighted, onReload }: { placement: ActivityPlacementDto; activity?: ActivityDto; canEdit: boolean; highlighted: boolean; onReload: () => void }) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLLIElement>(null);
  const statusRef = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState<ActivityPlacementDto | null>(null);
  const [change, setChange] = useState<ActivityPlacementUpdate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const current = saved && saved.lock_version > placement.lock_version ? saved : placement;
  const disabled = pending || !canEdit || !current.capabilities.can_edit || activity?.state !== "active" || isLockConflict(error);
  const unlinking = change?.status === "archived";
  const status = (unlinking ? current.status : change?.status ?? current.status) === "active" ? "active" : "paused";

  useEffect(() => {
    if (!highlighted) return;
    const frame = requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ block: "nearest" });
      statusRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [highlighted]);

  const save = async (input: ActivityPlacementUpdate) => {
    if (disabled) return;
    setChange(input); setPending(true); setError(null);
    try {
      setSaved(await activityApi.updatePlacement(placement.id, input));
      setChange(null);
    } catch (failure) { setError(failure); }
    finally { setPending(false); }
  };
  const reload = () => { setChange(null); setError(null); onReload(); };

  if (current.status === "archived") return null;
  return (
    <li ref={rowRef} aria-current={highlighted ? "true" : undefined} aria-busy={pending} className={`py-3 ${highlighted ? "bg-muted/50" : ""}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_auto_auto]">
        <Text as="h3" variant="bodySm" fontWeight="medium" breakWord className="col-span-2 sm:col-span-1">{placement.activity_name}</Text>
        <Text as="span" variant="bodySm" tone="subdued" className="col-span-2 sm:col-span-1">{t(`activities.types.${placement.activity_type}`)}</Text>
        <Select value={status} disabled={disabled} onValueChange={(status) => void save({ status: status as "active" | "paused", expectedLockVersion: current.lock_version })}>
          <SelectTrigger ref={statusRef} className="min-h-10 w-full" aria-label={`${placement.activity_name} · ${t("activities.placementStatus")}`} aria-invalid={!!error}>
            <SelectValue>{t(pending && !unlinking ? "activities.saving" : `activities.mapStates.${status}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>{["active", "paused"].map((status) => <SelectItem key={status} value={status}>{t(`activities.mapStates.${status}`)}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" asChild className="min-h-10"><Link href={teamHref(`/manage/activities/${placement.activity_id}`, placement.organization_id)} aria-label={`${t(activity?.capabilities.can_edit ? "activities.editContent" : "activities.viewContent")} · ${placement.activity_name}`}>{t(activity?.capabilities.can_edit ? "common.edit" : "activities.view")}</Link></Button>
        {canEdit && <Button variant="ghost" className="col-span-2 min-h-10 sm:col-span-1" disabled={disabled} onClick={() => void save({ status: "archived", expectedLockVersion: current.lock_version })}>{t(pending && unlinking ? "activities.unlinking" : "activities.unlink")}</Button>}
      </div>
      {error != null && <div className="mt-3 space-y-2">
        <ActivityFailure error={error} onReload={reload} />
        {!isLockConflict(error) && change && <Button variant="outline" size="sm" disabled={pending} onClick={() => void save(change)}>{t("contentModel.action.retry")}</Button>}
      </div>}
    </li>
  );
}
