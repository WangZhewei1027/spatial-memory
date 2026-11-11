import { mediaKeyFromUrl, mediaKeysInText } from "@/lib/storage/public-url";
import {
  ASSET_FILE_TYPES,
  MAX_ANCHOR_REFERENCES,
  RESOURCE_ROLES,
  type AssetFileType,
  type AssetPayload,
  type CaptureMetadata,
  type ModelAnimationInfo,
  type PayloadAttributes,
  type PayloadScalar,
  type PlacementRenderConfig,
  type ResourceInput,
  type ResourceRole,
} from "./contracts";
import { ContentError, invalid } from "./errors";
import { isRecord, rejectUnknown, requireEnum, requireInt, requireString, requireUuid, type JsonRecord } from "./input";

// Pure validation of version payloads, resource lists and placement render
// configs (plan §4.2, §4.4). Client-safe; the server re-runs all of it.

const MAX_TEXT = 10_000;
const MAX_ATTRIBUTES = 64;
const MAX_ATTRIBUTE_STRING = 2_000;

/** A managed media URL hidden in free-form data (whole value or embedded) would escape retention. */
function rejectManagedUrl(value: string, path: string): void {
  if (mediaKeyFromUrl(value.trim()) || mediaKeysInText(value).length)
    throw new ContentError("UNMANAGED_URL", `${path} 不能包含本站媒体文件地址，请通过资源清单登记`);
}

/** Optional free text that must not smuggle a managed file reference. */
function plainText(value: unknown, path: string, max: number): string {
  const text = requireString(value, path, { min: 0, max, trim: false });
  rejectManagedUrl(text, path);
  return text;
}

function scalar(value: unknown, path: string): PayloadScalar {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid(`${path} 必须是有限数字`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_ATTRIBUTE_STRING) throw invalid(`${path} 过长`);
    rejectManagedUrl(value, path);
    return value;
  }
  throw invalid(`${path} 只能是字符串、数字、布尔或 null`);
}

export function parseScalarMap(value: unknown, path: string): Record<string, PayloadScalar> {
  if (!isRecord(value)) throw invalid(`${path} 必须是对象`);
  const entries = Object.entries(value);
  if (entries.length > MAX_ATTRIBUTES) throw invalid(`${path} 最多 ${MAX_ATTRIBUTES} 项`);
  const out: Record<string, PayloadScalar> = {};
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)) throw invalid(`${path}.${key} 键名无效`);
    out[key] = scalar(raw, `${path}.${key}`);
  }
  return out;
}

function parseCapture(value: unknown): CaptureMetadata {
  const raw = isRecord(value) ? value : null;
  if (!raw) throw invalid("payload.capture 必须是对象");
  rejectUnknown(raw, ["latitude", "longitude", "altitude", "source", "captured_at"], "payload.capture ");
  const capture: CaptureMetadata = {};
  const num = (v: unknown, name: string, min: number, max: number) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw invalid(`payload.capture.${name} 无效`);
    return v;
  };
  if (raw.latitude !== undefined) capture.latitude = num(raw.latitude, "latitude", -90, 90);
  if (raw.longitude !== undefined) capture.longitude = num(raw.longitude, "longitude", -180, 180);
  if (raw.altitude !== undefined) capture.altitude = num(raw.altitude, "altitude", -1e5, 1e5);
  if (raw.source !== undefined) capture.source = plainText(raw.source, "payload.capture.source", 64);
  if (raw.captured_at !== undefined) capture.captured_at = plainText(raw.captured_at, "payload.capture.captured_at", 64);
  return capture;
}

function parseAnimations(value: unknown): ModelAnimationInfo[] {
  if (!Array.isArray(value) || value.length > 64) throw invalid("payload.animations 必须是不超过 64 项的数组");
  return value.map((raw, i) => {
    if (!isRecord(raw)) throw invalid(`payload.animations[${i}] 必须是对象`);
    rejectUnknown(raw, ["index", "name", "duration_seconds"], `payload.animations[${i}] `);
    const info: ModelAnimationInfo = {
      index: requireInt(raw.index, `payload.animations[${i}].index`, 0, 1000),
      name: plainText(raw.name, `payload.animations[${i}].name`, 200),
    };
    if (raw.duration_seconds !== undefined) {
      if (typeof raw.duration_seconds !== "number" || !Number.isFinite(raw.duration_seconds) || raw.duration_seconds < 0)
        throw invalid(`payload.animations[${i}].duration_seconds 无效`);
      info.duration_seconds = raw.duration_seconds;
    }
    return info;
  });
}

