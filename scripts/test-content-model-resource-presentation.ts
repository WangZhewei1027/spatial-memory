/** Reference-image anchors must remain visible in the v2 management panels. */
import assert from "node:assert/strict";
import type { AssetContentDto, AssetResourceDto, PlacementAssetContentDto, PlacementSceneContentDto } from "../lib/content-model/contracts";
import { isFileMissing, primaryResource, thumbnailOf } from "../app/manage/lib/content-mappers";
import { placementThumbnailOf } from "../app/manage/components/placements/placement-utils";

const resource = (role: AssetResourceDto["role"]): AssetResourceDto => ({
  role, ordinal: 0, storage_key: null, external_url: `https://fixture.invalid/${role}.jpg`,
  url: `https://fixture.invalid/${role}.jpg`, managed: false,
  content_hash: null, mime_type: "image/jpeg", size_bytes: 100,
});
const version: AssetContentDto = {
  id: "10170000-0000-4000-8000-000000000001",
  organization_id: "10170000-0000-4000-8000-000000000003",
  file_type: "anchor", lock_version: 1, payload: { kind: "anchor" },
  resources: [resource("reference")], updated_at: "2026-10-17T00:00:00Z",
};
assert.equal(primaryResource(version)?.url, "https://fixture.invalid/reference.jpg");
assert.equal(isFileMissing(version), false);
assert.equal(primaryResource({ ...version, resources: [] }), null, "historical spatial anchors have no invented image");
assert.equal(primaryResource({ ...version, resources: [...version.resources, resource("primary")] })?.role, "primary");
assert.equal(thumbnailOf({ ...version, payload: { kind: "image" }, resources: [resource("primary"), resource("thumbnail")] }), "https://fixture.invalid/thumbnail.jpg");
assert.equal(primaryResource(null), null);
const placed: PlacementAssetContentDto = { kind: "asset", placement_id: "placement", public_id: "placement", asset_id: version.id, asset_lock_version: 1, file_type: "model", payload: { kind: "model" }, resources: [resource("primary"), resource("thumbnail")] };
assert.equal(placementThumbnailOf(placed), "https://fixture.invalid/thumbnail.jpg");
assert.equal(placementThumbnailOf({ ...placed, resources: [resource("primary")] }), null, "model files are never mistaken for an image");
assert.equal(placementThumbnailOf({ ...placed, payload: { kind: "video" }, file_type: "video" }), "https://fixture.invalid/thumbnail.jpg");
assert.equal(thumbnailOf(version), "https://fixture.invalid/reference.jpg");
const scene: PlacementSceneContentDto = { kind: "scene", placement_id: "placement", public_id: "placement", scene_id: "scene", name: "Scene", document: { schemaVersion: 6, content: { kind: "composition", units: "meters", durationSeconds: 10, loop: false, assets: {}, instances: [] } }, resources: [{ resource_alias: "model", asset_id: version.id, file_type: "model", url: "https://fixture.invalid/model.glb", animations: [] }] };
assert.equal(placementThumbnailOf(scene), null);
assert.equal(placementThumbnailOf({ ...scene, resources: [{ ...scene.resources[0], thumbnail_url: "https://fixture.invalid/scene.png" }] }), "https://fixture.invalid/scene.png");
assert.equal(placementThumbnailOf({ ...scene, resources: [{ ...scene.resources[0], file_type: "image", url: "https://fixture.invalid/image.png" }] }), "https://fixture.invalid/image.png");
console.log("PASS reference-image anchors, missing historical references and primary/thumbnail precedence");
