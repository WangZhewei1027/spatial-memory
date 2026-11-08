"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityDto, ActivityPlacementDto } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { activityApi } from "../../lib/activity-api";
import { ActivityFailure } from "./ActivityFeedback";

export interface ActivityCollectionOption { id: string; name: string; capabilities?: { can_edit: boolean } }
interface ActivityPlacementFormProps {
  activity: ActivityDto;
  placement?: ActivityPlacementDto;
  collections: ActivityCollectionOption[];
  workspaceId?: string;
  showHeading?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

/** A placement only associates shared activity content with a map. */
export function ActivityPlacementForm({ activity, placement, collections, workspaceId, showHeading = true, onSaved, onCancel }: ActivityPlacementFormProps) {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState(() => placement?.workspace_id ?? workspaceId ?? (collections.filter((entry) => entry.capabilities?.can_edit !== false).length === 1 ? collections.find((entry) => entry.capabilities?.can_edit !== false)!.id : ""));
  const [status, setStatus] = useState<ActivityPlacementDto["status"]>(placement?.status ?? "draft");
  const [expectedLockVersion] = useState(placement?.lock_version);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const intent = useRef<string | null>(null);
  const canEdit = activity.state === "active" && (placement ? placement.capabilities.can_edit : activity.capabilities.can_edit);
  const selectedCollection = collections.find((entry) => entry.id === workspace);
  const disabled = pending || !canEdit || !selectedCollection || selectedCollection.capabilities?.can_edit === false;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || !workspace) return;
    setError(null); setPending(true);
    try {
      if (placement && expectedLockVersion !== undefined) await activityApi.updatePlacement(placement.id, { status, expectedLockVersion });
      else {
        intent.current ??= crypto.randomUUID();
        await activityApi.place(activity.id, { workspaceId: workspace, status, idempotencyKey: intent.current });
      }
      onSaved();
    } catch (failure) { setError(failure); }
    finally { setPending(false); }
  };
  const cancelButton = <Button variant="outline" type="button" onClick={onCancel} disabled={pending} className={workspaceId ? "min-h-10 flex-1 sm:flex-none" : undefined}>{t("activities.cancel")}</Button>;
  const saveButton = canEdit && <Button type="submit" disabled={disabled || !workspace} className={workspaceId ? "min-h-10 flex-1 sm:flex-none" : undefined}>{t(pending ? "activities.saving" : "activities.savePlacement")}</Button>;

  return <form className={workspaceId ? "flex min-h-0 flex-1 flex-col" : "space-y-4"} onSubmit={submit}>
    <div className={workspaceId ? "min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6" : "space-y-4"}>
      {showHeading && <div className="space-y-1">
        <Text as="h3" variant="headingMd" breakWord>{workspaceId ? activity.name : t(placement ? "activities.editPlacement" : "activities.place")}</Text>
        {!workspaceId && <Text as="p" variant="bodySm" tone="subdued" breakWord>{activity.name}</Text>}
      </div>}
      <Text as="p" variant="bodySm" tone="subdued">{t("activities.placementRelationHint")}</Text>
      {!workspaceId && <div className="space-y-2"><Label htmlFor="activity-placement-map">{t("activities.map")}</Label><Select value={workspace} disabled={pending || !canEdit || !!placement} onValueChange={(value) => { setWorkspace(value); intent.current = null; }}><SelectTrigger id="activity-placement-map" className="w-full"><SelectValue placeholder={t("activities.chooseMap")} /></SelectTrigger><SelectContent>{collections.map((collection) => <SelectItem key={collection.id} value={collection.id} disabled={collection.capabilities?.can_edit === false && collection.id !== workspace}>{collection.name}</SelectItem>)}</SelectContent></Select></div>}
      <div className="space-y-2"><Label htmlFor="activity-placement-status">{t("activities.placementStatus")}</Label><Select value={status} disabled={disabled} onValueChange={(value) => { setStatus(value as ActivityPlacementDto["status"]); intent.current = null; }}><SelectTrigger id="activity-placement-status" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["draft", "active", "paused", "archived"].map((entry) => <SelectItem key={entry} value={entry}>{t(`activities.placementStates.${entry}`)}</SelectItem>)}</SelectContent></Select></div>
      <ActivityFailure error={error} onReload={onCancel} />
    </div>
    <div className={workspaceId ? "flex shrink-0 justify-end gap-2 border-t px-5 py-4 sm:px-6" : "flex flex-wrap gap-2"}>
      {workspaceId ? <>{cancelButton}{saveButton}</> : <>{saveButton}{cancelButton}</>}
    </div>
  </form>;
}