function httpUrl(value: unknown, path: string): string {
  const text = requireString(value, path, { max: 2048 });
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid(`${path} 不是有效链接`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw invalid(`${path} 仅支持 http(s) 链接`);
  rejectManagedUrl(text, path);
  return text;
}

const KIND_KEYS: Record<AssetFileType, string[]> = {
  image: [],
  video: [],
  audio: [],
  document: [],
  model: ["animations"],
  text: ["text"],
  link: ["url", "title", "description", "preview"],
  anchor: ["text"],
};

/** Validate a version payload for the asset's media type. */
export function parseAssetPayload(fileType: AssetFileType, value: unknown): AssetPayload {
  if (!isRecord(value)) throw invalid("payload 必须是对象");
  if (value.kind !== fileType) throw invalid(`payload.kind 必须是 ${fileType}`);
  rejectUnknown(value, ["kind", "attributes", "capture", ...KIND_KEYS[fileType]], "payload ");
  const base: { attributes?: PayloadAttributes; capture?: CaptureMetadata } = {};
  if (value.attributes !== undefined) base.attributes = parseScalarMap(value.attributes, "payload.attributes");
  if (value.capture !== undefined) base.capture = parseCapture(value.capture);
  const text = (v: unknown, path: string) => {
    const t = requireString(v, path, { max: MAX_TEXT, trim: false });
    rejectManagedUrl(t.trim(), path);
    return t;
  };
  switch (fileType) {
    case "model":
      return { kind: "model", ...base, ...(value.animations !== undefined ? { animations: parseAnimations(value.animations) } : {}) };
    case "text":
      return { kind: "text", ...base, text: text(value.text, "payload.text") };
    case "link":
      return {
        kind: "link",
        ...base,
        url: httpUrl(value.url, "payload.url"),
        ...(value.title !== undefined ? { title: plainText(value.title, "payload.title", 500) } : {}),
        ...(value.description !== undefined ? { description: plainText(value.description, "payload.description", 2000) } : {}),
        ...(value.preview !== undefined ? { preview: parseScalarMap(value.preview, "payload.preview") } : {}),
      };
    case "anchor":
      // Anchor descriptions are optional; migrated anchors may keep an empty string.
      return { kind: "anchor", ...base, ...(value.text !== undefined ? { text: plainText(value.text, "payload.text", MAX_TEXT) } : {}) };
    default:
      return { kind: fileType, ...base } as AssetPayload;
  }
}

export function parseFileType(value: unknown): AssetFileType {
  return requireEnum(value, "fileType", ASSET_FILE_TYPES);
}

/** Roles each media type must carry (beyond these, only listed roles are accepted). */
export const REQUIRED_ROLES: Record<AssetFileType, ResourceRole[]> = {
  image: ["primary"],
  video: ["primary"],
  audio: ["primary"],
  document: ["primary"],
  model: ["primary"],
  text: [],
  link: [],
  anchor: ["reference"],
};

export const ALLOWED_ROLES: Record<AssetFileType, ResourceRole[]> = {
  image: ["primary", "thumbnail"],
  video: ["primary", "thumbnail"],
  audio: ["primary", "audio_compat"],
  document: ["primary", "thumbnail"],
  model: ["primary", "thumbnail"],
  text: [],
  link: ["thumbnail"],
  anchor: ["reference"],
};

/** Shape-check a resource list; existence/ownership is the server's job. */
export function parseResourceInputs(fileType: AssetFileType, value: unknown): ResourceInput[] {
  if (!Array.isArray(value)) throw invalid("resources 必须是数组");
  if (value.length > 16) throw invalid("resources 最多 16 项");
  const seen = new Set<string>();
  const inputs = value.map((raw, i): ResourceInput => {
    const path = `resources[${i}]`;
    if (!isRecord(raw)) throw invalid(`${path} 必须是对象`);
    const role = requireEnum(raw.role, `${path}.role`, RESOURCE_ROLES);
    if (!ALLOWED_ROLES[fileType].includes(role)) throw invalid(`${fileType} 素材不支持资源角色 ${role}`);
    const ordinal = raw.ordinal === undefined ? 0 : requireInt(raw.ordinal, `${path}.ordinal`, 0, 15);
    const slot = `${role}:${ordinal}`;
    if (seen.has(slot)) throw invalid(`${path} 与其他资源角色/序号重复`);
    seen.add(slot);
    const sources = ["receiptId", "fromAssetId", "externalUrl"].filter((key) => raw[key] !== undefined);
    if (sources.length !== 1) throw invalid(`${path} 必须且只能提供 receiptId / fromAssetId / externalUrl 之一`);
    if (raw.receiptId !== undefined) {
      rejectUnknown(raw, ["role", "ordinal", "receiptId"], `${path} `);
      return { role, ordinal, receiptId: requireUuid(raw.receiptId, `${path}.receiptId`) };
    }
    if (raw.fromAssetId !== undefined) {
      rejectUnknown(raw, ["role", "ordinal", "fromAssetId", "fromRole", "fromOrdinal"], `${path} `);
      return {
        role,
        ordinal,
        fromAssetId: requireUuid(raw.fromAssetId, `${path}.fromAssetId`),
        fromRole: requireEnum(raw.fromRole ?? role, `${path}.fromRole`, RESOURCE_ROLES),
        fromOrdinal: raw.fromOrdinal === undefined ? 0 : requireInt(raw.fromOrdinal, `${path}.fromOrdinal`, 0, 15),
      };
    }
    rejectUnknown(raw, ["role", "ordinal", "externalUrl"], `${path} `);
    const url = requireString(raw.externalUrl, `${path}.externalUrl`, { max: 2048 });
    if (mediaKeyFromUrl(url) || mediaKeysInText(url).length)
      throw new ContentError("UNMANAGED_URL", `${path}.externalUrl 是本站媒体文件，必须通过上传回执或已有版本登记`);
    if (!/^https?:\/\//i.test(url)) throw invalid(`${path}.externalUrl 仅支持 http(s)`);
    return { role, ordinal, externalUrl: url };
  });
  if (fileType === "anchor" && inputs.filter((input) => input.role === "reference").length > MAX_ANCHOR_REFERENCES)
    throw invalid(`识别目标最多 ${MAX_ANCHOR_REFERENCES} 张识别图`);
  for (const role of REQUIRED_ROLES[fileType])
    if (!inputs.some((input) => input.role === role && (input.ordinal ?? 0) === 0)) throw invalid(`${fileType} 素材必须包含序号为 0 的 ${role} 资源`);
  return inputs;
}

/** Validate a placement's local overrides (plan §4.4). */
export function parseRenderConfig(value: unknown, targetFileType: AssetFileType | "scene"): PlacementRenderConfig {
  if (value === undefined || value === null) return {};
  const raw: JsonRecord = isRecord(value) ? value : (() => { throw invalid("renderConfig 必须是对象"); })();
  rejectUnknown(raw, ["is_huge", "config", "display"], "renderConfig ");
  const out: PlacementRenderConfig = {};
  if (raw.is_huge !== undefined) {
    if (typeof raw.is_huge !== "boolean") throw invalid("renderConfig.is_huge 必须是布尔值");
    if (raw.is_huge && targetFileType !== "model") throw invalid("只有模型投放可以标记为巨大模型");
    out.is_huge = raw.is_huge;
  }
  if (raw.config !== undefined) out.config = parseScalarMap(raw.config, "renderConfig.config");
  if (raw.display !== undefined) out.display = parseScalarMap(raw.display, "renderConfig.display");
  return out;
}

/** Normalize a URL under our media host to its object key (null for any other URL). */
export function managedKeyFromUrl(url: string | null | undefined): string | null {
  return url ? mediaKeyFromUrl(url) : null;
}
