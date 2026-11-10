/** Opaque team metadata; mini-program display settings belong to each map. */
export type OrgConfig = Record<string, unknown>;

/** 组织设置表单需要的最小组织形状（super-admin 的 OrgData 和 /admin 拉取的行都满足） */
export interface OrgSettingsSource {
  name: string;
  description: string | null;
  map_center: { lat: number; lng: number } | null;
  allowed_file_types: string[] | null;
  config?: OrgConfig | null;
}

/** 保存时提交的完整设置载荷 */
export interface OrgSettingsPayload {
  name: string;
  description: string | null;
  map_center: { lat: number; lng: number } | null;
  allowed_file_types: string[] | null;
}

/** 由调用方决定落库方式：super-admin 走 server action，/admin 走 PUT API */
export type SaveOrgSettings = (
  payload: OrgSettingsPayload,
) => Promise<{ error?: string }>;
