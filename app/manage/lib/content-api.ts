import type { ActivityDto } from "@/lib/activities/contracts";
import { readUploadEvents, UPLOAD_STREAM_CONTENT_TYPE, type UploadStageListener } from "@/lib/upload/progress";
import { notifyContentChange } from "./content-events";
/**
 * Typed browser client for the content model APIs.
 *
 * Every request/response type comes from lib/content-model/contracts.ts; this
 * module only knows paths, verbs and the error envelope. It never toasts:
 * callers decide how a conflict, permission or feature-state error is shown.
 *
 */
import {
  isApiErrorBody,
  type ApiErrorDetails,
  type ApiPage,
  type ArchiveAssetResult,
  type AssetDetailDto,
  type AssetDto,
  type AssetListQuery,
  type AssetUsageDto,
  type CollectionDto,
  type LibraryListQuery,
  type LibraryPage,
  type CollectionState,
  type ContentErrorCode,
  type CopyPlacementRequest,
  type CopySceneRequest,
  type CreateAssetResult,
  type CreateCollectionRequest,
  type CreateOrganizationAssetRequest,
  type CreatePlacementRequest,
  type CreatePlacementResult,
  type CreateSceneRequest,
  type DuplicateAssetRequest,
  type MovePlacementsRequest,
  type PlacementContentDto,
  type PlacementDto,
  type PlacementStatus,
  type SaveSceneRequest,
  type SceneDetailDto,
  type SceneSummaryDto,
  type UpdateAssetRequest,
  type UpdateCollectionRequest,
  type UpdatePlacementRequest,
  type UploadPurpose,
  type UploadReceiptDto,
  type UploadResponse
} from "@/lib/content-model/contracts";

export class ContentApiError extends Error {
  readonly status: number;
  /** Null when the response was not a contract error body (network, missing route, HTML). */
  readonly code: ContentErrorCode | null;
  readonly details?: ApiErrorDetails;

