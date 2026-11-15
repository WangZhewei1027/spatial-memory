import { invalid } from "@/lib/content-model/errors";
import { optionalString, optionalUuid, rejectUnknown, requireEnum, requireInt, requireNumber, requireRecord, requireString, requireUuid } from "@/lib/content-model/input";
import type { ActivityConfig, ActivityLocation, ActivityPointInput, ActivityType } from "./contracts";
import { DEFAULT_DANMAKU_MAX_LENGTH } from "./defaults";

export function parseActivityConfig(value: unknown, type: ActivityType): ActivityConfig {
  const body = requireRecord(value, "config");
  rejectUnknown(body, type === "shop_checkin" ? ["checkinRadiusMeters"] : ["maxLength"], "config");
  return type === "shop_checkin"
    ? body.checkinRadiusMeters === undefined ? {} : { checkinRadiusMeters: requireNumber(body.checkinRadiusMeters, "checkinRadiusMeters", 1, 1000) }
    : body.maxLength === undefined ? {} : { maxLength: requireInt(body.maxLength, "maxLength", 1, 500) };
}

export function effectiveConfig(type: ActivityType, base: unknown): ActivityConfig {
  const read = (value: unknown): ActivityConfig => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const object = value as Record<string, unknown>;
    if (type === "shop_checkin") {
      const n = object.checkinRadiusMeters;
      return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 1000 ? { checkinRadiusMeters: n } : {};
    }
    const n = object.maxLength;
    return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 500 ? { maxLength: n } : {};
  };
  return { ...(type === "shop_checkin" ? { checkinRadiusMeters: 50 } : { maxLength: DEFAULT_DANMAKU_MAX_LENGTH }), ...read(base) };
}

export function parseLocation(value: unknown, field = "location"): ActivityLocation | null {
  if (value === null) return null;
  const body = requireRecord(value, field);
  rejectUnknown(body, ["longitude", "latitude"], field);
  return { longitude: requireNumber(body.longitude, `${field}.longitude`, -180, 180), latitude: requireNumber(body.latitude, `${field}.latitude`, -90, 90) };
}

/** The activity owns its participation area; omitted update fields retain it. */
export function parseActivityArea(body: Record<string, unknown>, previous?: { location: ActivityLocation | null; radius_meters: number | null }) {
  const location = body.location === undefined ? previous?.location ?? null : parseLocation(body.location);
  const radius = body.radiusMeters === undefined ? previous?.radius_meters ?? null
    : body.radiusMeters === null ? null : requireNumber(body.radiusMeters, "radiusMeters", 1, 100000);
  if ((location === null) !== (radius === null)) throw invalid("活动范围需要同时设置中心位置和半径；整地图活动请同时留空");
  return { location, radius_meters: radius };
}

export function parsePoints(value: unknown): ActivityPointInput[] {
  if (!Array.isArray(value) || value.length > 500) throw invalid("points 必须是最多 500 项的数组");
  const ids = new Set<string>();
  return value.map((item, ordinal): ActivityPointInput => {
    const body = requireRecord(item, "point");
    rejectUnknown(body, ["id", "name", "description", "ordinal", "imageAssetId", "rewardAssetId", "location", "state"], "point");
    const id = body.id === undefined ? undefined : requireUuid(body.id, "point.id");
    if (id && ids.has(id)) throw invalid("打卡点 ID 不能重复");
    if (id) ids.add(id);
    return {
      ...(id ? { id } : {}), name: requireString(body.name, "point.name"),
      description: optionalString(body.description, "point.description", { max: 5000 }) ?? null,
      ordinal: body.ordinal === undefined ? ordinal : requireInt(body.ordinal, "point.ordinal", 0, 100000),
      imageAssetId: optionalUuid(body.imageAssetId, "point.imageAssetId") ?? null,
      rewardAssetId: optionalUuid(body.rewardAssetId, "point.rewardAssetId") ?? null,
      ...(body.location === undefined ? {} : { location: parseLocation(body.location, "point.location") }),
      state: body.state === undefined ? "active" : requireEnum(body.state, "point.state", ["active", "archived"] as const),
    };
  });
}

/** WGS84 great-circle distance, in meters; used for server-side participation rules. */
export function distanceMeters(a: ActivityLocation, b: ActivityLocation): number {
  const rad = Math.PI / 180;
  const h = Math.sin((a.latitude - b.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((a.longitude - b.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
