"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Plus, MessageSquare, MapPin } from "lucide-react";
import type { ActivityType } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { ContentEmptyState, ContentErrorState } from "../../content/ContentFeedback";
import { TeamPageLoading } from "../TeamShell";
import { ContentFeatureState } from "../ContentFeatureState";
import { teamCanWrite, teamHref, useTeamContext } from "../../lib/content-context";
import { activityApi } from "../../lib/activity-api";
import { LibraryLayout } from "../../content/LibraryLayout";
import { getTeamLibraryPage } from "../../lib/content-api";
import { subscribeContentChanges } from "../../lib/content-events";
import { useLibraryPages, useLibrarySearch } from "../../workbench/useLibraryPages";
import type { CollectionState } from "@/lib/content-model/contracts";
import { ActivityFailure } from "./ActivityFeedback";

export function ActivitiesRoute() {
  const team = useTeamContext();
  return team.organizationId ? <ActivityLibrary key={team.organizationId} organizationId={team.organizationId} canCreate={teamCanWrite({ archivedAt: team.organization?.archived_at, orgRole: team.organization?.role, globalRole: team.currentUserRole })} /> : team.loading ? <TeamPageLoading label="…" /> : <ContentFeatureState state="no-organization" />;
}

function ActivityLibrary({ organizationId, canCreate }: { organizationId: string; canCreate: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<CollectionState>("active");
  const q = useLibrarySearch(search);
  const load = useCallback((offset: number, limit: number, signal: AbortSignal) =>
    getTeamLibraryPage(organizationId, "activities", { q, state, offset, limit }, signal), [organizationId, q, state]);
  const list = useLibraryPages(load);
  useEffect(() => subscribeContentChanges(list.reload), [list.reload]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ActivityType>("shop_checkin");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const intent = useRef<string | null>(null);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true); setError(null);
    intent.current ??= crypto.randomUUID();
    try {
      const activity = await activityApi.create(organizationId, { name: name.trim(), type, idempotencyKey: intent.current });
      router.push(teamHref(`/manage/activities/${activity.id}`, organizationId));
    } catch (failure) { setError(failure); } finally { setPending(false); }
  };
  return (
    <LibraryLayout
      title={t("activities.title")}
      actions={canCreate && !creating && <Button onClick={() => setCreating(true)}><Plus aria-hidden />{t("activities.create")}</Button>}
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
      {creating && (
        <Card className="p-4">
          <form onSubmit={create} className="space-y-4">
            <Text as="h2" variant="headingMd">{t("activities.create")}</Text>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-activity-name">{t("activities.name")}</Label>
                <Input id="new-activity-name" autoFocus required maxLength={200} value={name} disabled={pending}
                  onChange={event => { setName(event.target.value); intent.current = null; }} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-activity-type">{t("activities.type")}</Label>
                <Select value={type} disabled={pending} onValueChange={value => { setType(value as ActivityType); intent.current = null; }}>
                  <SelectTrigger id="new-activity-type" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shop_checkin">{t("activities.types.shop_checkin")}</SelectItem>
                    <SelectItem value="danmaku">{t("activities.types.danmaku")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <ActivityFailure error={error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={pending || !name.trim()}>{t(pending ? "activities.saving" : "activities.create")}</Button>
              <Button variant="outline" type="button" disabled={pending} onClick={() => setCreating(false)}>{t("activities.cancel")}</Button>
            </div>
          </form>
        </Card>
      )}
      {list.status === "loading" ? (
        <TeamPageLoading label={t("activities.loading")} />
      ) : list.status === "error" ? (
        <div className="my-auto"><ContentErrorState onRetry={list.reload} /></div>
      ) : !list.items.length ? (
        <div className="my-auto"><ContentEmptyState headingAs="h2" title={t("activities.empty")} description={t("activities.emptyHint")} /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.items.map(activity => {
            const Icon = activity.type === "shop_checkin" ? MapPin : MessageSquare;
            return (
              <Card key={activity.id} className="p-4">
                <Link href={teamHref(`/manage/activities/${activity.id}`, organizationId)}
                  className="flex items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Icon className="mt-1 size-5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Text as="h2" variant="headingMd" breakWord>{activity.name}</Text>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{t(`activities.types.${activity.type}`)}</Badge>
                      <Badge variant="outline">{t(`activities.states.${activity.state}`)}</Badge>
                    </div>
                    {activity.description && <Text as="p" variant="bodySm" tone="subdued" breakWord>{activity.description}</Text>}
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </LibraryLayout>
  );
}
