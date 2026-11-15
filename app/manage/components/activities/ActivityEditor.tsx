"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Archive, RotateCcw, Check, MapPin, Save } from "lucide-react";
import { DEFAULT_DANMAKU_MAX_LENGTH } from "@/lib/activities/defaults";
import type { ActivityDto, ActivityLocation, ActivityPointInput } from "@/lib/activities/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Text } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { activityApi } from "../../lib/activity-api";
import { useManageStore } from "../../store";
import { ActivityFailure } from "./ActivityFeedback";
import { ActivityImagePicker, type ImageChoice } from "./ActivityImagePicker";
import { ActivityLocationMap } from "./ActivityLocationMap";

interface LocationDraft { longitude: string; latitude: string }
interface PointDraft {
  key: string;
  id?: string;
  name: string;
  description: string;
  state: "active" | "archived";
  location: LocationDraft;
  image: ImageChoice | null;
  reward: ImageChoice | null;
}
const CENTER_ID = "activity-center";
const draftLocation = (location?: ActivityLocation | null): LocationDraft => ({ longitude: location ? String(location.longitude) : "", latitude: location ? String(location.latitude) : "" });
function parseLocation(draft: LocationDraft): ActivityLocation | null {
  if (!draft.longitude.trim() && !draft.latitude.trim()) return null;
  const longitude = Number(draft.longitude), latitude = Number(draft.latitude);
  if (!draft.longitude.trim() || !draft.latitude.trim() || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) throw new Error("INVALID_LOCATION");
  return { longitude, latitude };
}
function previewLocation(draft: LocationDraft): ActivityLocation | null {
  try { return parseLocation(draft); } catch { return null; }
}
function LocationFields({ id, value, disabled, onChange, form }: { id: string; value: LocationDraft; disabled: boolean; onChange: (value: LocationDraft) => void; form?: string }) {
  const { t } = useTranslation();
  return <details className="rounded-md border px-3 py-2" key={id}>
    <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("activities.preciseLocation")}</summary>
    <div className="space-y-3 pt-3"><div className="grid grid-cols-2 gap-3">
      <div className="space-y-1"><Label htmlFor={`${id}-longitude`}>{t("activities.longitude")}</Label><Input form={form} id={`${id}-longitude`} type="number" step="any" min={-180} max={180} value={value.longitude} disabled={disabled} onChange={(event) => onChange({ ...value, longitude: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`${id}-latitude`}>{t("activities.latitude")}</Label><Input form={form} id={`${id}-latitude`} type="number" step="any" min={-90} max={90} value={value.latitude} disabled={disabled} onChange={(event) => onChange({ ...value, latitude: event.target.value })} /></div>
    </div><Button type="button" variant="ghost" size="sm" disabled={disabled || (!value.longitude && !value.latitude)} onClick={() => onChange(draftLocation(null))}>{t("activities.clearLocation")}</Button></div>
  </details>;
}

export interface ActivityEditorPanels {
  settings: ReactNode;
  map: ReactNode;
  actions: ReactNode;
  pointDetails?: ReactNode;
}

export function ActivityEditor({ activity, onSaved, onReload, renderWorkspace, onInspectPoint }: {
  activity: ActivityDto;
  onSaved: (activity: ActivityDto) => void;
  onReload: () => void;
  renderWorkspace: (panels: ActivityEditorPanels) => ReactNode;
  onInspectPoint: () => void;
}) {
  const formId = useId();
  const { t } = useTranslation();
  // A draft always saves against the version it was opened from.
  const [baseActivity] = useState(activity);
  const mapCenter = useManageStore((state) => state.organizations.find((org) => org.id === activity.organization_id)?.map_center);
  const shop = activity.type === "shop_checkin";
  const [name, setName] = useState(activity.name);
  const [description, setDescription] = useState(activity.description ?? "");
  const [radius, setRadius] = useState(String(activity.config.checkinRadiusMeters ?? 50));
  const [maxLength, setMaxLength] = useState(String(activity.config.maxLength ?? DEFAULT_DANMAKU_MAX_LENGTH));
  const [location, setLocation] = useState(draftLocation(activity.location));
  const [scoped, setScoped] = useState(!!activity.location);
  const [areaRadius, setAreaRadius] = useState(String(activity.radius_meters ?? 100));
  const [points, setPoints] = useState<PointDraft[]>(() => activity.points.map((point) => ({ key: point.id, id: point.id, name: point.name, description: point.description ?? "", state: point.state, location: draftLocation(point.location), image: point.image_asset_id ? { id: point.image_asset_id, url: point.image_url } : null, reward: point.reward_asset_id ? { id: point.reward_asset_id, url: point.reward_url } : null })));
  const [selectedPointId, setSelectedPointId] = useState<string | null>(() => activity.points.find((point) => point.state === "active" && !point.location)?.id ?? activity.points.find((point) => point.state === "active")?.id ?? activity.points[0]?.id ?? null);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const editable = activity.capabilities.can_edit && activity.state === "active";
  const disabled = !editable || pending;
  const selectedPoint = points.find((point) => point.key === selectedPointId);
  const selectPoint = (id: string) => { setSelectedPointId(id); onInspectPoint(); };
  const activePoints = points.filter((point) => point.state === "active");
  const changePoint = (key: string, patch: Partial<PointDraft>) => {
    if (disabled || (points.find((point) => point.key === key)?.state === "archived" && !patch.state)) return;
    setPoints((current) => current.map((point) => point.key === key ? { ...point, ...patch } : point));
    setDirty(true);
  };
  const updateLocation = (id: string, value: ActivityLocation) => {
    if (disabled) return;
    if (shop) {
      if (!points.some((point) => point.key === id && point.state === "active")) return;
      changePoint(id, { location: draftLocation(value) });
    } else if (id === CENTER_ID && scoped) {
      setLocation(draftLocation(value)); setDirty(true);
    }
  };
  const addPoint = () => {
    if (disabled) return;
    const key = crypto.randomUUID();
    setPoints((current) => [...current, { key, name: "", description: "", state: "active", location: draftLocation(null), image: null, reward: null }]);
    selectPoint(key); setDirty(true);
  };
  const removePoint = (point: PointDraft) => {
    if (disabled) return;
    if (point.id) changePoint(point.key, { state: point.state === "active" ? "archived" : "active" });
    else {
      const remaining = points.filter((entry) => entry.key !== point.key);
      setPoints(remaining); setSelectedPointId(remaining.find((entry) => entry.state === "active")?.key ?? remaining[0]?.key ?? null); setDirty(true);
    }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || !name.trim()) return;
    setError(null); setPending(true);
    try {
      const input: ActivityPointInput[] = points.map((point, ordinal) => {
        if (!point.name.trim()) { selectPoint(point.key); throw new Error(t("activities.pointNameRequired")); }
        let pointLocation: ActivityLocation | null;
        try { pointLocation = parseLocation(point.location); }
        catch { selectPoint(point.key); throw new Error(t("activities.invalidLocation")); }
        return { ...(point.id ? { id: point.id } : {}), name: point.name.trim(), description: point.description.trim() || null, ordinal, state: point.state, location: pointLocation, imageAssetId: point.image?.id ?? null, rewardAssetId: point.reward?.id ?? null };
      });
      const center = !shop && scoped ? parseLocation(location) : null;
      if (!shop && scoped && (!center || !areaRadius.trim() || !Number.isFinite(Number(areaRadius)) || Number(areaRadius) <= 0)) throw new Error(t("activities.radiusRequired"));
      const rule = Number(shop ? radius : maxLength);
      if (!Number.isFinite(rule) || rule < 1 || (shop ? rule > 1000 : !Number.isInteger(rule) || rule > 500)) throw new Error(t("activities.invalidRule"));
      onSaved(await activityApi.update(activity.id, {
        expectedLockVersion: baseActivity.lock_version,
        name: name.trim(), description: description.trim() || null,
        config: { ...baseActivity.config, ...(shop ? { checkinRadiusMeters: rule } : { maxLength: rule }) },
        ...(shop ? { points: input } : { location: center, radiusMeters: center ? Number(areaRadius) : null }),
      }));
    } catch (failure) { setError(failure instanceof Error && failure.message === "INVALID_LOCATION" ? new Error(t("activities.invalidLocation")) : failure); }
    finally { setPending(false); }
  };
  const archive = async () => {
    setError(null); setPending(true);
    try { onSaved(await activityApi.update(activity.id, { expectedLockVersion: baseActivity.lock_version, state: activity.state === "active" ? "archived" : "active" })); }
    catch (failure) { setError(failure); } finally { setPending(false); }
  };
  const markers = shop ? activePoints.map((point) => ({ id: point.key, name: point.name || t("activities.unnamedPoint"), location: previewLocation(point.location) })) : [{ id: CENTER_ID, name, location: previewLocation(location) }];
  const currentLocation = shop ? selectedPoint?.location : location;
  const currentPosition = currentLocation ? previewLocation(currentLocation) : null;
  const targetDisabled = disabled || (shop && selectedPoint?.state !== "active");

  const fields = <div className="space-y-4">
    <div className="space-y-2"><Label htmlFor="activity-name">{t("activities.name")}</Label><Input id="activity-name" value={name} required maxLength={200} disabled={disabled} onChange={(event) => setName(event.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="activity-description">{t("activities.description")}</Label><Textarea id="activity-description" value={description} disabled={disabled} onChange={(event) => setDescription(event.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="activity-rule">{t(shop ? "activities.checkinRadius" : "activities.maxLength")}</Label><Input id="activity-rule" type="number" min={1} max={shop ? 1000 : 500} step={shop ? "any" : 1} value={shop ? radius : maxLength} disabled={disabled} onChange={(event) => shop ? setRadius(event.target.value) : setMaxLength(event.target.value)} required /></div>
    <Text as="p" variant="bodySm" tone="subdued">{t("activities.sharedSettings")}</Text>
  </div>;
  const area = <section className="space-y-4">
    <Text as="h3" variant="bodySm" fontWeight="semibold">{t("activities.participationArea")}</Text>
    <Select value={scoped ? "area" : "map"} disabled={disabled} onValueChange={(value) => { setScoped(value === "area"); setDirty(true); }}>
      <SelectTrigger aria-label={t("activities.participationArea")} className="w-full [&>span]:min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="map">{t("activities.wholeMap")}</SelectItem><SelectItem value="area">{t("activities.localArea")}</SelectItem></SelectContent>
    </Select>
    {scoped && <div className="space-y-3">
      <Text as="p" variant="bodySm" tone="subdued">{currentPosition ? t("activities.positionSummary", { longitude: currentPosition.longitude.toFixed(6), latitude: currentPosition.latitude.toFixed(6) }) : t("activities.pointNeedsLocation")}</Text>
      <LocationFields id={CENTER_ID} value={location} disabled={disabled} onChange={(value) => { setLocation(value); setDirty(true); }} />
      <div className="space-y-2"><Label htmlFor="activity-area-radius">{t("activities.radius")}</Label><Input id="activity-area-radius" type="number" min={1} step="any" value={areaRadius} disabled={disabled} onChange={(event) => setAreaRadius(event.target.value)} /></div>
    </div>}
  </section>;
  const pointList = <section className="space-y-3" aria-labelledby="activity-points-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Text as="h3" id="activity-points-title" variant="bodySm" fontWeight="semibold">{t("activities.points")}</Text>
      {editable && <Button variant="outline" size="sm" type="button" disabled={pending} onClick={addPoint}><Plus aria-hidden />{t("activities.addPoint")}</Button>}
    </div>
    <Text as="p" variant="bodySm" tone="subdued">{t("activities.locatedProgress", { located: activePoints.filter((point) => previewLocation(point.location)).length, total: activePoints.length })}</Text>
    {!points.length ? <Text as="p" variant="bodySm" tone="subdued">{t("activities.noPoints")}</Text> : <div className="divide-y rounded-md border">
      {points.map((point, index) => <button key={point.key} type="button" disabled={pending} aria-pressed={selectedPointId === point.key} onClick={() => selectPoint(point.key)} className={`flex w-full items-center gap-3 px-3 py-3 text-left first:rounded-t-md last:rounded-b-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 ${selectedPointId === point.key ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
        <span className="min-w-0 flex-1"><Text as="span" variant="bodySm" fontWeight="medium" breakWord>{point.name || t("activities.unnamedPoint")}</Text><Text as="span" variant="bodySm" tone="subdued" className="block">{t(point.state === "archived" ? "activities.states.archived" : previewLocation(point.location) ? "activities.pointLocated" : "activities.pointNeedsLocation")}</Text></span>
        {previewLocation(point.location) && point.state === "active" ? <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      </button>)}
    </div>}
  </section>;
  const pointDetails = selectedPoint ? <div className="space-y-4">
    <Text as="h2" variant="bodyMd" fontWeight="semibold" breakWord>{selectedPoint.name || t("activities.unnamedPoint")}</Text>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge variant="outline">{t(`activities.states.${selectedPoint.state}`)}</Badge>
      {editable && <Button variant="ghost" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal" type="button" disabled={pending} onClick={() => removePoint(selectedPoint)}>{selectedPoint.state === "archived" ? <RotateCcw aria-hidden /> : <Archive aria-hidden />}{t(selectedPoint.state === "archived" ? "activities.restore" : selectedPoint.id ? "activities.archivePoint" : "activities.removePoint")}</Button>}
    </div>
    <div className="space-y-2"><Label htmlFor={`point-name-${selectedPoint.key}`}>{t("activities.pointName")}</Label><Input form={formId} id={`point-name-${selectedPoint.key}`} required value={selectedPoint.name} disabled={targetDisabled} maxLength={200} onChange={(event) => changePoint(selectedPoint.key, { name: event.target.value })} /></div>
    <div className="space-y-2"><Label htmlFor={`point-description-${selectedPoint.key}`}>{t("activities.description")}</Label><Textarea form={formId} id={`point-description-${selectedPoint.key}`} value={selectedPoint.description} disabled={targetDisabled} onChange={(event) => changePoint(selectedPoint.key, { description: event.target.value })} /></div>
    <div aria-live="polite"><Text as="p" variant="bodySm" tone="subdued">{currentPosition ? t("activities.positionSummary", { longitude: currentPosition.longitude.toFixed(6), latitude: currentPosition.latitude.toFixed(6) }) : t("activities.pointNeedsLocation")}</Text></div>
    <LocationFields form={formId} id={selectedPoint.key} value={selectedPoint.location} disabled={targetDisabled} onChange={(value) => changePoint(selectedPoint.key, { location: value })} />
    <div className="space-y-4 border-t pt-4">
      <ActivityImagePicker organizationId={activity.organization_id} label={t("activities.pointImage")} disabled={targetDisabled} value={selectedPoint.image} onChange={(image) => changePoint(selectedPoint.key, { image })} />
      <ActivityImagePicker organizationId={activity.organization_id} label={t("activities.rewardImage")} disabled={targetDisabled} value={selectedPoint.reward} onChange={(reward) => changePoint(selectedPoint.key, { reward })} />
    </div>
  </div> : <div className="space-y-2">
    <Text as="h2" variant="bodyMd" fontWeight="semibold">{t("activities.points")}</Text>
    <Text as="p" variant="bodySm" tone="subdued">{t("activities.noPoints")}</Text>
  </div>;
  const mapTitle = shop ? selectedPoint?.name || t("activities.points") : `${t("activities.participationArea")} · ${t(scoped ? "activities.localArea" : "activities.wholeMap")}`;

  return renderWorkspace({
    // Both columns submit through this one form. Explicit validation can reveal an
    // invalid point even when its inspector tab is hidden.
    settings: <form id={formId} noValidate onSubmit={save} onChange={() => setDirty(true)} className="space-y-6">
      {!editable && <Text as="p" variant="bodySm" tone="subdued">{t(activity.state === "archived" ? "activities.states.archived" : "activities.readOnly")}</Text>}
      <ActivityFailure error={error} onReload={onReload} />
      {fields}
      <div className="border-t pt-5">{shop ? pointList : area}</div>
      {activity.capabilities.can_edit && <div className="border-t pt-4"><Button type="button" variant="outline" disabled={pending} onClick={archive}>{t(activity.state === "active" ? "activities.archive" : "activities.restore")}</Button></div>}
    </form>,
    map: <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-1 border-b bg-background px-4 py-3">
        <Text as="h2" variant="bodySm" fontWeight="semibold" truncate title={mapTitle}>{mapTitle}</Text>
        <Text as="p" variant="bodySm" tone="subdued">{t(!editable ? "activities.readOnly" : shop ? !selectedPoint ? "activities.noPoints" : selectedPoint.state === "archived" ? "activities.states.archived" : "activities.clickInlineMap" : scoped ? "activities.clickInlineMap" : "activities.wholeMapSimpleHint")}</Text>
      </div>
      <div className="min-h-0 flex-1"><ActivityLocationMap fill markers={shop || scoped ? markers : []} selectedId={shop ? selectedPoint?.state === "active" ? selectedPoint.key : null : scoped ? CENTER_ID : null} onSelect={shop ? selectPoint : () => {}} onLocationChange={updateLocation} center={mapCenter} disabled={targetDisabled || (!shop && !scoped)} title={t("activities.locationMapTitle")} /></div>
    </div>,
    pointDetails: shop ? pointDetails : undefined,
    actions: <>
      {dirty && <Text as="span" variant="bodySm" tone="subdued" role="status" className="hidden sm:inline">{t("activities.unsavedLocations")}</Text>}
      {editable && <Button type="submit" form={formId} size="sm" disabled={pending || !name.trim() || !dirty}><Save aria-hidden />{t(pending ? "activities.saving" : "common.save")}</Button>}
    </>,
  });
}
