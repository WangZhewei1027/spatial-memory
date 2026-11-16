/** Super-administrator copies always create an independent graph in the destination team. */
export const DUPLICATE_CONTENT_SOURCE_TYPES = ["asset", "scene", "activity", "collection", "placement"] as const;
export type DuplicateContentSourceType = typeof DUPLICATE_CONTENT_SOURCE_TYPES[number];

export interface DuplicateContentRequest {
  sourceType: DuplicateContentSourceType;
  sourceId: string;
  targetOrganizationId: string;
  /** Required for placements; optional origin collection for assets and scenes. */
  targetWorkspaceId?: string;
  name?: string;
  idempotencyKey: string;
}

export interface DuplicateContentResult {
  id: string;
  sourceType: DuplicateContentSourceType;
  organizationId: string;
  created: boolean;
}
