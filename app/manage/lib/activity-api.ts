import type { ActivityConfig, ActivityDto, ActivityLocation, ActivityPlacementDto, ActivityPlacementStatus, ActivityPointInput, ActivityRecordDto, ActivityType } from "@/lib/activities/contracts";
import { contentRequest } from "./content-api";

type Data<T> = { data: T };
export interface ActivityInput { name: string; description?: string | null; type: ActivityType; config?: ActivityConfig; location?: ActivityLocation | null; radiusMeters?: number | null; workspaceId?: string; idempotencyKey: string }
export interface ActivityUpdate { expectedLockVersion: number; name?: string; description?: string | null; config?: ActivityConfig; location?: ActivityLocation | null; radiusMeters?: number | null; state?: "active" | "archived"; points?: ActivityPointInput[] }
export interface ActivityPlacementInput {
  workspaceId: string;
  status: "active" | "paused";
  idempotencyKey: string;
}
export type ActivityPlacementUpdate = { status: ActivityPlacementStatus; expectedLockVersion: number };
const id = encodeURIComponent;
export const activityApi = {
  list: (organizationId: string, signal?: AbortSignal) => contentRequest<Data<ActivityDto[]>>(`/api/organizations/${id(organizationId)}/activities`, { signal }).then((body) => body.data),
  create: (organizationId: string, body: ActivityInput) => contentRequest<Data<ActivityDto>>(`/api/organizations/${id(organizationId)}/activities`, { method: "POST", body }).then((result) => result.data),
  get: (activityId: string, signal?: AbortSignal) => contentRequest<Data<ActivityDto>>(`/api/activities/${id(activityId)}`, { signal }).then((result) => result.data),
  update: (activityId: string, body: ActivityUpdate) => contentRequest<Data<ActivityDto>>(`/api/activities/${id(activityId)}`, { method: "PATCH", body }).then((result) => result.data),
  placements: (activityId: string, signal?: AbortSignal) => contentRequest<Data<ActivityPlacementDto[]>>(`/api/activities/${id(activityId)}/placements`, { signal }).then((result) => result.data),
  collectionPlacements: (workspaceId: string, signal?: AbortSignal) => contentRequest<Data<ActivityPlacementDto[]>>(`/api/collections/${id(workspaceId)}/activity-placements`, { signal }).then((result) => result.data),
  place: (activityId: string, body: ActivityPlacementInput) => contentRequest<Data<ActivityPlacementDto>>(`/api/activities/${id(activityId)}/placements`, { method: "POST", body }).then((result) => result.data),
  updatePlacement: (placementId: string, body: ActivityPlacementUpdate) => contentRequest<Data<ActivityPlacementDto>>(`/api/activity-placements/${id(placementId)}`, { method: "PATCH", body }).then((result) => result.data),
  records: (activityId: string, query: { placementId?: string; limit: number; offset: number }, signal?: AbortSignal) => contentRequest<{ data: ActivityRecordDto[]; page: { total: number; limit: number; offset: number } }>(`/api/activities/${id(activityId)}/records`, { query, signal }),
  moderate: (record: ActivityRecordDto, status: "visible" | "hidden") => contentRequest<Data<ActivityRecordDto>>(`/api/activity-records/${id(record.id)}`, { method: "PATCH", body: { expectedLockVersion: record.lock_version, status } }).then((result) => result.data),
};
