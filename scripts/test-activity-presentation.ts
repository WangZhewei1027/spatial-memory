import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityDto, ActivityPlacementDto } from "../lib/activities/contracts";
import { toActivityViewerItems } from "../app/manage/lib/placement-to-viewer";
import { toUsageSummary, usageByKind } from "../app/manage/lib/content-mappers";

function placement(id: string, workspaceId: string): ActivityPlacementDto {
  return {
    id, activity_id: "shared-activity", organization_id: "team", workspace_id: workspaceId,
    activity_name: "A walking activity", activity_type: "shop_checkin", workspace_name: workspaceId,
    status: "active", lock_version: 1,
    capabilities: { can_read: true, can_edit: true },
    created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z",
  };
}

function activity(): ActivityDto {
  return {
    id: "shared-activity", organization_id: "team", name: "A walking activity", type: "shop_checkin",
    description: null, config: {}, state: "active", has_map_link: true, lock_version: 1, location: null, radius_meters: null,
    capabilities: { can_read: true, can_edit: true }, created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z",
    points: [{ id: "shared-point", activity_id: "shared-activity", name: "First stop", description: null, ordinal: 0,
      image_asset_id: null, reward_asset_id: null, image_url: null, reward_url: null, state: "active", location: { longitude: 121, latitude: 31 } }],
  };
}

test("switching maps retains the point identity and omits the old association marker", () => {
  const first = { ...placement("first", "map-a"), status: "archived" as const }, second = placement("second", "map-b");
  const definition = { ...activity(), has_map_link: true };
  const [marker] = toActivityViewerItems([first, second], [definition]);
  assert.equal(marker.id, "second:shared-point");
  assert.equal(marker.activityPlacementId, "second");
  assert.equal(marker.workspace_id, "map-b");
  assert.equal(marker.sourceAssetId, null, "an activity marker must not select or mutate a source asset");
  assert.equal(marker.sceneId, null);
  assert.deepEqual(marker.metadata, { longitude: 121, latitude: 31, height: 0 });
  definition.points[0].location = { longitude: 122, latitude: 32 };
  const updated = toActivityViewerItems([first, second], [definition]);
  assert.equal(updated.length, 1);
  assert.deepEqual(updated[0].metadata, { longitude: 122, latitude: 32, height: 0 });
});

test("map markers omit archived associations, archived points and points without coordinates", () => {
  const row = placement("first", "map-a");
  const definition = activity(), original = definition.points[0];
  definition.points.push({ ...original, id: "archived-point", state: "archived" }, { ...original, id: "directory", location: null });
  assert.equal(toActivityViewerItems([row, { ...row, id: "archived", status: "archived" }], [definition]).length, 1);
  assert.equal(toActivityViewerItems([{ ...row, status: "paused" }], [definition]).length, 1, "paused associations still show the activity's fixed locations in Manage");
  assert.deepEqual(toActivityViewerItems([row], [{ ...definition, state: "archived" }]), []);
  assert.deepEqual(toActivityViewerItems([row], []), [], "missing definitions cannot invent a location");
});

test("map-wide messages need no invented coordinate; scoped messages use their placement identity", () => {
  const row = { ...placement("messages", "map-a"), activity_type: "danmaku" as const };
  const definition = { ...activity(), type: "danmaku" as const, points: [] };
  assert.deepEqual(toActivityViewerItems([row], [definition]), []);
  const [marker] = toActivityViewerItems([row], [{ ...definition, location: { longitude: 0, latitude: 0 }, radius_meters: 100 }]);
  assert.equal(marker.id, "messages");
  assert.equal(marker.activityPlacementId, "messages");
  assert.deepEqual(marker.metadata, { longitude: 0, latitude: 0, height: 0 });
});

test("asset usage includes activity point references and links to the independent activity", () => {
  const impact = { scenes: 0, placements: 0, activities: 1, restricted_count: 0, items: [{ kind: "activity" as const, activity_id: "activity-a", activity_name: "Trail", point_id: "point-a", point_name: "Stop" }] };
  const usage = toUsageSummary(impact, "team-a");
  assert.equal(usage.totalCount, 1);
  assert.equal(usage.entries[0].kind, "activity");
  assert.equal(usage.entries[0].href, "/manage/activities/activity-a?organizationId=team-a");
  assert.deepEqual(usageByKind(impact), { scene: 0, placement: 0, activity: 1 });
});
