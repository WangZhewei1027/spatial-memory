/** Client-safe activity authoring contracts. Requests use camelCase, DTOs snake_case. */
export type ActivityType = "shop_checkin" | "danmaku";
export type ActivityState = "active" | "archived";
/** Archived placements retain history after unlinking; linked activities are active or paused. */
export type ActivityPlacementStatus = "active" | "paused" | "archived";
export interface ActivityLocation { longitude: number; latitude: number }
export interface ActivityConfig { checkinRadiusMeters?: number; maxLength?: number }
export interface ActivityCapabilities { can_read: boolean; can_edit: boolean }
export interface ActivityPointInput {
  id?: string;
  name: string;
  description?: string | null;
  ordinal?: number;
  imageAssetId?: string | null;
  rewardAssetId?: string | null;
  location?: ActivityLocation | null;
  state?: ActivityState;
}
export interface ActivityPointDto {
  id: string; activity_id: string; name: string; description: string | null; ordinal: number;
  image_asset_id: string | null; reward_asset_id: string | null;
  image_url: string | null; reward_url: string | null; location: ActivityLocation | null; state: ActivityState;
}
export interface ActivityDto {
  id: string; organization_id: string; type: ActivityType; name: string; description: string | null;
  config: ActivityConfig; location: ActivityLocation | null; radius_meters: number | null;
  state: ActivityState; lock_version: number; created_at: string; updated_at: string;
  has_map_link: boolean;
  capabilities: ActivityCapabilities; points: ActivityPointDto[];
}
export interface ActivityPlacementDto {
  id: string; activity_id: string; organization_id: string; workspace_id: string;
  activity_name: string; activity_type: ActivityType; workspace_name: string;
  status: ActivityPlacementStatus; lock_version: number; capabilities: ActivityCapabilities;
  created_at: string; updated_at: string;
}
export interface ActivityRecordDto {
  id: string; activity_id: string; placement_id: string; point_id: string | null; participant_id: string | null;
  kind: "danmaku" | "checkin"; content: string | null; status: "visible" | "hidden";
  location: ActivityLocation | null; created_at: string; lock_version: number; capabilities: ActivityCapabilities;
}
export interface PublicActivityDto {
  workspace_id: string; workspace_name: string;
  id: string; activity_id: string; type: ActivityType; name: string; config: ActivityConfig;
  location: ActivityLocation | null; radius_meters: number | null;
  points: { id: string; point_id: string; name: string; description: string | null;
    image_url: string | null; reward_url: string | null; latitude: number | null; longitude: number | null }[];
}
