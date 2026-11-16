/** Deep-copy service and real HTTP route regression; disposable PostGIS only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { assertServicesDatabase, cleanupServicesFixture, fixtureIds, seedServicesFixture, assetDocument } from "./test-content-model-services-fixture";
import { installRouteStubs } from "./test-support/install-route-stubs";
import type * as AuthStub from "./test-support/stub-auth-server";
import type { DuplicateContentRequest, DuplicateContentResult } from "../lib/content-model/duplicate-contracts";

async function main() {
  assertServicesDatabase();
  await installRouteStubs();
  const auth = await import("../lib/auth/server") as unknown as typeof AuthStub;
  const { db } = await import("../lib/db");
  const { loadActor } = await import("../lib/content-model/access.server");
  const { ContentError } = await import("../lib/content-model/errors");
  const { duplicateContent } = await import("../lib/content-model/duplicate.server");
  const route = await import("../app/api/content/duplicate/route");
  const assets = await import("../lib/assets/service.server");
  const scenes = await import("../lib/scene/service.server");
  const placements = await import("../lib/placements/service.server");
  const activities = await import("../lib/activities/service.server");
  const retention = await import("../lib/storage/retention.server");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const f = fixtureIds();
  const reject = (run: () => Promise<unknown>, code: string) => assert.rejects(run,
    (error: unknown) => error instanceof ContentError && error.code === code);
  const request = (sourceType: DuplicateContentRequest["sourceType"], sourceId: string, extra: Partial<DuplicateContentRequest> = {}): DuplicateContentRequest => ({
    sourceType, sourceId, targetOrganizationId: f.organizations.foreign, idempotencyKey: randomUUID(), ...extra,
  });
  const counts = async () => {
    const result: Record<string, number> = {};
    for (const table of ["asset", "scene", "workspace", "placement", "activity", "activity_point", "activity_placement", "content_command_idempotency"] as const) {
      result[table] = Number((await db.selectFrom(table).select(({ fn }) => fn.countAll<number>().as("n"))
        .where("organization_id", "=", f.organizations.foreign).executeTakeFirstOrThrow()).n);
    }
    return result;
  };
  const http = async (userId: string | null, body: unknown, status: number, code?: string) => {
    auth.setStubSessionUser(userId ? { id: userId, email: null, name: null, emailVerified: true } : null);
    const response = await route.POST(new Request("http://localhost/api/content/duplicate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    if (code) assert.equal(result.code, code);
    return result.data as DuplicateContentResult;
  };
  try {
    await seedServicesFixture(client, f);
    await client.query("update users set role='super_admin' where user_id=$1", [f.users.manager]);
    // Having write access to both teams is deliberately insufficient.
    await client.query("insert into organization_member(organization_id,user_id,role) values($1,$2,'owner')", [f.organizations.foreign, f.users.owner]);
    const [admin, owner, editor, foreign] = await Promise.all([f.users.manager, f.users.owner, f.users.editor, f.users.foreign].map(id => loadActor(db, id)));
    const copy = (body: DuplicateContentRequest) => duplicateContent(admin, { ...body });

    const basic = request("asset", f.assets.shared);
    await http(null, basic, 401, "UNAUTHENTICATED");
    for (const id of [f.users.owner, f.users.editor, f.users.viewer, f.users.foreign]) await http(id, basic, 403, "FORBIDDEN");
    await http(f.users.manager, { ...basic, sourceType: "organization" }, 400, "VALIDATION_FAILED");
    await http(f.users.manager, { ...basic, sourceId: "bad-id" }, 400, "VALIDATION_FAILED");
    await http(f.users.manager, { ...basic, injectedRole: "super_admin" }, 400, "VALIDATION_FAILED");
    await reject(() => copy(request("asset", randomUUID())), "NOT_FOUND");
    console.log("PASS super-admin-only route, authentication and request validation");

    await client.query("insert into asset_resource(asset_id,role,external_url,mime_type,size_bytes) values($1,'thumbnail','https://fixture.invalid/model.jpg','image/jpeg',42)", [f.assets.shared]);
    const first = await http(f.users.manager, basic, 201);
    assert.equal(first.organizationId, f.organizations.foreign);
    assert.notEqual(first.id, f.assets.shared);
    const savedCounts = await counts();
    assert.equal((await http(f.users.manager, basic, 200)).id, first.id);
    assert.deepEqual(await counts(), savedCounts);
    await http(f.users.manager, { ...basic, targetOrganizationId: f.organizations.solo }, 409, "IDEMPOTENCY_CONFLICT");
    const copiedAsset = await assets.getAssetDetail(foreign, first.id);
    assert.equal(copiedAsset.organization_id, f.organizations.foreign);
    await reject(() => assets.getAssetDetail(editor, first.id), "NOT_FOUND");
    const resources = (await client.query("select role,ordinal,storage_key,external_url,content_hash,mime_type,size_bytes from asset_resource where asset_id=$1 order by role,ordinal", [f.assets.shared])).rows;
    assert.deepEqual((await client.query("select role,ordinal,storage_key,external_url,content_hash,mime_type,size_bytes from asset_resource where asset_id=$1 order by role,ordinal", [first.id])).rows, resources);
    const concurrent = request("asset", f.assets.shared);
    const retries = await Promise.all([copy(concurrent), copy(concurrent), copy(concurrent)]);
    assert.equal(new Set(retries.map(result => result.id)).size, 1);
    assert.equal(retries.filter(result => result.created).length, 1);
    console.log("PASS independent asset resources, target visibility and concurrent idempotency");

    const sourceScene = await scenes.getScene(editor, f.scenes.a);
    const document = assetDocument(f.assets.shared);
    document.content.assets.second = { assetId: f.assets.shared };
    document.content.assets.sound = { assetId: f.assets.audio };
    await scenes.saveScene(editor, sourceScene.id, { expectedLockVersion: sourceScene.lock_version, document });
    const beforeScene = await counts();
    const sceneCopy = await copy(request("scene", sourceScene.id, { name: "Copied composition" }));
    const copiedScene = await scenes.getScene(foreign, sceneCopy.id);
    const refs = copiedScene.document.content.assets;
    assert.equal(refs.model.assetId, refs.second.assetId);
    assert.notEqual(refs.model.assetId, f.assets.shared);
    assert.notEqual(refs.sound.assetId, f.assets.audio);
    assert.equal((await counts()).asset - beforeScene.asset, 2, "aliases share one target-owned copy per source asset");
    assert.deepEqual(copiedScene.document.content.instances, document.content.instances);
    const index = await db.selectFrom("scene_asset_ref").selectAll().where("scene_id", "=", copiedScene.id).execute();
    assert.equal(index.length, 3);
    for (const ref of index) {
      assert.equal(ref.organization_id, f.organizations.foreign);
      assert.equal(ref.asset_id, refs[ref.resource_alias].assetId);
      assert.equal((await assets.getAssetDetail(foreign, ref.asset_id)).organization_id, f.organizations.foreign);
    }
    await assets.updateAsset(editor, f.assets.shared, { expectedLockVersion: 1, name: "Source edited", payload: { kind: "model" },
      resources: [{ role: "primary", externalUrl: "https://fixture.invalid/replaced.glb" }] });
    assert.equal((await assets.getAssetDetail(foreign, refs.model.assetId)).name, "service-test-shared");
    assert.equal(await retention.isKeyProtected(db, f.keys.current), true, "copied resource protects replaced source file");
    assert.equal((await scenes.getScene(foreign, copiedScene.id)).document.content.assets.model.assetId, refs.model.assetId);
    console.log("PASS scene reference closure, alias deduplication, index rebuild and source independence");

    const activity = await activities.createActivity(editor, f.organizations.team, { name: "Shops", type: "shop_checkin", description: "Route", config: { checkinRadiusMeters: 35 } });
    const shops = await activities.updateActivity(editor, activity.id, { expectedLockVersion: activity.lock_version, points: [
      { name: "First shop", ordinal: 2, location: { longitude: 121.5, latitude: 31.2 }, imageAssetId: f.assets.image, rewardAssetId: f.assets.image },
      { name: "Second shop", ordinal: 5, location: { longitude: 121.6, latitude: 31.3 }, imageAssetId: f.assets.image },
    ] });
    const link = await activities.createActivityPlacement(editor, activity.id, { workspaceId: f.workspaces.a, status: "active" });
    await client.query("insert into activity_record(organization_id,activity_id,placement_id,point_id,kind,participant_id) values($1,$2,$3,$4,'checkin','fixture-participant')", [f.organizations.team, activity.id, link.id, shops.points[0].id]);
    const activityCopy = await copy(request("activity", activity.id));
    const copiedActivity = await activities.getActivity(foreign, activityCopy.id);
    assert.equal(copiedActivity.points.length, 2);
    assert.equal(copiedActivity.has_map_link, false);
    assert.deepEqual(copiedActivity.config, shops.config);
    assert.deepEqual(copiedActivity.points[0].location, shops.points[0].location);
    assert.notEqual(copiedActivity.points[0].id, shops.points[0].id);
    assert.notEqual(copiedActivity.points[0].image_asset_id, f.assets.image);
    assert.equal(copiedActivity.points[0].image_asset_id, copiedActivity.points[0].reward_asset_id);
    assert.equal(copiedActivity.points[0].image_asset_id, copiedActivity.points[1].image_asset_id);
    assert.equal((await activities.listActivityRecords(foreign, copiedActivity.id, { limit: 20, offset: 0 })).page.total, 0);
    console.log("PASS activity points and image closure without participant history or source map association");

    const anchor = await assets.createAssetInOrganization(editor, f.organizations.team, { name: "Recognition", fileType: "anchor", payload: { kind: "anchor" },
      resources: [{ role: "reference", ordinal: 0, externalUrl: "https://fixture.invalid/ref-one.jpg" }, { role: "reference", ordinal: 1, externalUrl: "https://fixture.invalid/ref-two.jpg" }], idempotencyKey: randomUUID() });
    await placements.createPlacement(editor, f.workspaces.a, { target: { kind: "asset", assetId: anchor.asset.id }, name: "Anchor", location: { longitude: 121.5, latitude: 31.2 }, status: "active" });
    const attached = await placements.createPlacement(editor, f.workspaces.a, { target: { kind: "scene", sceneId: sourceScene.id }, name: "Attached scene", anchorId: anchor.asset.id, status: "active" });
    await placements.createPlacement(editor, f.workspaces.a, { target: { kind: "asset", assetId: f.assets.shared }, name: "Also direct", location: { longitude: 121.6, latitude: 31.3 }, status: "paused" });
    const tagId = randomUUID();
    await client.query("insert into tag(id,workspace_id,name,color) values($1,$2,'Walking','#123456')", [tagId, f.workspaces.a]);
    await client.query("insert into placement_tag(placement_id,tag_id,workspace_id) values($1,$2,$3)", [attached.placement.id, tagId, f.workspaces.a]);
    const beforeMap = await counts();
    const mapCopy = await copy(request("collection", f.workspaces.a, { name: "Copied map" }));
    const map = await db.selectFrom("workspace").selectAll().where("id", "=", mapCopy.id).executeTakeFirstOrThrow();
    const originalMap = await db.selectFrom("workspace").selectAll().where("id", "=", f.workspaces.a).executeTakeFirstOrThrow();
    assert.deepEqual(map.miniapp_config, originalMap.miniapp_config);
    const copiedPlacements = await placements.listWorkspacePlacements(foreign, map.id);
    assert.equal(copiedPlacements.length, 4);
    const copiedAttached = copiedPlacements.find(p => p.name === "Attached scene")!;
    const copiedAnchor = copiedPlacements.find(p => p.name === "Anchor")!;
    assert.equal(copiedAnchor.target.kind, "asset");
    assert.ok(copiedAnchor.target.kind === "asset");
    assert.ok(copiedAttached.target.kind === "scene");
    assert.equal(copiedAttached.anchor_id, copiedAnchor.target.asset_id);
    assert.equal(copiedAnchor.status, "active");
    assert.notEqual(copiedAnchor.target.asset_id, anchor.asset.id);
    assert.equal((await assets.getAssetDetail(foreign, copiedAnchor.target.asset_id)).resources.filter(r => r.role === "reference").length, 2);
    const mapScene = await scenes.getScene(foreign, copiedAttached.target.scene_id);
    const direct = copiedPlacements.find(p => p.name === "Also direct")!;
    assert.ok(direct.target.kind === "asset");
    assert.equal(direct.target.asset_id, mapScene.document.content.assets.model.assetId);
    assert.equal((await counts()).scene - beforeMap.scene, 1, "repeated scene placements share the copied scene");
    const copiedTags = await client.query("select t.id,t.name,t.color from placement_tag pt join tag t on t.id=pt.tag_id where pt.placement_id=$1", [copiedAttached.id]);
    assert.equal(copiedTags.rows[0].name, "Walking");
    assert.notEqual(copiedTags.rows[0].id, tagId);
    const copiedLinks = await activities.listCollectionActivityPlacements(foreign, map.id);
    assert.equal(copiedLinks.length, 1);
    assert.equal(copiedLinks[0].status, "paused");
    assert.notEqual(copiedLinks[0].activity_id, activity.id);
    assert.equal((await activities.listActivityRecords(foreign, copiedLinks[0].activity_id, { limit: 20, offset: 0 })).page.total, 0);
    console.log("PASS full map closure, settings/tags, shared references, anchor binding and independent activity link");

    const placementCopy = await copy(request("placement", attached.placement.id, { targetWorkspaceId: f.workspaces.foreign }));
    const copiedPlacement = await placements.getPlacement(foreign, placementCopy.id);
    assert.equal(copiedPlacement.workspace_id, f.workspaces.foreign);
    assert.notEqual(copiedPlacement.anchor_id, anchor.asset.id);
    const targetPlacements = await placements.listWorkspacePlacements(foreign, f.workspaces.foreign);
    assert.ok(targetPlacements.some(p => p.target.kind === "asset" && p.target.asset_id === copiedPlacement.anchor_id && p.status === "active"));
    await reject(() => copy(request("placement", attached.placement.id)), "VALIDATION_FAILED");
    await reject(() => copy(request("placement", attached.placement.id, { targetWorkspaceId: f.workspaces.a })), "VALIDATION_FAILED");
    console.log("PASS standalone placement brings its scene, assets and usable recognition target");

    const beforeDenied = await counts();
    await client.query("update organization set archived_at=now() where id=$1", [f.organizations.foreign]);
    await reject(() => copy(request("scene", f.scenes.a)), "ARCHIVED");
    await client.query("update organization set archived_at=null where id=$1", [f.organizations.foreign]);
    await client.query("update workspace set archived_at=now() where id=$1", [f.workspaces.foreign]);
    await reject(() => copy(request("placement", attached.placement.id, { targetWorkspaceId: f.workspaces.foreign })), "ARCHIVED");
    await client.query("update workspace set archived_at=null where id=$1", [f.workspaces.foreign]);
    await client.query("update organization set archived_at=now() where id=$1", [f.organizations.team]);
    await reject(() => copy(request("asset", f.assets.shared)), "ARCHIVED");
    await client.query("update organization set archived_at=null where id=$1", [f.organizations.team]);
    await assets.archiveAsset(editor, f.assets.audio, 1);
    const failedIntent = request("scene", f.scenes.a);
    await reject(() => copy(failedIntent), "ARCHIVED");
    assert.deepEqual(await counts(), beforeDenied, "failed closure rolls back all copied dependencies and idempotency");
    await assets.updateAsset(editor, f.assets.audio, { expectedLockVersion: 2, state: "active" });
    assert.equal((await copy(failedIntent)).created, true, "a rolled-back intent may succeed after dependency repair");
    // General file reuse and existing same-team endpoints remain tenant-scoped.
    await reject(() => assets.duplicateAsset(owner, f.assets.shared, { targetWorkspaceId: f.workspaces.foreign, idempotencyKey: randomUUID() }), "VALIDATION_FAILED");
    await reject(() => assets.createAssetInOrganization(admin, f.organizations.foreign, { name: "Bypass", fileType: "model", payload: { kind: "model" },
      resources: [{ role: "primary", fromAssetId: f.assets.shared, fromRole: "primary" }], idempotencyKey: randomUUID() }), "NOT_FOUND");
    console.log("PASS archive checks, atomic rollback/retry and unchanged ordinary tenant isolation");
  } finally {
    try { await cleanupServicesFixture(client, f); }
    finally { await client.end(); await db.destroy(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
