import type { AssetDetailDto, AssetResourceDto, ResourceInput } from "@/lib/content-model/contracts";

/** Reference images in ordinal order; legacy anchors stored theirs as `primary`. */
export function referenceImagesOf(asset: Pick<AssetDetailDto, "resources">): AssetResourceDto[] {
  const byOrdinal = (a: AssetResourceDto, b: AssetResourceDto) => a.ordinal - b.ordinal;
  const references = asset.resources.filter((resource) => resource.role === "reference").sort(byOrdinal);
  return references.length ? references : asset.resources.filter((resource) => resource.role === "primary" && resource.ordinal === 0);
}

/** Kept images reference their current files; new ones follow as uploads, renumbered from 0. */
export function referenceResources(asset: Pick<AssetDetailDto, "id">, keep: readonly AssetResourceDto[], uploads: readonly string[]): ResourceInput[] {
  const kept: ResourceInput[] = keep.map((resource, ordinal) => ({ role: "reference", ordinal, fromAssetId: asset.id, fromRole: resource.role, fromOrdinal: resource.ordinal }));
  return [...kept, ...uploads.map((receiptId, index): ResourceInput => ({ role: "reference", ordinal: kept.length + index, receiptId }))];
}
