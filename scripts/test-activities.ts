/** Real activity service and HTTP behavior, isolated PostGIS only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { assertServicesDatabase, cleanupServicesFixture, fixtureIds, seedServicesFixture } from "./test-content-model-services-fixture";
import { installRouteStubs } from "./test-support/install-route-stubs";
import type * as AuthStub from "./test-support/stub-auth-server";
import type { Submission } from "../lib/activities/runtime.server";

async function main() {
  assertServicesDatabase();
  await installRouteStubs();
  const auth = await import("../lib/auth/server") as unknown as typeof AuthStub;
  const { db } = await import("../lib/db");
  const { loadActor } = await import("../lib/content-model/access.server");
  const { ContentError } = await import("../lib/content-model/errors");
  const service = await import("../lib/activities/service.server");
  const runtime = await import("../lib/activities/runtime.server");
  const assets = await import("../lib/assets/service.server");
  const ordinary = await import("../lib/placements/runtime.server");
  const retention = await import("../lib/storage/retention.server");
  const listRoute = await import("../app/api/organizations/[id]/activities/route");
  const recordRoute = await import("../app/api/miniapp/activity-records/route");
  const detailRoute = await import("../app/api/activities/[id]/route");
  const linkRoute = await import("../app/api/activities/[id]/placements/route");
  const placementRoute = await import("../app/api/activity-placements/[id]/route");
  const orgRoute = await import("../app/api/organizations/[id]/route");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const f = fixtureIds();
  let checks = 0;
  const reject = (work: () => Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) => error instanceof ContentError && error.code === code);
  try {
    await seedServicesFixture(client, f);
    const [editor, viewer, foreign] = await Promise.all([f.users.editor, f.users.viewer, f.users.foreign].map((id) => loadActor(db, id)));
    const owner = await loadActor(db, f.users.owner);
    const standalone = await service.createActivity(owner, f.organizations.solo, { name: "No map needed", type: "danmaku" });
    assert.equal(standalone.config.maxLength, 50, "new danmaku activities default to 50 characters");
    assert.equal(standalone.points.length, 0);
    auth.setStubSessionUser({ id: f.users.owner, email: null, name: null, emailVerified: false });
    const deleteOrg = await orgRoute.DELETE(new Request("http://test/api/organizations/x", { method: "DELETE" }), { params: Promise.resolve({ id: f.organizations.solo }) });
    assert.equal(deleteOrg.status, 409);
    assert.equal((await deleteOrg.json()).details.counts.activities, 1);
    const create = { name: "Multi-point check-in", type: "shop_checkin", idempotencyKey: randomUUID() };
    let activity = await service.createActivity(editor, f.organizations.team, create);
    assert.equal((await service.createActivity(editor, f.organizations.team, create)).id, activity.id);
    await reject(() => service.createActivity(editor, f.organizations.team, { ...create, name: "Changed retry" }), "IDEMPOTENCY_CONFLICT");
    await reject(() => service.createActivity(viewer, f.organizations.team, create), "FORBIDDEN");
    await reject(() => service.getActivity(foreign, activity.id), "NOT_FOUND");
    assert.equal((await service.getActivity(viewer, activity.id)).capabilities.can_edit, false);
    checks++;

    const createLinked = { name: "Create and link together", type: "danmaku", workspaceId: f.workspaces.empty, idempotencyKey: randomUUID() };
    const linked = await Promise.all([1, 2].map(() => service.createActivity(editor, f.organizations.team, createLinked)));
    assert.equal(linked[0].id, linked[1].id, "concurrent retries create one activity");
    assert.equal(linked[0].has_map_link, true);
    const initialLinks = await service.listActivityPlacements(editor, linked[0].id);
    assert.equal(initialLinks.length, 1);
    assert.equal(initialLinks[0].workspace_id, f.workspaces.empty);
    assert.equal(initialLinks[0].status, "paused");
    await reject(() => service.createActivity(editor, f.organizations.team, { ...createLinked, workspaceId: f.workspaces.a }), "IDEMPOTENCY_CONFLICT");
    const activityCount = async () => (await client.query("select count(*) from activity")).rows[0].count;
    const beforeDeniedCreate = await activityCount();
    await reject(() => service.createActivity(viewer, f.organizations.team, { ...createLinked, idempotencyKey: randomUUID() }), "FORBIDDEN");
    await reject(() => service.createActivity(editor, f.organizations.team, { ...createLinked, workspaceId: f.workspaces.foreign, idempotencyKey: randomUUID() }), "NOT_FOUND");
    await reject(() => service.createActivity(owner, f.organizations.solo, createLinked), "NOT_FOUND");
    await client.query("update workspace set archived_at=now() where id=$1", [f.workspaces.empty]);
    await reject(() => service.createActivity(editor, f.organizations.team, { ...createLinked, idempotencyKey: randomUUID() }), "ARCHIVED");
    await client.query("update workspace set archived_at=null where id=$1", [f.workspaces.empty]);
    assert.equal(await activityCount(), beforeDeniedCreate, "invalid associations must not leave an unlinked activity");
    await service.updateActivityPlacement(editor, initialLinks[0].id, { expectedLockVersion: initialLinks[0].lock_version, status: "archived" });
    assert.equal((await service.createActivity(editor, f.organizations.team, createLinked)).has_map_link, false, "retrying creation must not restore a later unlinked activity");
    checks++;

    const racing = await service.createActivity(editor, f.organizations.team, { name: "Concurrent map association", type: "danmaku" });
    await reject(() => service.createActivityPlacement(viewer, racing.id, { workspaceId: f.workspaces.a }), "FORBIDDEN");
    await client.query("update workspace set archived_at=now() where id=$1", [f.workspaces.empty]);
    await reject(() => service.createActivityPlacement(editor, racing.id, { workspaceId: f.workspaces.empty }), "ARCHIVED");
    await client.query("update workspace set archived_at=null where id=$1", [f.workspaces.empty]);
    await reject(() => service.createActivityPlacement(editor, racing.id, { workspaceId: f.workspaces.a, status: "archived" }), "VALIDATION_FAILED");
    const race = await Promise.allSettled([f.workspaces.a, f.workspaces.b].map((workspaceId) =>
      service.createActivityPlacement(editor, racing.id, { workspaceId })));
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    const lost = race.find((result) => result.status === "rejected");
    assert.ok(lost?.status === "rejected" && lost.reason instanceof ContentError && lost.reason.code === "DEPENDENCY_CONFLICT");
    const [won] = await service.listActivityPlacements(editor, racing.id);
    assert.equal(won.status, "paused", "new associations default to paused");
    const otherMap = won.workspace_id === f.workspaces.a ? f.workspaces.b : f.workspaces.a;
    await service.updateActivityPlacement(editor, won.id, { expectedLockVersion: won.lock_version, status: "archived" });
    const next = await service.createActivityPlacement(editor, racing.id, { workspaceId: otherMap });
    await service.updateActivityPlacement(editor, next.id, { expectedLockVersion: next.lock_version, status: "archived" });
    const restored = await Promise.allSettled([won, next].map((link) => service.updateActivityPlacement(editor, link.id, { expectedLockVersion: link.lock_version + 1, status: "active" })));
    assert.equal(restored.filter((result) => result.status === "fulfilled").length, 1, "restores on different maps also serialize");
    const restoreLost = restored.find((result) => result.status === "rejected");
    assert.ok(restoreLost?.status === "rejected" && restoreLost.reason instanceof ContentError && restoreLost.reason.code === "DEPENDENCY_CONFLICT");
    for (const link of await service.listActivityPlacements(editor, racing.id)) {
      if (link.status !== "archived") await service.updateActivityPlacement(editor, link.id, { expectedLockVersion: link.lock_version, status: "archived" });
    }
    checks++;

    const originalPosition = { longitude: 121.49, latitude: 31.19 };
    const position = { longitude: 121.5, latitude: 31.2 };
    await reject(() => service.updateActivity(editor, activity.id, { name: "missing lock" }), "LOCK_VERSION_REQUIRED");
    activity = await service.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, points: [
      { name: "First point", imageAssetId: f.assets.image, rewardAssetId: f.assets.image, location: originalPosition }, { name: "Second point", location: null },
    ] });
    const [first, second] = activity.points;
    assert.ok(first.image_url && first.reward_url);
    await reject(() => service.updateActivity(editor, activity.id, { expectedLockVersion: 1, name: "stale" }), "LOCK_VERSION_CONFLICT");
    await reject(() => service.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, points: [{ name: "foreign image", imageAssetId: f.assets.foreign }] }), "NOT_FOUND");
    await reject(() => service.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, points: [{ name: "wrong media", imageAssetId: f.assets.shared }] }), "VALIDATION_FAILED");
    const usage = await assets.getAssetUsage(editor, f.assets.image);
    assert.equal(usage.impact.activities, 1);
    checks++;

    const body = { workspaceId: f.workspaces.a, status: "active", idempotencyKey: randomUUID() };
    let placementA = await service.createActivityPlacement(editor, activity.id, body);
    assert.equal((await service.createActivityPlacement(editor, activity.id, body)).id, placementA.id);
    await reject(() => service.createActivityPlacement(editor, activity.id, { ...body, idempotencyKey: randomUUID() }), "DEPENDENCY_CONFLICT");
    await reject(() => service.createActivityPlacement(editor, activity.id, { workspaceId: f.workspaces.a, status: "active" }), "DEPENDENCY_CONFLICT");
    placementA = await service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "archived" });
    const archivedReplay = await service.createActivityPlacement(editor, activity.id, body);
    assert.equal(archivedReplay.id, placementA.id);
    assert.equal(archivedReplay.status, "archived", "idempotent replay does not implicitly restore an association");
    await reject(() => service.createActivityPlacement(editor, activity.id, { ...body, idempotencyKey: randomUUID() }), "DEPENDENCY_CONFLICT");
    placementA = await service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "active" });
    assert.equal((await service.getActivity(editor, activity.id)).has_map_link, true);
    for (const status of ["active", "paused"]) {
      placementA = await service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status });
      await reject(() => service.createActivityPlacement(editor, activity.id, { workspaceId: f.workspaces.b }), "DEPENDENCY_CONFLICT");
    }
    await reject(() => service.createActivityPlacement(editor, activity.id, { workspaceId: f.workspaces.b, status: "draft" }), "VALIDATION_FAILED");
    await reject(() => service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "draft" }), "VALIDATION_FAILED");
    placementA = await service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "archived" });
    assert.equal((await service.getActivity(editor, activity.id)).has_map_link, false);
    const concurrentPlacements = await Promise.allSettled([randomUUID(), randomUUID()].map((idempotencyKey) =>
      service.createActivityPlacement(editor, activity.id, { ...body, workspaceId: f.workspaces.b, idempotencyKey })));
    const createdPlacement = concurrentPlacements.find((result) => result.status === "fulfilled");
    const duplicatePlacement = concurrentPlacements.find((result) => result.status === "rejected");
    assert.ok(createdPlacement?.status === "fulfilled");
    assert.ok(duplicatePlacement?.status === "rejected" && duplicatePlacement.reason instanceof ContentError && duplicatePlacement.reason.code === "DEPENDENCY_CONFLICT");
    let placementB = createdPlacement.value;
    await reject(() => service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "paused" }), "DEPENDENCY_CONFLICT");
    const switchMap = async (map: "a" | "b") => {
      if (map === "a") {
        placementB = await service.updateActivityPlacement(editor, placementB.id, { expectedLockVersion: placementB.lock_version, status: "archived" });
        placementA = await service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "active" });
      } else {
        placementA = await service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "archived" });
        placementB = await service.updateActivityPlacement(editor, placementB.id, { expectedLockVersion: placementB.lock_version, status: "active" });
      }
    };
    await switchMap("a");
    assert.notEqual(placementA.id, placementB.id);
    for (const field of ["location", "radius_meters", "config", "points"]) assert.equal(field in placementA, false);
    for (const legacy of [{ location: position }, { radiusMeters: 100 }, { config: { checkinRadiusMeters: 100 } }, { points: [{ pointId: first.id, location: position, enabled: false }] }]) {
      await reject(() => service.createActivityPlacement(editor, activity.id, { ...body, ...legacy }), "VALIDATION_FAILED");
      await reject(() => service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, ...legacy }), "VALIDATION_FAILED");
    }
    await reject(() => service.createActivityPlacement(editor, activity.id, { ...body, workspaceId: f.workspaces.foreign }), "NOT_FOUND");
    await reject(() => service.updateActivityPlacement(viewer, placementA.id, { expectedLockVersion: placementA.lock_version, status: "paused" }), "FORBIDDEN");
    assert.equal((await runtime.publicActivities({ workspaceId: f.workspaces.a, organizationId: f.organizations.foreign })).length, 0);
    assert.equal((await runtime.publicActivities({ workspaceId: f.workspaces.a, organizationId: f.organizations.team }))[0].points.length, 2);
    const acrossMaps = await runtime.publicActivities({ workspaceId: null, organizationId: f.organizations.team });
    assert.deepEqual(new Set(acrossMaps.map((row) => row.workspace_id)), new Set([f.workspaces.a]));
    assert.ok(acrossMaps.every((row) => row.workspace_name));
    for (const row of acrossMaps) {
      assert.equal(row.points[0].id, first.id);
      assert.equal(row.points[0].point_id, first.id);
      assert.equal(row.points[0].longitude, originalPosition.longitude);
      assert.equal(row.points[0].latitude, originalPosition.latitude);
    }
    activity = await service.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, config: { checkinRadiusMeters: 60 }, points: [
      { id: first.id, name: first.name, imageAssetId: f.assets.image, rewardAssetId: f.assets.image, location: position },
      { id: second.id, name: second.name, location: null },
    ] });
    activity = await service.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, points: [
      { id: first.id, name: first.name, imageAssetId: f.assets.image, rewardAssetId: f.assets.image },
      { id: second.id, name: second.name },
    ] });
    assert.deepEqual(activity.points[0].location, position, "omitting an existing point location preserves its coordinates");
    const movedAcrossMaps = await runtime.publicActivities({ workspaceId: null, organizationId: f.organizations.team });
    assert.equal(movedAcrossMaps.length, 1);
    for (const row of movedAcrossMaps) {
      assert.equal(row.points[0].longitude, position.longitude, "activity coordinates update every map");
      assert.equal(row.points[0].latitude, position.latitude);
      assert.equal(row.config.checkinRadiusMeters, 60, "activity rules update every map");
    }
    checks++;

    const participant = randomUUID();
    const checkin: Submission = { placementId: placementA.id, kind: "checkin", pointId: first.id, participantId: participant, content: null, location: position, idempotencyKey: randomUUID() };
    await reject(() => runtime.submitActivityRecord({ ...checkin, location: { longitude: 120, latitude: 30 } }), "VALIDATION_FAILED");
    await reject(() => runtime.submitActivityRecord({ ...checkin, pointId: second.id }), "VALIDATION_FAILED");
    const completed = await Promise.all([runtime.submitActivityRecord(checkin), runtime.submitActivityRecord(checkin)]);
    assert.equal(completed[0].id, completed[1].id);
    assert.equal((await runtime.submitActivityRecord({ ...checkin, idempotencyKey: randomUUID() })).id, completed[0].id);
    assert.deepEqual(await runtime.activityProgress(placementA.id, participant), { point_ids: [first.id] });
    await switchMap("b");
    await reject(() => runtime.submitActivityRecord({ ...checkin, idempotencyKey: randomUUID() }), "NOT_FOUND");
    assert.deepEqual(await runtime.activityProgress(placementB.id, participant), { point_ids: [] });
    const source = (await client.query("select r.organization_id,p.workspace_id from activity_record r join activity_placement p on p.id=r.placement_id where r.id=$1", [completed[0].id])).rows[0];
    assert.deepEqual(source, { organization_id: f.organizations.team, workspace_id: f.workspaces.a }, "switching maps preserves the original record's team and map");
    const completedB = await runtime.submitActivityRecord({ ...checkin, placementId: placementB.id });
    assert.notEqual(completedB.id, completed[0].id, "shared points keep independent progress and idempotency per placement");
    assert.deepEqual(await runtime.activityProgress(placementB.id, participant), { point_ids: [first.id] });
    const hiddenCheckin = await service.moderateActivityRecord(editor, completed[0].id, { expectedLockVersion: 1, status: "hidden" });
    assert.deepEqual(await runtime.activityProgress(placementB.id, participant), { point_ids: [first.id] });
    await switchMap("a");
    await reject(() => runtime.submitActivityRecord(checkin), "VALIDATION_FAILED");
    await reject(() => runtime.submitActivityRecord({ ...checkin, idempotencyKey: randomUUID() }), "VALIDATION_FAILED");
    assert.deepEqual(await runtime.activityProgress(placementA.id, participant), { point_ids: [] });
    await service.moderateActivityRecord(editor, completed[0].id, { expectedLockVersion: hiddenCheckin.lock_version, status: "visible" });
    await reject(() => runtime.submitActivityRecord({ ...checkin, pointId: second.id }), "IDEMPOTENCY_CONFLICT");
    checks++;

    const defaultChat = await service.createActivity(editor, f.organizations.team, { name: "Default message limit", type: "danmaku" });
    const defaultChatPlacement = await service.createActivityPlacement(editor, defaultChat.id, { workspaceId: f.workspaces.a, status: "active" });
    assert.equal((await runtime.publicActivities({ workspaceId: f.workspaces.a, organizationId: f.organizations.team })).find((row) => row.activity_id === defaultChat.id)?.config.maxLength, 50);
    const defaultSubmission: Submission = { placementId: defaultChatPlacement.id, kind: "danmaku", pointId: null, participantId: participant, content: "字".repeat(50), location: position, idempotencyKey: randomUUID() };
    await runtime.submitActivityRecord(defaultSubmission);
    await reject(() => runtime.submitActivityRecord({ ...defaultSubmission, content: "字".repeat(51), idempotencyKey: randomUUID() }), "VALIDATION_FAILED");
    await service.updateActivityPlacement(editor, defaultChatPlacement.id, { expectedLockVersion: defaultChatPlacement.lock_version, status: "paused" });
    let chat = await service.createActivity(editor, f.organizations.team, { name: "Messages", type: "danmaku", config: { maxLength: 100 }, location: position, radiusMeters: 10 });
    const chatA = await service.createActivityPlacement(editor, chat.id, { workspaceId: f.workspaces.a, status: "active" });
    await service.updateActivityPlacement(editor, chatA.id, { expectedLockVersion: chatA.lock_version, status: "archived" });
    const chatB = await service.createActivityPlacement(editor, chat.id, { workspaceId: f.workspaces.b, status: "active" });
    await service.updateActivityPlacement(editor, chatB.id, { expectedLockVersion: chatB.lock_version, status: "archived" });
    await service.updateActivityPlacement(editor, chatA.id, { expectedLockVersion: chatA.lock_version + 1, status: "active" });
    chat = await service.updateActivity(editor, chat.id, { expectedLockVersion: chat.lock_version, name: "Shared message area" });
    assert.deepEqual(chat.location, position, "unrelated activity edits retain the shared participation area");
    assert.equal(chat.radius_meters, 10);
    for (const row of (await runtime.publicActivities({ workspaceId: null, organizationId: f.organizations.team })).filter((row) => row.activity_id === chat.id)) {
      assert.deepEqual(row.location, position);
      assert.equal(row.radius_meters, 10);
    }
    const counts = async () => (await client.query("select (select count(*) from asset where organization_id=$1) assets,(select count(*) from placement where organization_id=$1) placements", [f.organizations.team])).rows[0];
    const before = await counts();
    const submission: Submission = { placementId: chatA.id, kind: "danmaku", pointId: null, participantId: participant, content: "Activity message", location: position, idempotencyKey: randomUUID() };
    const record = await runtime.submitActivityRecord(submission);
    assert.deepEqual(await counts(), before, "participation never creates ordinary assets or placements");
    assert.equal((await runtime.submitActivityRecord(submission)).id, record.id);
    await reject(() => runtime.submitActivityRecord({ ...submission, content: "Changed", idempotencyKey: submission.idempotencyKey }), "IDEMPOTENCY_CONFLICT");
    await reject(() => runtime.submitActivityRecord({ ...submission, content: "x".repeat(101), idempotencyKey: randomUUID() }), "VALIDATION_FAILED");
    await reject(() => runtime.submitActivityRecord({ ...submission, location: { longitude: 0, latitude: 0 } }), "VALIDATION_FAILED");
    const published = await runtime.publicDanmaku({ workspaceId: f.workspaces.a, organizationId: f.organizations.team }, { location: position, radius: 100 });
    assert.ok(published.some((row) => row.id === record.id));
    assert.equal("participant_id" in published[0], false);
    assert.equal((await runtime.publicDanmaku({ workspaceId: f.workspaces.b, organizationId: f.organizations.team })).length, 0);
    assert.equal((await ordinary.nearbyPlacements({ workspaceId: f.workspaces.a, organizationId: f.organizations.team }, 31.2, 121.5, 100)).some((row) => row.id === record.id), false);
    checks++;

    await reject(() => service.moderateActivityRecord(viewer, record.id, { expectedLockVersion: 1, status: "hidden" }), "FORBIDDEN");
    await reject(() => service.listActivityRecords(foreign, chat.id, { limit: 20, offset: 0 }), "NOT_FOUND");
    const hidden = await service.moderateActivityRecord(editor, record.id, { expectedLockVersion: 1, status: "hidden" });
    await reject(() => runtime.submitActivityRecord(submission), "VALIDATION_FAILED");
    assert.equal((await runtime.publicDanmaku({ workspaceId: f.workspaces.a, organizationId: null })).length, 0);
    await reject(() => service.moderateActivityRecord(editor, record.id, { expectedLockVersion: 1, status: "visible" }), "LOCK_VERSION_CONFLICT");
    await service.moderateActivityRecord(editor, record.id, { expectedLockVersion: hidden.lock_version, status: "visible" });
    assert.equal((await service.listActivityRecords(editor, chat.id, { placementId: chatA.id, limit: 20, offset: 0 })).page.total, 1);
    const protectedKey = `assets/${f.run}/text-reference.jpg`;
    await runtime.submitActivityRecord({ ...submission, content: `https://content-services.invalid/${protectedKey}`, idempotencyKey: randomUUID() });
    assert.equal(await retention.isKeyProtected(db, protectedKey), true);
    assert.equal((await retention.collectProtectedKeys()).has(protectedKey), true);
    checks++;

    placementA = await service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "paused" });
    await reject(() => runtime.submitActivityRecord({ ...checkin, idempotencyKey: randomUUID() }), "NOT_FOUND");
    assert.equal((await runtime.publicActivities({ workspaceId: f.workspaces.a, organizationId: null })).some((row) => row.id === placementA.id), false);
    assert.equal((await runtime.publicActivities({ workspaceId: f.workspaces.b, organizationId: null })).some((row) => row.id === placementB.id), false);
    await service.updateActivityPlacement(editor, placementA.id, { expectedLockVersion: placementA.lock_version, status: "active" });
    activity = await service.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, state: "archived" });
    await reject(() => runtime.submitActivityRecord(checkin), "NOT_FOUND");
    activity = await service.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, state: "active" });
    await service.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, points: [{ id: second.id, name: second.name }] });
    assert.ok(await db.selectFrom("activity_record").select("id").where("id", "=", completed[0].id).executeTakeFirst(), "archiving a point preserves history");
    assert.deepEqual(await runtime.activityProgress(placementA.id, participant), { point_ids: [] });
    await reject(() => runtime.activityProgress(placementB.id, participant), "NOT_FOUND");
    checks++;

    let pending: Promise<PromiseSettledResult<unknown>> | undefined;
    await client.query("begin");
    try {
      await client.query("update organization set archived_at=now() where id=$1", [f.organizations.team]);
      pending = runtime.submitActivityRecord({ ...submission, idempotencyKey: randomUUID() }).then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));
      let blocked = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        blocked = (await client.query("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and pg_backend_pid()=any(pg_blocking_pids(pid))) waiting")).rows[0].waiting;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(blocked, true);
      await client.query("commit");
      const result = await pending;
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.ok(result.reason instanceof ContentError && result.reason.code === "NOT_FOUND");
    } finally {
      await client.query("rollback");
      if (pending) await pending;
      await client.query("update organization set archived_at=null where id=$1", [f.organizations.team]);
    }
    checks++;

    const context = { params: Promise.resolve({ id: f.organizations.team }) };
    auth.setStubSessionUser(null);
    assert.equal((await listRoute.GET(new Request("http://test/api/organizations/x/activities"), context)).status, 401);
    auth.setStubSessionUser({ id: f.users.viewer, email: null, name: null, emailVerified: false });
    assert.equal((await listRoute.POST(new Request("http://test/api/organizations/x/activities", { method: "POST", body: JSON.stringify(create) }), context)).status, 403);
    auth.setStubSessionUser({ id: f.users.editor, email: null, name: null, emailVerified: false });
    const blockedLink = await linkRoute.POST(new Request("http://test/api/activities/x/placements", { method: "POST", body: JSON.stringify({ workspaceId: f.workspaces.empty }) }), { params: Promise.resolve({ id: chat.id }) });
    assert.equal(blockedLink.status, 409);
    assert.equal((await blockedLink.json()).code, "DEPENDENCY_CONFLICT");
    const blockedRestore = await placementRoute.PATCH(new Request("http://test/api/activity-placements/x", { method: "PATCH", body: JSON.stringify({ expectedLockVersion: chatB.lock_version + 1, status: "paused" }) }), { params: Promise.resolve({ id: chatB.id }) });
    assert.equal(blockedRestore.status, 409);
    assert.equal((await blockedRestore.json()).code, "DEPENDENCY_CONFLICT");
    const rejectedDraft = await linkRoute.POST(new Request("http://test/api/activities/x/placements", { method: "POST", body: JSON.stringify({ workspaceId: f.workspaces.empty, status: "draft" }) }), { params: Promise.resolve({ id: chat.id }) });
    assert.equal(rejectedDraft.status, 400);
    assert.equal((await service.listActivities(editor, f.organizations.team)).find((entry) => entry.id === chat.id)?.has_map_link, true);
    assert.equal((await detailRoute.PATCH(new Request("http://test/api/activities/x", { method: "PATCH", body: JSON.stringify({ name: "No lock" }) }), { params: Promise.resolve({ id: chat.id }) })).status, 428);
    const response = await recordRoute.POST(new Request("http://test/api/miniapp/activity-records", { method: "POST", body: JSON.stringify({ placement_id: chatA.id, kind: "danmaku", content: "HTTP message", participant_id: participant, idempotency_key: randomUUID(), user_lat: 31.2, user_lng: 121.5 }) }));
    assert.equal(response.status, 200);
    assert.ok((await response.json()).id);
    assert.equal((await recordRoute.POST(new Request("http://test/api/miniapp/activity-records", { method: "POST", body: JSON.stringify({ placement_id: chatA.id, kind: "danmaku" }) }))).status, 400);
    checks++;
    console.log(`PASS ${checks} activity integration scenarios (atomic create-and-link, single-map links, concurrent create/restore, two statuses, source history, ownership, scope, idempotency, archival race, moderation, files, HTTP)`);
  } finally {
    await cleanupServicesFixture(client, f);
    await client.end();
    await db.destroy();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