  constructor(message: string, status: number, code: ContentErrorCode | null, details?: ApiErrorDetails) {
    super(message);
    this.name = "ContentApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isContentApiError(error: unknown): error is ContentApiError {
  return error instanceof ContentApiError;
}

/** Stale or missing lock: the local draft must be kept and the user offered a reload. */
export function isLockConflict(error: unknown) {
  return isContentApiError(error) && (error.code === "LOCK_VERSION_CONFLICT" || error.code === "LOCK_VERSION_REQUIRED");
}

/** The route does not exist yet (backend not deployed) — distinct from a contract 404. */
export function isEndpointMissing(error: unknown) {
  return isContentApiError(error) && error.code === null && (error.status === 404 || error.status === 405);
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}${path.includes("?") ? "&" : "?"}${text}` : path;
}

async function parse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Missing routes return HTML; keep body null so the caller sees code=null.
  }
  if (!response.ok) {
    if (isApiErrorBody(body)) throw new ContentApiError(body.error, response.status, body.code, body.details);
    const message = (body as { error?: unknown } | null)?.error;
    throw new ContentApiError(typeof message === "string" ? message : `HTTP ${response.status}`, response.status, null);
  }
  return body as T;
}

export async function contentRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(withQuery(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ContentApiError(error instanceof Error ? error.message : "Network error", 0, null);
  }
  const result = await parse<T>(response);
  if (options.method && options.method !== "GET") notifyContentChange();
  return result;
}

const get = <T>(path: string, query?: Query, signal?: AbortSignal) => contentRequest<T>(path, { query, signal });
const send = <T>(method: RequestOptions["method"], path: string, body?: unknown, query?: Query) => contentRequest<T>(path, { method, body, query });
const id = encodeURIComponent;

type Data<T> = { data: T };
/** List endpoints may or may not page; normalize to one shape. */
export interface ListResult<T> {
  items: T[];
  total: number | null;
}
function list<T>(body: { data: T[]; page?: { total: number } }): ListResult<T> {
  return { items: body.data ?? [], total: body.page?.total ?? null };
}

// ───────────────────────── team / collections ─────────────────────────

export type { CollectionState, CreateCollectionRequest, UpdateCollectionRequest };

type LibraryResources = { activities: ActivityDto; collections: CollectionDto; scenes: SceneSummaryDto };

export function getTeamLibraryPage<K extends keyof LibraryResources>(
  organizationId: string, resource: K, query: LibraryListQuery & { limit: number; offset: number }, signal: AbortSignal,
) {
  return get<LibraryPage<LibraryResources[K]>>(`/api/organizations/${id(organizationId)}/${resource}`, query, signal);
}

/**
 * Team-scoped content. Assets and scenes belong to the team (organization);
 * creating them never needs a collection.
 */
export const organizationApi = {
  assets: (organizationId: string, query: AssetListQuery, signal?: AbortSignal) =>
    get<ApiPage<AssetDto>>(`/api/organizations/${id(organizationId)}/assets`, query as Query, signal),
  createAsset: (organizationId: string, request: CreateOrganizationAssetRequest) =>
    send<Data<CreateAssetResult>>("POST", `/api/organizations/${id(organizationId)}/assets`, request).then((body) => body.data),
  scenes: (organizationId: string, query?: { state?: "active" | "archived" | "all" }, signal?: AbortSignal) =>
    get<{ data: SceneSummaryDto[]; page?: { total: number } }>(`/api/organizations/${id(organizationId)}/scenes`, query, signal).then(list),
  createScene: (organizationId: string, request: CreateSceneRequest) =>
    send<Data<SceneDetailDto>>("POST", `/api/organizations/${id(organizationId)}/scenes`, request).then((body) => body.data),
  placements: (organizationId: string, signal?: AbortSignal) =>
    get<Data<PlacementDto[]>>(`/api/organizations/${id(organizationId)}/placements`, undefined, signal).then((body) => body.data ?? []),
  /** Map collection catalog. */
  collections: (organizationId: string, query?: { state?: CollectionState }, signal?: AbortSignal) =>
    get<Data<CollectionDto[]>>(`/api/organizations/${id(organizationId)}/collections`, query, signal).then((body) => body.data ?? []),
  createCollection: (organizationId: string, request: CreateCollectionRequest) =>
    send<Data<CollectionDto>>("POST", `/api/organizations/${id(organizationId)}/collections`, request).then((body) => body.data),
};

export const collectionApi = {
  get: (collectionId: string, signal?: AbortSignal) =>
    get<Data<CollectionDto>>(`/api/collections/${id(collectionId)}`, undefined, signal).then((body) => body.data),
  update: (collectionId: string, request: UpdateCollectionRequest) =>
    send<Data<CollectionDto>>("PATCH", `/api/collections/${id(collectionId)}`, request).then((body) => body.data),
  archive: (collectionId: string) => send<Data<CollectionDto>>("POST", `/api/collections/${id(collectionId)}/archive`).then((body) => body.data),
  restore: (collectionId: string) => send<Data<CollectionDto>>("DELETE", `/api/collections/${id(collectionId)}/archive`).then((body) => body.data),
  assets: (collectionId: string, query: AssetListQuery, signal?: AbortSignal) =>
    get<ApiPage<AssetDto>>(`/api/collections/${id(collectionId)}/assets`, query as Query, signal),
  placements: (collectionId: string, query?: { status?: PlacementStatus }, signal?: AbortSignal) =>
    get<Data<PlacementDto[]>>(`/api/collections/${id(collectionId)}/placements`, query, signal).then((body) => body.data),
  createPlacement: (collectionId: string, request: CreatePlacementRequest) =>
    send<Data<CreatePlacementResult>>("POST", `/api/collections/${id(collectionId)}/placements`, request).then((body) => body.data),
};

// ───────────────────────── assets ─────────────────────────

export const assetApi = {
  get: (assetId: string, signal?: AbortSignal) => get<Data<AssetDetailDto>>(`/api/assets/${id(assetId)}`, undefined, signal).then((body) => body.data),
  update: (assetId: string, request: UpdateAssetRequest) => send<Data<AssetDto>>("PATCH", `/api/assets/${id(assetId)}`, request).then((body) => body.data),
  archive: (assetId: string, expectedLockVersion: number) =>
    send<Data<ArchiveAssetResult>>("DELETE", `/api/assets/${id(assetId)}`, undefined, { expectedLockVersion }).then((body) => body.data),
  usage: (assetId: string, signal?: AbortSignal) => get<Data<AssetUsageDto>>(`/api/assets/${id(assetId)}/usage`, undefined, signal).then((body) => body.data),
  /** Same-team copy when `targetWorkspaceId` is omitted. */
  duplicate: (assetId: string, request: DuplicateAssetRequest) =>
    send<Data<CreateAssetResult>>("POST", `/api/assets/${id(assetId)}/duplicate`, request).then((body) => body.data),
};

// ───────────────────────── scenes ─────────────────────────

export const sceneApi = {
  get: (sceneId: string, signal?: AbortSignal) => get<Data<SceneDetailDto>>(`/api/scenes/${id(sceneId)}`, undefined, signal).then((body) => body.data),
  save: (sceneId: string, request: SaveSceneRequest) => send<Data<SceneDetailDto>>("PATCH", `/api/scenes/${id(sceneId)}`, request).then((body) => body.data),
  /** Same-team copy when `targetWorkspaceId` is omitted. */
  copy: (sceneId: string, request: CopySceneRequest) => send<Data<SceneDetailDto>>("POST", `/api/scenes/${id(sceneId)}/copy`, request).then((body) => body.data),
};

// ───────────────────────── placements ─────────────────────────

export const placementApi = {
  content: (placementId: string, workspaceId?: string | null, signal?: AbortSignal) =>
    get<Data<PlacementContentDto>>(`/api/placements/${id(placementId)}/content`, { workspace_id: workspaceId }, signal).then((body) => body.data),
  update: (placementId: string, request: UpdatePlacementRequest) =>
    send<Data<PlacementDto>>("PATCH", `/api/placements/${id(placementId)}`, request).then((body) => body.data),
  archive: (placementId: string, expectedLockVersion: number) =>
    send<Data<PlacementDto>>("DELETE", `/api/placements/${id(placementId)}`, undefined, { expectedLockVersion }).then((body) => body.data),
  move: (request: MovePlacementsRequest) => send<Data<PlacementDto[]>>("POST", "/api/placements/move", request).then((body) => body.data ?? []),
  copy: (placementId: string, request: CopyPlacementRequest) =>
    send<Data<CreatePlacementResult>>("POST", `/api/placements/${id(placementId)}/copy`, request).then((body) => body.data),
};

// ───────────────────────── uploads ─────────────────────────

/** Where an upload lands: always the team; a collection only for map/onsite placement. */
export interface UploadScope {
  organizationId: string;
  /** Collection (workspace UUID) of an upload-and-place command; omitted for team content. */
  workspaceId?: string | null;
}

/**
 * Upload one original file for server processing and return its receipt. The receipt (not
 * the URL) is what asset and placement commands accept.
 */
export async function uploadReceipt(
  file: File,
  options: UploadScope & { type: string; purpose?: UploadPurpose; signal?: AbortSignal; onStage?: UploadStageListener },
): Promise<UploadReceiptDto> {
  const form = new FormData();
  form.set("file", file, file.name);
  form.set("type", options.type);
  form.set("organization_id", options.organizationId);
  if (options.workspaceId) form.set("workspace_id", options.workspaceId);
  form.set("purpose", options.purpose ?? "asset");
  options.onStage?.("uploading");
  let response: Response;
  try {
    response = await fetch("/api/upload", {
      method: "POST",
      body: form,
      headers: { Accept: UPLOAD_STREAM_CONTENT_TYPE },
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ContentApiError(error instanceof Error ? error.message : "Network error", 0, null);
  }
  let body: UploadResponse | undefined;
  if (response.ok && response.headers.get("content-type")?.includes(UPLOAD_STREAM_CONTENT_TYPE)) {
    if (!response.body) throw new ContentApiError("Upload response missing", 502, null);
    for await (const event of readUploadEvents(response.body)) {
      if (event.event === "stage") options.onStage?.(event.stage);
      else if (event.event === "error") {
        if (!isApiErrorBody(event.body)) throw new ContentApiError("Invalid upload error", 502, null);
        throw new ContentApiError(event.body.error, event.status, event.body.code, event.body.details);
      } else { body = event.response; break; }
    }
  } else body = await parse<UploadResponse>(response);

  if (!body?.data) throw new ContentApiError("Upload receipt missing", 502, "RECEIPT_INVALID");
  return body.data;
}

/** One key per user intent; reuse it for retries of the same intent. */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}
