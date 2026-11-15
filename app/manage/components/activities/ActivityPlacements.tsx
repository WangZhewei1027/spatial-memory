"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityDto, ActivityPlacementDto } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { ContentEmptyState, ContentErrorState, ContentListSkeleton } from "../../content/ContentFeedback";
import { activityApi } from "../../lib/activity-api";
import { useCollections } from "../../lib/collections";
import { ActivityPlacementForm } from "./ActivityPlacementForm";
import { useActivityQuery } from "./useActivityQuery";
import { ActivityFailure } from "./ActivityFeedback";
import { isLockConflict } from "../../lib/content-api";

export function ActivityPlacements({ activity }: { activity: ActivityDto }) {
  const { t } = useTranslation();
  const load = useCallback((signal: AbortSignal) => activityApi.placements(activity.id, signal), [activity.id]);
  const query = useActivityQuery(activity.id, load);
  const collections = useCollections(activity.organization_id, "all");
  const [editing, setEditing] = useState<ActivityPlacementDto | "new" | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (editing) section.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [editing]);
  const close = () => { setEditing(null); setError(null); query.reload(); };
  const canEdit = activity.capabilities.can_edit && activity.state === "active";
  const linkedPlacements = (query.data ?? []).filter((placement) => placement.status !== "archived");
  const alreadyLinked = linkedPlacements.length > 0;
  const editableMaps = collections.collections.filter((collection) => collection.capabilities.can_edit);
  const availableMaps = alreadyLinked ? [] : editableMaps;
  const choicesReady = !query.loading && !query.error && collections.status === "ready";
  const noMapChoices = !availableMaps.length;
  const unlink = async (placement: ActivityPlacementDto) => {
    setUnlinking(placement.id); setError(null);
    try {
      await activityApi.updatePlacement(placement.id, { status: "archived", expectedLockVersion: placement.lock_version });
      query.reload();
    } catch (failure) { setError(failure); }
    finally { setUnlinking(null); }
  };

  return <section ref={section} className="scroll-mt-20 space-y-4">
    {!editing && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><Text as="h2" variant="headingMd">{t("activities.placements")}</Text>{canEdit && <Button disabled={!choicesReady || noMapChoices || !!unlinking} onClick={() => setEditing("new")}>{t("activities.place")}</Button>}</div>
      <Text as="p" variant="bodySm" tone="subdued">{t("activities.placementsHint")}</Text>
      {canEdit && choicesReady && noMapChoices && <Text as="p" variant="bodySm" tone="subdued">{t(alreadyLinked ? "activities.alreadyLinked" : collections.collections.length ? "activities.noEditableMaps" : "activities.noMaps")}</Text>}
      {canEdit && collections.error && <ContentErrorState onRetry={collections.reload} />}
      <ActivityFailure error={error} onReload={close} />
    </>}
    {editing ? collections.status === "loading" || query.loading ? <ContentListSkeleton label={t("activities.loading")} />
      : collections.error || query.error ? <ContentErrorState onRetry={() => { collections.reload(); query.reload(); }} />
      : editing === "new" && noMapChoices ? <ContentEmptyState title={t(alreadyLinked ? "activities.alreadyLinked" : "activities.noMaps")} actions={<Button variant="outline" onClick={close}>{t("activities.cancel")}</Button>} />
      : <div className="border-t pt-4"><ActivityPlacementForm key={editing === "new" ? "new" : editing.id} activity={activity} placement={editing === "new" ? undefined : editing} previousPlacements={query.data ?? []} showHeading={false} collections={editing === "new" ? availableMaps : collections.collections} onSaved={close} onCancel={close} /></div>
      : query.loading ? <ContentListSkeleton label={t("activities.loading")} />
      : query.error ? <ContentErrorState onRetry={query.reload} />
      : !linkedPlacements.length ? <ContentEmptyState title={t("activities.noPlacements")} description={t("activities.noPlacementsHint")} />
      : <div className="space-y-3">{linkedPlacements.map((placement) => <Card key={placement.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0 space-y-2"><Text as="h3" variant="bodyMd" fontWeight="semibold" breakWord>{placement.workspace_name}</Text><Badge variant="outline">{t(`activities.mapStates.${placement.status}`)}</Badge></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!!unlinking} onClick={() => setEditing(placement)}>{t(placement.capabilities.can_edit ? "activities.editPlacement" : "activities.viewPlacement")}</Button>{canEdit && placement.capabilities.can_edit && <Button variant="ghost" disabled={!!unlinking || isLockConflict(error)} onClick={() => void unlink(placement)}>{t(unlinking === placement.id ? "activities.unlinking" : "activities.unlink")}</Button>}</div></Card>)}</div>}
  </section>;
}
