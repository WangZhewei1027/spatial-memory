/** Attaching and detaching recognition-target content; pure request building, no network. */
import assert from "node:assert/strict";
import test from "node:test";
import type { PlacementDto } from "../lib/content-model/contracts";
import { anchorChangeRequest } from "../app/manage/components/placements/placement-utils";

const anchorId = "10180000-0000-4000-8000-000000000001";
const placement = (patch: Partial<PlacementDto>) =>
  ({ id: "p", lock_version: 7, status: "active", location: null, anchor_id: anchorId, ...patch }) as PlacementDto;
const location = { longitude: 121.48, latitude: 31.27, altitude: null } as unknown as PlacementDto["location"];

test("detaching the last discovery path of an active placement makes it a draft", () => {
  const result = anchorChangeRequest(placement({}), null);
  assert.deepEqual(result.request, { expectedLockVersion: 7, anchorId: null, status: "draft" });
  assert.equal(result.draftedOnDetach, true);
});

test("detaching keeps the status when GPS still makes the placement discoverable or it is not active", () => {
  for (const patch of [{ location }, { status: "paused" as const }, { status: "draft" as const }]) {
    const result = anchorChangeRequest(placement(patch), null);
    assert.deepEqual(result.request, { expectedLockVersion: 7, anchorId: null });
    assert.equal(result.draftedOnDetach, false);
  }
});

test("attaching never changes the placement status", () => {
  const result = anchorChangeRequest(placement({ anchor_id: null }), anchorId);
  assert.deepEqual(result.request, { expectedLockVersion: 7, anchorId });
  assert.equal(result.draftedOnDetach, false);
});
