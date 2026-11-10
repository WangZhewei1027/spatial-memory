/**
 * DTO → presentation mapping for app/manage/content components. The content
 * layer renders props, never endpoint DTOs; everything that crosses that
 * boundary goes through here.
 */
import type {
  AssetDetailData,
  AssetUsageKind,
  AssetUsageSummary,
  CollectionItem,
  ContentAssetType,
  ContentPerson,
  WorkbenchItem,
} from "@/app/manage/content/types";
import type {
  AssetDetailDto,
  AssetDto,
  AssetContentDto,
  CollectionDto,
  DependencyImpact,
  SceneSummaryDto,
  UserRefDto,
} from "@/lib/content-model/contracts";
import { collectionHref, teamHref } from "./content-context";

const CONTENT_TYPES: readonly ContentAssetType[] = ["image", "video", "audio", "model", "text", "link", "document"];

/** Anchors are maintained from the collection map; the generic library contains media content. */
export function isLibraryAsset(asset: Pick<AssetDto, "file_type">) {
  return (CONTENT_TYPES as readonly string[]).includes(asset.file_type);
}

export function contentType(fileType: string): ContentAssetType {
  if (fileType === "anchor") return "anchor";
  return (CONTENT_TYPES as readonly string[]).includes(fileType) ? (fileType as ContentAssetType) : "document";
}

export function personOf(user: UserRefDto | null | undefined): ContentPerson | null {
  if (!user) return null;
  return { id: user.user_id, name: user.name || user.email || user.user_id.slice(0, 8) };
}

export function primaryResource(content: AssetContentDto | null | undefined) {
  return content?.resources.find((resource) => resource.role === "primary")
    ?? content?.resources.find((resource) => resource.role === "reference")
    ?? null;
}

export function thumbnailOf(content: AssetContentDto | null | undefined): string | null {
  if (!content) return null;
  const thumbnail = content.resources.find((resource) => resource.role === "thumbnail");
  if (thumbnail) return thumbnail.url;
  const primary = primaryResource(content);
  return primary && content.payload.kind === "image" ? primary.url : null;
}

export function excerptOf(content: AssetContentDto | null | undefined): string | null {
  const payload = content?.payload;
  if (!payload) return null;
  if (payload.kind === "text") return payload.text.slice(0, 140);
  if (payload.kind === "link") return payload.title || payload.url;
  return null;
}

/** File-backed kinds must carry a primary resource; a missing one is a repair case. */
export function isFileMissing(asset: AssetContentDto) {
  if (asset.file_type === "text" || asset.file_type === "link") return false;
  return !primaryResource(asset);
}

export function toWorkbenchAsset(asset: AssetDto, people?: ReadonlyMap<string, ContentPerson>): WorkbenchItem {
  return {
    id: asset.id,
    kind: "asset",
    name: asset.name || asset.id.slice(0, 8),
    type: contentType(asset.file_type),
    thumbnailUrl: thumbnailOf(asset),
    textExcerpt: excerptOf(asset),
    state: asset.state,
    updatedAt: asset.updated_at,
    updatedBy: asset.created_by ? people?.get(asset.created_by) ?? null : null,
    fileMissing: isFileMissing(asset),
  };
}

export function toDetailData(asset: AssetDetailDto): AssetDetailData {
  return {
    id: asset.id,
    name: asset.name || asset.id.slice(0, 8),
    type: contentType(asset.file_type),
    thumbnailUrl: thumbnailOf(asset),
    textExcerpt: excerptOf(asset),
    state: asset.state,
    origin: asset.origin,
    maintainer: personOf(asset.maintainer),
    updatedAt: asset.updated_at,
    fileMissing: isFileMissing(asset),
    createdAt: asset.create_at ?? asset.updated_at,
  };
}

export function usageByKind(impact: DependencyImpact | null | undefined): Record<AssetUsageKind, number> {
  return { scene: impact?.scenes ?? 0, placement: impact?.placements ?? 0, activity: impact?.activities ?? 0 };
}

/** Collection name of a dependency; scenes belong to the team and may report none. */
function collectionNameOf(item: { workspace_name?: string | null }) {
  return item.workspace_name || null;
}

/** Dependency rows (optionally narrowed to one content) plus any count-only remainder. */
export function toUsageSummary(impact: DependencyImpact | null | undefined, organizationId: string): AssetUsageSummary {
  if (!impact) return { entries: [], totalCount: 0, restrictedCount: 0 };
  const items = impact.items;
  const entries = items.map((item, index) => {
    if (item.kind === "activity") {
      return {
        id: `activity:${item.activity_id}:${item.point_id}:${index}`,
        kind: "activity" as const,
        targetName: `${item.activity_name} · ${item.point_name}`,
        href: teamHref(`/manage/activities/${item.activity_id}`, organizationId),
      };
    }
    if (item.kind === "placement") {
      return {
        id: `placement:${item.placement_id}:${index}`,
        kind: "placement" as const,
        collectionName: collectionNameOf(item),
        targetName: item.placement_name ?? item.placement_id.slice(0, 8),
        placementStatus: item.status,
        href: item.workspace_id ? collectionHref(item.workspace_id, organizationId, { placementId: item.placement_id }) : undefined,
      };
    }
    return {
      id: `${item.kind}:${item.scene_id}:${item.resource_alias}:${index}`,
      kind: "scene" as const,
      targetName: item.scene_name,
      href: teamHref(`/manage/scenes/${item.scene_id}`, organizationId),
    };
  });
  const total = impact.scenes + impact.placements + (impact.activities ?? 0);
  return {
    entries,
    totalCount: total,
    restrictedCount: impact.restricted_count,
  };
}

export function toWorkbenchScene(scene: SceneSummaryDto, people: ReadonlyMap<string, ContentPerson>): WorkbenchItem {
  return {
    id: scene.id,
    kind: "scene",
    name: scene.name,
    type: "scene",
    state: scene.state,
    placementCount: scene.placement_count,
    // SceneSummaryDto has no active/paused split: leave the active count unknown instead of guessing.
    updatedAt: scene.updated_at,
    updatedBy: scene.updated_by ? people.get(scene.updated_by) ?? null : null,
  };
}

export function toCollectionItem(collection: CollectionDto): CollectionItem {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    createdAt: collection.create_date,
    archived: !!collection.archived_at,
    canEdit: !!collection.capabilities?.can_edit,
    canArchive: !!collection.capabilities?.can_archive,
  };
}
