/** Real template routes against the dedicated PostGIS fixture and in-memory OSS. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import sharp from "sharp";
import { installRouteStubs } from "./test-support/install-route-stubs";
import type * as AuthStub from "./test-support/stub-auth-server";
import { assertServicesDatabase, assetDocument, cleanupServicesFixture, fixtureIds, seedServicesFixture } from "./test-content-model-services-fixture";

async function main() {
  assertServicesDatabase();
  await installRouteStubs();
  const auth = await import("../lib/auth/server") as unknown as typeof AuthStub;
  const { db } = await import("../lib/db");
  const { collectProtectedKeys, isKeyProtected } = await import("../lib/storage/retention.server");
  const { processUploadMedia } = await import("../lib/upload/media-processing.server");
  const { previewSceneManifest } = await import("../lib/placements/runtime.server");
  const { POST: upload } = await import("../app/api/upload/route");
  const { GET: catalog } = await import("../app/api/templates/route");
  const { POST: duplicate } = await import("../app/api/templates/duplicate/route");
  const preview = await import("../app/api/templates/[type]/[id]/preview/route");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const f = fixtureIds();
  const official = (await db.selectFrom("organization").select("id").where("is_official_template_library", "=", true).executeTakeFirstOrThrow()).id;
  const ids = { asset: randomUUID(), scene: randomUUID(), collection: randomUUID() };
  const anchorId = randomUUID();
  const session = (id: string | null) => auth.setStubSessionUser(id ? { id, name: null, email: null, emailVerified: true } : null);
  async function response(result: Promise<Response>, status: number) {
    const res = await result;
    const body = await res.json();
    assert.equal(res.status, status, JSON.stringify(body));
    return body;
  }
  const cards = async (query = "") => (await response(catalog(new Request(`http://localhost/api/templates?q=${f.run}${query}`)), 200));
  function set(type: keyof typeof ids, receiptId: string | null, version: number, status = 200, id: string = ids[type]) {
    const req = new Request("http://localhost/preview", { method: "PUT", body: JSON.stringify({ receiptId, expectedLockVersion: version }) });
    return response(preview.PUT(req, { params: Promise.resolve({ type, id }) }), status);
  }
  function send(file: File, org = official, status = 200) {
    const form = new FormData();
    form.set("organization_id", org);
    form.set("template_preview", "true");
    form.set("file", file);
    return response(upload(new Request("http://localhost/api/upload", { method: "POST", body: form })), status);
  }
  const copy = (body: object, status: number) => response(duplicate(new Request("http://localhost/api/templates/duplicate",
    { method: "POST", body: JSON.stringify(body) })), status);
  try {
    await seedServicesFixture(client, f);
    await client.query("insert into organization_member(organization_id,user_id,role) values($1,$2,'member'),($1,$3,'viewer')", [official, f.users.editor, f.users.viewer]);
    await client.query("insert into workspace(id,organization_id,name) values($1,$2,$3)", [ids.collection, official, f.run]);
    await client.query("insert into asset(id,organization_id,name,file_type,payload) values($1,$2,$3,'model',$4)", [ids.asset, official, f.run, { kind: "model" }]);
    await client.query("insert into asset_resource(asset_id,role,external_url) values($1,'primary','https://fixture.invalid/private.glb'),($1,'thumbnail','https://fixture.invalid/cover.jpg')", [ids.asset]);
    await client.query("insert into scene(id,organization_id,name,document) values($1,$2,$3,$4)", [ids.scene, official, f.run, assetDocument(ids.asset)]);
    await client.query("insert into scene_asset_ref(scene_id,organization_id,resource_alias,asset_id) values($1,$2,'model',$3)", [ids.scene, official, ids.asset]);
    await client.query("insert into placement(organization_id,workspace_id,scene_id,status) values($1,$2,$3,'draft')", [official, ids.collection, ids.scene]);
    session(null);
    const page = await cards();
    assert.equal(page.data.length, 3);
    assert.deepEqual(page.data.find((c: { type: string }) => c.type === "asset"), {
      type: "asset", id: ids.asset, name: f.run, thumbnail: { kind: "image", url: "https://fixture.invalid/cover.jpg" },
    });
    assert.ok(!JSON.stringify(page).includes("private.glb"));
    assert.equal((await cards("&type=scene")).data[0].thumbnail, null);
    assert.equal((await cards("&limit=1")).page.hasMore, true);
    assert.equal((await cards("&limit=1&offset=2")).page.hasMore, false);
    await client.query("insert into asset(id,organization_id,name,file_type,payload) values($1,$2,$3,'anchor',$4)", [anchorId, official, f.run, { kind: "anchor" }]);
    assert.equal((await cards("&type=asset")).data.length, 2);
    const basicAssets = await cards("&type=asset&excludeAnchors=true&limit=1");
    assert.deepEqual(basicAssets.data.map((card: { id: string }) => card.id), [ids.asset]);
    assert.equal(basicAssets.page.hasMore, false);
    await previewSceneManifest(ids.scene, official); // Regular QR playback of the original still works.
    const intent = { sourceType: "scene", sourceId: ids.scene, targetOrganizationId: f.organizations.foreign, idempotencyKey: randomUUID() };
    await copy(intent, 401);
    session(f.users.viewer);
    await set("scene", null, 0, 403);
    await copy({ ...intent, targetOrganizationId: f.organizations.solo }, 403);
    session(f.users.foreign);
    await set("scene", null, 0, 403);
    await copy({ ...intent, sourceId: f.scenes.a }, 404);
    await copy({ ...intent, sourceType: "activity" }, 400);
    const assetCopy = (await copy({ ...intent, sourceType: "asset", sourceId: ids.asset, idempotencyKey: randomUUID() }, 201)).data;
    const { GET: readAsset } = await import("../app/api/assets/[id]/route");
    const ownedAsset = (await response(readAsset(new Request("http://localhost/asset"), { params: Promise.resolve({ id: assetCopy.id }) }), 200)).data;
    assert.notEqual(ownedAsset.id, ids.asset);
    assert.equal(ownedAsset.organization_id, intent.targetOrganizationId);
    assert.equal(ownedAsset.capabilities.can_maintain, true);
    assert.equal(ownedAsset.resources.find((resource: { role: string }) => resource.role === "primary").url, "https://fixture.invalid/private.glb");
    const created = (await copy(intent, 201)).data;
    assert.equal((await copy(intent, 200)).data.id, created.id);
    const { loadActor } = await import("../lib/content-model/access.server");
    const { getScene, saveScene } = await import("../lib/scene/service.server");
    const foreign = await loadActor(db, f.users.foreign);
    const own = await getScene(foreign, created.id);
    assert.notEqual(own.document.content.assets.model.assetId, ids.asset);
    await saveScene(foreign, created.id, { name: "Edited copy", expectedLockVersion: own.lock_version });
    const mapCopy = (await copy({ ...intent, sourceType: "collection", sourceId: ids.collection, idempotencyKey: randomUUID() }, 201)).data.id;
    assert.equal((await db.selectFrom("placement").select("status").where("workspace_id", "=", mapCopy).executeTakeFirstOrThrow()).status, "draft");

    session(f.users.editor);
    await copy({ ...intent, sourceType: "asset", sourceId: ids.asset, targetOrganizationId: official, idempotencyKey: randomUUID() }, 400);
    await set("scene", null, 0, 404, f.scenes.a);
    await set("asset", f.receipts.active, 0, 400);
    const animation = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=48x48:rate=5:duration=1", "-f", "gif", "pipe:1"]);
    const gif = new File([Uint8Array.from(animation)], "animated.gif", { type: "image/gif" });
    const animated = await processUploadMedia(gif, "image", { preserveAnimation: true });
    assert.equal((await sharp(animated.buffer).metadata()).pages, 5);
    const gifReceipt = (await send(gif)).data;
    assert.equal(gifReceipt.mime_type, "image/webp");
    await send(gif, f.organizations.team, 403);
    const sceneCover = (await set("scene", gifReceipt.id, 0)).data;
    assert.deepEqual((await cards("&type=scene")).data[0].thumbnail, sceneCover.thumbnail);
    assert.equal(sceneCover.thumbnail.kind, "image");
    await set("scene", null, 0, 409);
    const video = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=8:duration=0.5", "-c:v", "libvpx", "-f", "webm", "pipe:1"]);
    const videoReceipt = (await send(new File([Uint8Array.from(video)], "preview.webm", { type: "video/webm" }))).data;
    assert.equal((await set("collection", videoReceipt.id, 0)).data.thumbnail.kind, "video");
    assert.deepEqual((await cards("&type=collection")).data[0].thumbnail, { url: videoReceipt.url, kind: "video" });
    await set("asset", videoReceipt.id, 0);
    await set("asset", null, 1);
    assert.equal((await cards("&type=asset&excludeAnchors=true")).data[0].thumbnail.url, "https://fixture.invalid/cover.jpg");
    await client.query("update upload_receipt set expires_at=clock_timestamp() where id=$1", [gifReceipt.id]);
    assert.equal(await isKeyProtected(db, gifReceipt.storage_key), true);
    assert.ok((await collectProtectedKeys()).has(gifReceipt.storage_key));
    await set("scene", null, 1);
    assert.equal(await isKeyProtected(db, gifReceipt.storage_key), false);
    await set("scene", gifReceipt.id, 2, 400);
    await client.query("update scene set state='archived', archived_at=now() where id=$1", [ids.scene]);
    assert.equal((await cards("&type=scene")).data.length, 0);
    await set("scene", videoReceipt.id, 2, 409);
    session(f.users.foreign);
    await copy({ ...intent, idempotencyKey: randomUUID() }, 409);
    console.log("PASS official catalog, manual animated/video covers, receipt retention, write permissions, independent copies and QR playback");
  } finally {
    try {
      await client.query("begin");
      await client.query("select set_config('content_model.writer','purge',true)");
      await client.query("delete from placement where workspace_id=$1", [ids.collection]);
      await client.query("delete from scene_asset_ref where scene_id=$1", [ids.scene]);
      await client.query("delete from scene where id=$1", [ids.scene]);
      await client.query("delete from asset where id in ($1,$2)", [ids.asset, anchorId]);
      await client.query("delete from workspace where id=$1", [ids.collection]);
      await client.query("delete from upload_receipt where created_by=$1 and organization_id=$2", [f.users.editor, official]);
      await client.query("delete from content_audit_log where actor_id=$1 and organization_id=$2", [f.users.editor, official]);
      await client.query("commit");
      await cleanupServicesFixture(client, f);
    } finally { await client.end(); await db.destroy(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
