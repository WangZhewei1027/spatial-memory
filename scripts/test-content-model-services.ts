import { DEFAULT_SCENE_LIGHTING } from "../packages/scene-lighting/config.js";
/** Real DB integration. Run with explicit DATABASE_URL and tsx --conditions react-server.
 * Uses only a dedicated database (content_services / team_wb_services) on the loopback
 * validation container; no auth sessions or OSS. Team model: the organization is the
 * only permission boundary (docs/team-workbench-backend-contract.md).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Actor } from "../lib/content-model/access.server";
import type { Trx } from "../lib/content-model/tx.server";
import { createBlankSceneDocument } from "../lib/scene/protocol";
import { assertServicesDatabase, cleanupServicesFixture, fixtureIds, seedRuntimeProjectionFixture, seedServicesFixture, assetDocument } from "./test-content-model-services-fixture";

const failures: string[] = [];
const matchAt = process.argv.indexOf("--match");
const nameFilter = matchAt >= 0 ? process.argv[matchAt + 1] : undefined;
if (matchAt >= 0) assert.ok(nameFilter, "--match requires a test-name substring");
let passed = 0;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  if (nameFilter && !name.includes(nameFilter)) return;
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`FAIL ${name}: ${message}`);
  }
}

async function main(): Promise<void> {
  assertServicesDatabase();
  const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: "content-services-regression" });
  await client.connect();
  const { db } = await import("../lib/db");
  const access = await import("../lib/content-model/access.server");
  const { ContentError } = await import("../lib/content-model/errors");
  const { declareWriter } = await import("../lib/content-model/tx.server");
  const dto = await import("../lib/assets/dto.server");
  const usage = await import("../lib/assets/usage.server");
  const content = await import("../lib/assets/content.server");
  const assetService = await import("../lib/assets/service.server");
  const sceneService = await import("../lib/scene/service.server");
  const placementService = await import("../lib/placements/service.server");
  const projects = await import("../lib/content-model/projects.server");
  const runtime = await import("../lib/placements/runtime.server");
  const { parseLinkAssetInput } = await import("../lib/link-asset");
  const receipts = await import("../lib/upload/receipts.server");
  const retention = await import("../lib/storage/retention.server");
  const f = fixtureIds();
  const rejectCode = (run: () => Promise<unknown>, code: string) => assert.rejects(run,
    (error: unknown) => {
      assert.ok(error instanceof ContentError && error.code === code,
        `Expected ${code}; got ${error instanceof ContentError ? error.code : String(error)}`);
      return true;
    }, `Expected ${code}`);
  const rejectSql = (query: string, values: unknown[], code: string) => assert.rejects(() => client.query(query, values),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === code, `Expected SQLSTATE ${code}`);
  const rollback = async (run: (trx: Trx) => Promise<void>, writer: "content" | "purge" = "content") => {
    const sentinel = new Error("rollback test fixture");
    try {
      await db.transaction().execute(async (trx) => {
        await declareWriter(trx, writer);
        await run(trx);
        throw sentinel;
      });
    } catch (error) { if (error !== sentinel) throw error; }
  };
  const sceneCount = async (organizationId: string) =>
    Number((await db.selectFrom("scene").select(({ fn }) => fn.countAll<number>().as("n")).where("organization_id", "=", organizationId).executeTakeFirstOrThrow()).n);
  /**
   * Another session waits on a lock held by `client`'s open transaction.
   * pg_blocking_pids is used because pg_stat_activity does not sample the
   * query text and the wait event atomically.
   */
  const waitForBlockedBy = async () => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const row = await client.query<{ waiting: boolean }>(`select exists(select 1 from pg_stat_activity
        where pid<>pg_backend_pid() and pg_backend_pid()=any(pg_blocking_pids(pid))) waiting`);
      if (row.rows[0].waiting) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };

  try {
    await seedServicesFixture(client, f);
    const actors = Object.fromEntries(await Promise.all(Object.entries(f.users).map(async ([name, id]) => [name, await access.loadActor(db, id)]))) as Record<keyof typeof f.users, Actor>;

    await check("T01/T02 team role: every writer maintains every team asset; other tenants see nothing", async () => {
      const target = await access.requireWorkspaceEdit(db, actors.editor, f.workspaces.b);
      for (const name of ["editor", "unassigned", "manager", "maintainer", "owner"] as const) {
        const asset = await access.requireAssetMaintain(db, actors[name], f.assets.restricted);
        assert.equal(asset.canMaintain, true, `${name} maintains the formerly restricted asset`);
        assert.equal(asset.canTransfer, name === "owner", `${name} maintainer-transfer right`);
      }
      const viewer = await access.requireAssetRead(db, actors.viewer, f.assets.restricted);
      assert.equal(viewer.canMaintain, false);
      await rejectCode(() => access.requireAssetMaintain(db, actors.viewer, f.assets.restricted), "FORBIDDEN");
      await rejectCode(() => access.requireAssetRead(db, actors.foreign, f.assets.shared), "NOT_FOUND");
      assert.equal(await dto.loadAssetDto(db, actors.foreign, f.assets.shared), null);
      await rollback(async (trx) => {
        assert.equal((await access.ensureAssetUse(trx, actors.editor, f.assets.restricted, target)).id, f.assets.restricted, "no grant is needed");
        await rejectCode(() => access.ensureAssetUse(trx, actors.editor, f.assets.foreign, target), "NOT_FOUND");
        const viewerTarget = await access.requireWorkspaceRead(trx, actors.viewer, f.workspaces.b);
        await rejectCode(() => access.ensureAssetUse(trx, actors.viewer, f.assets.shared, viewerTarget), "FORBIDDEN");
      });
    });

    await check("T02/T16 collections follow the team role; assignments neither grant nor limit access", async () => {
      const viewer = await access.requireWorkspaceRead(db, actors.viewer, f.workspaces.b);
      assert.equal(viewer.capabilities.can_edit, false);
      await rejectCode(() => access.requireWorkspaceEdit(db, actors.viewer, f.workspaces.b), "FORBIDDEN");
      await rejectCode(() => access.requireWorkspaceManage(db, actors.viewer, f.workspaces.b), "FORBIDDEN");
      for (const workspace of [f.workspaces.a, f.workspaces.b, f.workspaces.secret, f.workspaces.empty]) {
        const unassigned = await access.requireWorkspaceEdit(db, actors.unassigned, workspace);
        assert.deepEqual(unassigned.capabilities, { can_read: true, can_edit: true, can_archive: true });
      }
      await access.requireWorkspaceManage(db, actors.manager, f.workspaces.a);
      await rejectCode(() => access.requireWorkspaceRead(db, actors.foreign, f.workspaces.b), "NOT_FOUND");
      await rejectCode(() => access.requireWorkspaceRead(db, actors.editor, f.workspaces.foreign), "NOT_FOUND");

    });

    await check("T02 usage lists every same-team dependency by name; other tenants only get counts", async () => {
      const impact = await usage.computeImpact(db, actors.editor, f.assets.shared);
      const total = impact.scenes + impact.placements;
      assert.equal(impact.restricted_count, 0);
      assert.equal(impact.items.length, total);
      assert.ok(JSON.stringify(impact.items).includes("secret"), "formerly private collections are part of the team");
      const draftCollections = new Set(impact.items.flatMap((item) => (item.kind === "scene" ? [item.workspace_id] : [])));
      assert.ok([f.workspaces.a, f.workspaces.b, f.workspaces.secret].every((id) => draftCollections.has(id)));
      const outside = await usage.computeImpact(db, actors.foreign, f.assets.shared);
      assert.equal(outside.items.length, 0);
      assert.equal(outside.restricted_count, total);
      assert.equal((await assetService.getAssetUsage(actors.unassigned, f.assets.shared)).impact.restricted_count, 0);
    });

    await check("T03/T04 editing an asset updates all existing draft, published and map references", async () => {
      await rollback(async (trx) => {
        const source = await access.requireAssetMaintain(trx, actors.maintainer, f.assets.shared, { forUpdate: true });
        await content.writeAssetContent(trx, actors.maintainer, source.asset, { kind: "model" },
          [{ role: "primary", externalUrl: "https://fixture.invalid/replaced.glb" }]);
        const draft = await sceneService.resolveSceneResources(trx, [{resource_alias:"model",asset_id:f.assets.shared}]);
        assert.equal(draft[0].url, "https://fixture.invalid/replaced.glb");
        assert.equal((await sceneService.loadSceneForPlayback(trx, f.scenes.a))?.resources[0].url, "https://fixture.invalid/replaced.glb");
        for (const table of ["scene_asset_ref", "placement"] as const) {
          const refs = await trx.selectFrom(table).select("asset_id").where("asset_id", "=", f.assets.shared).execute();
          assert.ok(refs.length > 0);
        }
      });
    });

    await check("T02/T09 asset file reuse rejects another tenant and receipts enforce actor/tenant/purpose/expiry", async () => {
      await rollback(async (trx) => {
        const source = await access.requireAssetMaintain(trx, actors.maintainer, f.assets.shared, { forUpdate: true });
        await rejectCode(() => content.writeAssetContent(trx, actors.maintainer, source.asset, { kind: "model" },
          [{ role: "primary", fromAssetId: f.assets.foreign, fromRole: "primary" }]), "NOT_FOUND");
        assert.equal((await receipts.loadCommitReceipts(trx, f.users.maintainer, f.organizations.team, [f.receipts.active])).size, 1);
        await rejectCode(() => receipts.loadCommitReceipts(trx, f.users.editor, f.organizations.team, [f.receipts.active]), "RECEIPT_INVALID");
        await rejectCode(() => receipts.loadCommitReceipts(trx, f.users.maintainer, f.organizations.foreign, [f.receipts.active]), "RECEIPT_INVALID");
        await rejectCode(() => receipts.loadCommitReceipts(trx, f.users.maintainer, f.organizations.team, [f.receipts.expired]), "RECEIPT_INVALID");
      });
    });

    await check("T08/T09 asset content shape, tenant FKs and Placement XOR reject invalid SQL", async () => {
      await rejectSql("update asset set payload='{}'::jsonb where id=$1", [f.assets.shared], "23514");
      await rejectSql("insert into placement(organization_id,workspace_id,asset_id,scene_id) values($1,$2,$3,$4)",
        [f.organizations.team, f.workspaces.b, f.assets.shared, f.scenes.a], "23514");
      await rejectSql("insert into placement(organization_id,workspace_id) values($1,$2)", [f.organizations.team, f.workspaces.b], "23514");
      await rejectSql("insert into placement(organization_id,workspace_id,asset_id) values($1,$2,$3)",
        [f.organizations.team, f.workspaces.b, f.assets.foreign], "23503");
      await rejectSql("insert into scene_asset_ref(scene_id,organization_id,resource_alias,asset_id) values($1,$2,'foreign',$3)",
        [f.scenes.b, f.organizations.team, f.assets.foreign], "23503");
    });

    await check("T08 archive permits existing references while blocking new raw reuse", async () => {
      await rollback(async (trx) => {
        await trx.updateTable("asset").set({ state: "archived" }).where("id", "=", f.assets.shared).execute();
        const target = await access.requireWorkspaceEdit(trx, actors.editor, f.workspaces.b);
        await rejectCode(() => access.ensureAssetUse(trx, actors.editor, f.assets.shared, target), "ARCHIVED");
        assert.equal((await access.ensureAssetUse(trx, actors.editor, f.assets.shared, target, { existingReference: true })).id, f.assets.shared);
        assert.ok((await dto.loadAssetContents(trx, [f.assets.shared])).get(f.assets.shared)?.resources[0].url);
        assert.ok(usage.hasDependencies(await usage.computeImpact(trx, actors.owner, f.assets.shared)));
      });
    });

    await check("T09 retention protects historical/shared-tenant resources, receipts, activity images and derived audio", async () => {
      assert.equal(await retention.isObjectDeletionEnabled(db), false, "No test may enable physical object deletion");
      for (const key of [f.keys.shared, f.keys.current, f.keys.lease, f.keys.checkin, f.keys.audio.replace(/\.webm$/, ".m4a")]) {
        assert.equal(await retention.isKeyProtected(db, key), true, key);
      }
      assert.equal(await retention.isKeyProtected(db, f.keys.expired), false);
      assert.equal(await retention.isKeyProtected(db, f.keys.missing), false);
      await rollback(async (trx) => {
        await trx.deleteFrom("asset_resource").where("asset_id", "=", f.assets.shared).execute();
        assert.equal(await retention.isKeyProtected(trx, f.keys.shared), true, "another tenant still retains the physical key");
      }, "purge");
      const protectedKeys = await retention.collectProtectedKeys();
      assert.ok(protectedKeys.has(f.keys.audio.replace(/\.webm$/, ".m4a")));
      const report = await retention.releaseObjectsIfUnreferenced([f.keys.shared, f.keys.missing], { method: "TEST", path: "services-regression" });
      assert.deepEqual(report.removed, []);
      assert.deepEqual(report.failed, []);
      assert.deepEqual(report.kept, [f.keys.shared]);
      assert.deepEqual(report.candidates, [f.keys.missing]);
    });

    await check("T09 audio source and derived-file reuse share one lock domain", async () => {
      await rollback(async (trx) => {
        await retention.lockObjectKeys(trx, [f.keys.concurrentAudio]);
        await client.query("begin");
        try {
          const result = await client.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(hashtextextended($1,0)) acquired",
            [`object-key:${f.keys.concurrentAudio.replace(/\.webm$/, ".m4a")}`]);
          assert.equal(result.rows[0].acquired, false, "holding the source key must also serialize compatibility-file reuse/deletion");
        } finally { await client.query("rollback"); }
      });
    });


    await check("T19 a team with zero collections uploads, creates, edits, composes, publishes and copies without any workspace", async () => {
      const solo = f.organizations.solo;
      const collections = async () => Number((await db.selectFrom("workspace").select(({ fn }) => fn.countAll<number>().as("n")).where("organization_id", "=", solo).executeTakeFirstOrThrow()).n);
      assert.equal(await collections(), 0);
      const scope = await receipts.resolveUploadScope(db, actors.unassigned, { organizationId: solo, workspaceId: null });
      assert.equal(scope.workspaceId, null, "an organization-only upload needs no collection");
      const key = `assets/${f.run}/solo-model.glb`;
      const receipt = await db.transaction().execute(async (trx) => {
        await retention.lockObjectKeys(trx, [key]);
        return receipts.issueReceipt(trx, { organizationId: solo, workspaceId: null, userId: f.users.unassigned, storageKey: key, contentHash: `${f.run}-solo-hash`,
          mimeType: "model/gltf-binary", sizeBytes: 64, uploadType: "model", purpose: "asset", reused: false });
      });
      assert.equal(receipts.receiptDto(receipt).workspace_id, null);
      assert.equal(await retention.isKeyProtected(db, key), true, "an organization-only receipt still leases its object");
      const body = (idempotencyKey: string) => ({
        name: "solo model", fileType: "model", payload: { kind: "model", animations: [{ index: 0, name: "idle", duration_seconds: 2 }] },
        resources: [{ role: "primary", receiptId: receipt.id }], idempotencyKey: `${f.run}-${idempotencyKey}`,
      });
      await rejectCode(() => assetService.createAssetInOrganization(actors.owner, solo, body("solo-other-user")), "RECEIPT_INVALID");
      await rejectCode(() => assetService.createAssetInOrganization(actors.unassigned, f.organizations.team, body("solo-cross-org")), "RECEIPT_INVALID");
      await rejectCode(() => assetService.createAssetInOrganization(actors.viewer, solo, body("solo-viewer")), "FORBIDDEN");
      await rejectCode(() => assetService.createAssetInOrganization(actors.unassigned, solo, { ...body("solo-placement"), placement: { location: { longitude: 1, latitude: 1 } } }), "VALIDATION_FAILED");
      const created = await assetService.createAssetInOrganization(actors.unassigned, solo, body("solo-create"));
      const replay = await assetService.createAssetInOrganization(actors.unassigned, solo, body("solo-create"));
      assert.equal(created.created, true);
      assert.equal(replay.created, false);
      assert.equal(replay.asset.id, created.asset.id);
      await rejectCode(() => assetService.createAssetInOrganization(actors.unassigned, solo, { ...body("solo-create"), name: "different body" }), "IDEMPOTENCY_CONFLICT");
      assert.equal(created.asset.origin_workspace_id, null);
      assert.equal(created.asset.visibility, "organization");
      assert.equal(created.placement, null);
      assert.equal(created.asset.resources[0].storage_key, key);
      assert.ok((await db.selectFrom("upload_receipt").select("consumed_at").where("id", "=", receipt.id).executeTakeFirstOrThrow()).consumed_at);
      const sceneBody = { name: "solo scene", document: assetDocument(created.asset.id), idempotencyKey: `${f.run}-solo-scene` };
      const scene = await sceneService.createOrganizationScene(actors.unassigned, solo, sceneBody);
      assert.equal(scene.workspace_id, null);
      assert.equal(scene.capabilities.can_edit, true);
      assert.equal((await sceneService.createOrganizationScene(actors.unassigned, solo, sceneBody)).id, scene.id, "idempotent replay");
      await rejectCode(() => sceneService.createOrganizationScene(actors.viewer, solo, { name: "viewer scene" }), "FORBIDDEN");
      const v2 = await assetService.updateAsset(actors.owner, created.asset.id, {
        payload: { kind: "model" }, resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/solo-v2.glb" }],
        expectedLockVersion: created.asset.lock_version,
      });
      assert.equal(v2.lock_version, created.asset.lock_version + 1);
      const draft = await sceneService.getScene(actors.viewer, scene.id);
      assert.equal(draft.referenced_resources[0].asset_id, created.asset.id, "the draft keeps its asset identity after an edit");
      assert.equal(draft.referenced_resources[0].url, "https://external-fixture.invalid/solo-v2.glb");
      assert.equal(draft.capabilities.can_edit, false, "viewers read but do not edit");
      assert.equal((await sceneService.loadSceneForPlayback(db, scene.id))?.resources[0].asset_id, created.asset.id);
      const saved = await sceneService.saveScene(actors.unassigned, scene.id, { expectedLockVersion: scene.lock_version, name: "solo scene renamed" });
      await rejectCode(() => sceneService.saveScene(actors.owner, scene.id, { expectedLockVersion: scene.lock_version, name: "stale tab" }), "LOCK_VERSION_CONFLICT");
      await rejectCode(() => sceneService.saveScene(actors.viewer, scene.id, { expectedLockVersion: saved.lock_version, name: "viewer" }), "FORBIDDEN");
      const copy = await sceneService.copyScene(actors.unassigned, scene.id, { idempotencyKey: `${f.run}-solo-scene-copy` });
      assert.equal(copy.workspace_id, null);
      assert.notEqual(copy.id, scene.id);
      const duplicate = await assetService.duplicateAsset(actors.unassigned, created.asset.id, { idempotencyKey: `${f.run}-solo-duplicate` });
      assert.equal(duplicate.asset.origin_workspace_id, null);
      assert.equal(duplicate.asset.resources[0].external_url, "https://external-fixture.invalid/solo-v2.glb");
      assert.deepEqual(new Set((await sceneService.listOrganizationScenes(actors.viewer, solo)).map((item) => item.id)), new Set([scene.id, copy.id]));
      assert.deepEqual((await sceneService.listOrganizationScenes(actors.viewer, solo, { state: "archived" })).map((item) => item.id), []);
      assert.ok((await assetService.listOrganizationAssets(actors.viewer, solo, {})).data.some((item) => item.id === created.asset.id));
      await rejectCode(() => sceneService.listOrganizationScenes(actors.foreign, solo), "FORBIDDEN");
      await rejectCode(() => sceneService.getScene(actors.maintainer, scene.id), "NOT_FOUND");
      await rejectCode(() => assetService.getAssetDetail(actors.maintainer, created.asset.id), "NOT_FOUND");
      assert.equal(await collections(), 0, "no hidden default workspace was created");
      assert.deepEqual(await projects.listCollections(actors.viewer, solo, { state: "all" }), []);
    });

    await check("T01/T02 team catalog: every member lists every team asset; writers edit without being maintainers", async () => {
      const expected = new Set([f.assets.shared, f.assets.restricted, f.assets.audio, f.assets.image]);
      for (const name of ["editor", "unassigned", "viewer", "maintainer"] as const) {
        const listed = await assetService.listOrganizationAssets(actors[name], f.organizations.team, {});
        assert.deepEqual(new Set(listed.data.map((item) => item.id)), expected, `${name} lists the whole team catalog`);
      }
      const collection = await assetService.listWorkspaceAssets(actors.unassigned, f.workspaces.b, {});
      assert.deepEqual(new Set(collection.data.map((item) => item.id)), expected, "the collection path needs no grant or assignment");
      assert.ok(collection.data.every((item) => item.capabilities.can_maintain && item.capabilities.can_use_in_workspace === true));
      const viewerRows = await assetService.listWorkspaceAssets(actors.viewer, f.workspaces.b, {});
      assert.ok(viewerRows.data.every((item) => !item.capabilities.can_maintain && item.capabilities.can_use_in_workspace === false));
      const shared = await assetService.listOrganizationAssets(actors.editor, f.organizations.team, { view: "shared" });
      assert.equal(shared.data.some((item) => item.id === f.assets.restricted), false, "view=shared is only a visibility metadata filter");
      assert.equal((await assetService.listOrganizationAssets(actors.editor, f.organizations.team, { view: "all" })).data.some((item) => item.id === f.assets.restricted), true);
      const detail = await assetService.getAssetDetail(actors.unassigned, f.assets.restricted);
      assert.equal(detail.capabilities.can_maintain, true);
      await rejectCode(() => assetService.getAssetDetail(actors.foreign, f.assets.shared), "NOT_FOUND");
      await rejectCode(() => assetService.getAssetUsage(actors.foreign, f.assets.shared), "NOT_FOUND");
      await rejectCode(() => assetService.listOrganizationAssets(actors.foreign, f.organizations.team, {}), "FORBIDDEN");
      await rejectCode(() => assetService.listWorkspaceAssets(actors.foreign, f.workspaces.b, {}), "NOT_FOUND");
      const own = await assetService.createAssetInOrganization(actors.maintainer, f.organizations.team, {
        name: "maintained by someone else", fileType: "model", visibility: "restricted", payload: { kind: "model" },
        resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/maintained-v1.glb" }], idempotencyKey: `${f.run}-maintained-elsewhere`,
      });
      assert.equal(own.asset.maintained_by, f.users.maintainer);
      await rejectCode(() => assetService.updateAsset(actors.viewer, own.asset.id, {
        payload: { kind: "model" }, resources: [{ role: "primary", externalUrl: "https://fixture.invalid/no.glb" }], expectedLockVersion: own.asset.lock_version,
      }), "FORBIDDEN");
      const v2 = await assetService.updateAsset(actors.unassigned, own.asset.id, {
        payload: { kind: "model" }, resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/maintained-v2.glb" }],
        expectedLockVersion: own.asset.lock_version,
      });
      assert.equal(v2.lock_version, own.asset.lock_version + 1);
      assert.equal(v2.maintained_by, f.users.maintainer, "responsibility metadata is unchanged by a teammate's version");
      const renamed = await assetService.updateAsset(actors.editor, own.asset.id, { name: "renamed by teammate", expectedLockVersion: v2.lock_version });
      assert.equal(renamed.name, "renamed by teammate");
      await rejectCode(() => assetService.updateAsset(actors.editor, own.asset.id, { maintainedBy: f.users.editor, expectedLockVersion: renamed.lock_version }), "FORBIDDEN");
      const transferred = await assetService.updateAsset(actors.owner, own.asset.id, { maintainedBy: f.users.editor, expectedLockVersion: renamed.lock_version });
      assert.equal(transferred.maintained_by, f.users.editor);
      const archived = await assetService.archiveAsset(actors.unassigned, own.asset.id, transferred.lock_version);
      assert.equal(archived.asset.state, "archived");
      const restored = await assetService.updateAsset(actors.editor, own.asset.id, { state: "active", expectedLockVersion: archived.asset.lock_version });
      assert.equal(restored.state, "active");
    });

    await check("T05/T06 asset creation retries are idempotent; edits use locks and maintenance requires current lock", async () => {
      const body = { name: "idempotent model", fileType: "model", payload: { kind: "model" },
        resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/created.glb" }], idempotencyKey: `${f.run}-asset-create` };
      const first = await assetService.createAssetForCollection(actors.maintainer, f.workspaces.a, body);
      const replay = await assetService.createAssetForCollection(actors.maintainer, f.workspaces.a, body);
      assert.equal(first.created, true);
      assert.equal(replay.created, false);
      assert.equal(replay.asset.id, first.asset.id);
      assert.equal(replay.asset.id, first.asset.id);
      await rejectCode(() => assetService.createAssetForCollection(actors.maintainer, f.workspaces.a, { ...body, name: "different request" }), "IDEMPOTENCY_CONFLICT");
      await rejectCode(() => assetService.updateAsset(actors.maintainer, first.asset.id, { name: "missing lock" }), "LOCK_VERSION_REQUIRED");
      const changed = await assetService.updateAsset(actors.maintainer, first.asset.id, { name: "renamed", expectedLockVersion: first.asset.lock_version });
      assert.ok(changed.lock_version > first.asset.lock_version);
      await rejectCode(() => assetService.updateAsset(actors.maintainer, first.asset.id, { name: "stale", expectedLockVersion: first.asset.lock_version }), "LOCK_VERSION_CONFLICT");
      const newVersion = { payload: { kind: "model" }, resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/new.glb" }],
        expectedLockVersion: changed.lock_version };
      const appended = await assetService.updateAsset(actors.maintainer, first.asset.id, newVersion);
      await rejectCode(() => assetService.updateAsset(actors.maintainer, first.asset.id, newVersion), "LOCK_VERSION_CONFLICT");
      assert.equal(appended.id, first.asset.id);
      assert.equal(appended.resources[0].url, "https://external-fixture.invalid/new.glb");
      const concurrent = await Promise.allSettled([
        assetService.updateAsset(actors.editor, first.asset.id, { expectedLockVersion: appended.lock_version, payload: {kind:"model"}, resources:[{role:"primary",externalUrl:"https://fixture.invalid/a.glb"}] }),
        assetService.updateAsset(actors.editor, first.asset.id, { expectedLockVersion: appended.lock_version, payload: {kind:"model"}, resources:[{role:"primary",externalUrl:"https://fixture.invalid/b.glb"}] }),
      ]);
      assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = concurrent.find((r) => r.status === "rejected");
      assert.ok(rejected?.status === "rejected" && rejected.reason.code === "LOCK_VERSION_CONFLICT");
      assert.equal((await assetService.getAssetDetail(actors.maintainer, first.asset.id)).resources.length, 1);
    });


    await check("T01/T08 any writer reuses a formerly restricted team asset's files without a grant; tenants stay separate", async () => {
      const reused = await assetService.createAssetForCollection(actors.editor, f.workspaces.empty, {
        name: "reuse without grant", fileType: "model", payload: { kind: "model" },
        resources: [{ role: "primary", fromAssetId: f.assets.restricted, fromRole: "primary" }], idempotencyKey: `${f.run}-source-reuse`,
      });
      assert.equal(reused.asset.resources[0].storage_key, f.keys.restricted);
      assert.equal(reused.asset.origin_workspace_id, f.workspaces.empty);
      const body = (key: string, resources: unknown[]) => ({ name: "denied", fileType: "model", payload: { kind: "model" }, resources, idempotencyKey: `${f.run}-${key}` });
      const external = [{ role: "primary", externalUrl: "https://fixture.invalid/denied.glb" }];
      await rejectCode(() => assetService.createAssetInOrganization(actors.viewer, f.organizations.team, body("viewer-create", external)), "FORBIDDEN");
      await rejectCode(() => assetService.createAssetInOrganization(actors.foreign, f.organizations.team, body("foreign-create", external)), "FORBIDDEN");
      await rejectCode(() => assetService.createAssetInOrganization(actors.editor, f.organizations.team,
        body("foreign-bytes", [{ role: "primary", fromAssetId: f.assets.foreign, fromRole: "primary" }])), "NOT_FOUND");
    });

    await check("T08 archived source bytes cannot be imported through generic fromAssetId as new content", async () => {
      const duplicate = await assetService.duplicateAsset(actors.editor, f.assets.restricted, {
        targetWorkspaceId: f.workspaces.b, name: "archive source", idempotencyKey: `${f.run}-archive-source`,
      });
      const archived = await assetService.archiveAsset(actors.editor, duplicate.asset.id, duplicate.asset.lock_version);
      assert.equal(archived.asset.state, "archived");
      const retained = await assetService.getAssetDetail(actors.editor, duplicate.asset.id);
      assert.equal(retained.id, duplicate.asset.id);
      await rejectCode(() => assetService.createAssetForCollection(actors.editor, f.workspaces.b, {
        name: "archived resource bypass", fileType: "model", payload: { kind: "model" },
        resources: [{ role: "primary", fromAssetId: duplicate.asset.id, fromRole: "primary" }], idempotencyKey: `${f.run}-archive-bypass`,
      }), "ARCHIVED");
    });

    await check("T02/T04/T05 Scene service shares current content across aliases and serializes conflicting draft saves", async () => {
      const scene = await sceneService.createOrganizationScene(actors.editor, f.organizations.team, { name: "two-version composition" });
      assert.equal(scene.workspace_id, null, "scenes belong directly to the team");
      assert.equal(scene.organization_id, f.organizations.team);
      assert.equal(scene.document.schemaVersion, 6);
      assert.equal(scene.document.content.durationSeconds, 10);
      assert.equal(scene.document.content.loop, false);
      assert.deepEqual(scene.document.content.assets, {});
      await rejectCode(() => sceneService.saveScene(actors.editor, scene.id, { name: "missing lock" }), "LOCK_VERSION_REQUIRED");
      const dual = assetDocument(f.assets.shared);
      dual.content.assets.newer = { assetId: f.assets.shared };
      dual.content.instances.push({ ...(dual.content.instances[0] as Record<string, unknown>), id: "new-instance", asset: "newer" });
      const results = await Promise.allSettled([
        sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: scene.lock_version, document: dual, name: "left tab" }),
        sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: scene.lock_version, document: dual, name: "right tab" }),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = results.find((result) => result.status === "rejected");
      assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ContentError && rejected.reason.code === "LOCK_VERSION_CONFLICT");
      const saved = await sceneService.getScene(actors.editor, scene.id);
      assert.deepEqual(new Set(saved.referenced_resources.map((resource) => resource.asset_id)), new Set([f.assets.shared, f.assets.shared]));
      assert.equal(new Set(saved.referenced_resources.map((resource) => resource.url)).size, 1);
      await rejectCode(() => sceneService.getScene(actors.foreign, scene.id), "NOT_FOUND");
      assert.equal((await sceneService.getScene(actors.viewer, scene.id)).capabilities.can_edit, false);
      await rejectCode(() => sceneService.saveScene(actors.viewer, scene.id, { expectedLockVersion: saved.lock_version, name: "viewer write" }), "FORBIDDEN");
      const invalidClip = structuredClone(dual);
      invalidClip.content.instances[0] = { ...(invalidClip.content.instances[0] as Record<string, unknown>), animation: { clipIndex: 99, startSeconds: 0, loop: false } };
      await rejectCode(() => sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: saved.lock_version, document: invalidClip }), "VALIDATION_FAILED");
      assert.equal((await sceneService.getScene(actors.editor, scene.id)).lock_version, saved.lock_version, "failed clip validation cannot mutate the draft");
    });

    await check("Scene saves update every map and direct QR preview; empty saves and archive behavior are explicit", async () => {
      const scene = await sceneService.createOrganizationScene(actors.editor, f.organizations.team, { name: "live scene", document: assetDocument(f.assets.shared) });
      const placed = await Promise.all([f.workspaces.a, f.workspaces.b].map((workspace) => placementService.createPlacement(actors.editor, workspace, {
        target: { kind: "scene", sceneId: scene.id }, location: { longitude: 121.5, latitude: 31.2 }, renderConfig: { config: { scale: 2 } },
      })));
      const document = assetDocument(f.assets.shared); document.content.durationSeconds = 23;
      document.content.lighting = { ...DEFAULT_SCENE_LIGHTING, directionalIntensity: 3.5, environmentRotation: 70 };
      const saved = await sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: scene.lock_version, document });
      for (const item of placed) {
        const manifest = await runtime.sceneManifest(item.placement.id, { workspaceId: item.placement.workspace_id, organizationId: f.organizations.team });
        assert.equal(manifest.content.durationSeconds, 23);
        assert.equal(manifest.schemaVersion, 10); assert.deepEqual(manifest.content.lighting, document.content.lighting);
        assert.equal((await placementService.getPlacement(actors.editor, item.placement.id)).lock_version, item.placement.lock_version);
      }
      const preview = await runtime.previewSceneManifest(scene.id, f.organizations.team);
      assert.equal(preview.assetId, scene.id); assert.equal(preview.content.durationSeconds, 23);
      assert.deepEqual(preview.content.lighting, document.content.lighting);
      await assert.rejects(() => runtime.previewSceneManifest(scene.id, f.organizations.foreign), runtime.RuntimeNotFound);
      const empty = { ...document, content: { ...document.content, assets: {}, instances: [] } };
      const cleared = await sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: saved.lock_version, document: empty });
      assert.equal((await runtime.previewSceneManifest(scene.id, f.organizations.team)).content.instances.length, 0);
      assert.equal((await runtime.sceneManifest(placed[0].placement.id, { workspaceId: f.workspaces.a, organizationId: f.organizations.team })).content.instances.length, 0);
      await sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: cleared.lock_version, state: "archived" });
      await assert.rejects(() => runtime.previewSceneManifest(scene.id, f.organizations.team), runtime.RuntimeNotFound);
      // Existing map references survive archival; new references do not.
      assert.equal((await runtime.sceneManifest(placed[0].placement.id, { workspaceId: f.workspaces.a, organizationId: f.organizations.team })).content.instances.length, 0);
      await rejectCode(() => placementService.createPlacement(actors.editor, f.workspaces.b, { target: { kind: "scene", sceneId: scene.id }, location: { longitude: 1, latitude: 1 } }), "ARCHIVED");
      await rollback(async (trx) => {
        await trx.updateTable("organization").set({ archived_at: new Date() }).where("id", "=", f.organizations.team).execute();
      });
    });

    await check("Performance scenes persist independent text and authorized media with concurrent-save protection", async () => {
      const assetCount = async () => Number((await db.selectFrom("asset").select(({ fn }) => fn.countAll<number>().as("n")).where("organization_id", "=", f.organizations.team).executeTakeFirstOrThrow()).n);
      const before = await assetCount();
      const textDocument = createBlankSceneDocument();
      textDocument.content.instances = [{ id: "title", text: { content: "第一幕", color: "#ffffff", fontSize: .25, width: 3, align: "center" }, position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null,
        timing: { startSeconds: 1, endSeconds: 8, fadeInSeconds: .5, fadeOutSeconds: 1 } }];
      const scene = await sceneService.createOrganizationScene(actors.editor, f.organizations.team, { name: "Performance", document: textDocument });
      assert.equal(await assetCount(), before, "scene text never creates a team asset");
      assert.deepEqual(scene.document, textDocument);
      assert.deepEqual(scene.referenced_resources, []);
      const document = structuredClone(textDocument);
      const created = [];
      for (const kind of ["image", "audio", "video"] as const) {
        const asset = await assetService.createAssetInOrganization(actors.editor, f.organizations.team, { name: `Performance ${kind}`, fileType: kind, payload: { kind }, idempotencyKey: `${f.run}-performance-${kind}`, resources: [{ role: "primary", externalUrl: `https://fixture.invalid/performance.${kind === "image" ? "png" : kind === "audio" ? "mp3" : "mp4"}` }] });
        created.push(asset.asset);
        document.content.assets[kind] = { assetId: asset.asset.id };
        document.content.instances.push({ id: kind, asset: kind, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null,
          timing: { startSeconds: 2, endSeconds: 9, fadeInSeconds: 0, fadeOutSeconds: 1 },
          ...(kind !== "image" ? { media: { trimStartSeconds: 1, trimEndSeconds: 8, playbackRate: 1, volume: .7, muted: false, loop: true } } : {}) });
      }
      await rejectCode(() => sceneService.saveScene(actors.viewer, scene.id, { expectedLockVersion: scene.lock_version, document }), "FORBIDDEN");
      const saved = await sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: scene.lock_version, document });
      assert.deepEqual(saved.document, document);
      assert.deepEqual(saved.referenced_resources.map(resource => resource.file_type).sort(), ["audio", "image", "video"]);
      const manifest = await runtime.previewSceneManifest(scene.id, f.organizations.team);
      assert.equal(manifest.schemaVersion, 7);
      assert.equal(manifest.resources.video.kind, "video");
      assert.equal(manifest.content.instances[0].text?.content, "第一幕");
      await rejectCode(() => sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: scene.lock_version, document }), "LOCK_VERSION_CONFLICT");
      const crossTeam = structuredClone(document); crossTeam.content.assets.video.assetId = f.assets.foreign;
      await rejectCode(() => sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: saved.lock_version, document: crossTeam }), "NOT_FOUND");
      const invalidKind = structuredClone(document); invalidKind.content.instances[1].media = { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, volume: 1, loop: false, muted: false };
      await rejectCode(() => sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: saved.lock_version, document: invalidKind }), "VALIDATION_FAILED");
      const copy = await sceneService.copyScene(actors.editor, scene.id, { name: "Performance copy" });
      assert.deepEqual(copy.document, document);
      assert.equal(await assetCount(), before + 3, "copying scene-owned text shares media without adding text to asset library");
      await assetService.archiveAsset(actors.editor, created[0].id, created[0].lock_version);
      const retained = await sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: saved.lock_version, document });
      await rejectCode(() => sceneService.createOrganizationScene(actors.editor, f.organizations.team, { name: "Archived media reuse", document }), "ARCHIVED");
      const cleared = await sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: retained.lock_version, document: textDocument });
      assert.deepEqual(cleared.referenced_resources, []);
      assert.equal((await db.selectFrom("scene_asset_ref").select("asset_id").where("scene_id", "=", scene.id).execute()).length, 0);
    });

    await check("T08 an archive committed while a new Scene reference waits on the asset row refuses that reference", async () => {
      const asset = await assetService.createAssetInOrganization(actors.maintainer, f.organizations.team, {
        name: "archive race model", fileType: "model", payload: { kind: "model" },
        resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/archive-race.glb" }], idempotencyKey: `${f.run}-archive-race`,
      });
      const scene = await sceneService.createOrganizationScene(actors.editor, f.organizations.team, { name: "archive race" });
      let pending: Promise<PromiseSettledResult<unknown>> | undefined;
      await client.query("begin");
      try {
        await client.query("select set_config('content_model.writer','content',true)");
        await client.query("select id from asset where id=$1 for update", [asset.asset.id]);
        pending = sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: scene.lock_version, document: assetDocument(asset.asset.id) })
          .then((value): PromiseFulfilledResult<unknown> => ({ status: "fulfilled", value }), (reason): PromiseRejectedResult => ({ status: "rejected", reason }));
        assert.equal(await waitForBlockedBy(), true, "the new reference must wait on the asset row lock");
        await client.query("update asset set state='archived', archived_at=now(), lock_version=lock_version+1 where id=$1", [asset.asset.id]);
        await client.query("commit");
        const result = await pending;
        assert.equal(result.status, "rejected", "a reference committed after the archive is refused");
        if (result.status === "rejected") assert.ok(result.reason instanceof ContentError && result.reason.code === "ARCHIVED");
        assert.equal((await db.selectFrom("scene_asset_ref").select("asset_id").where("scene_id", "=", scene.id).execute()).length, 0);
      } finally {
        await client.query("rollback");
        if (pending) await pending;
      }
    });


    await check("T20 collections: writers create, rename, archive and restore; archiving never changes team assets or scenes", async () => {
      const created = await projects.createCollection(actors.unassigned, f.organizations.team, { name: "  new map  ", description: "east gate" });
      assert.equal(created.name, "new map");
      assert.equal(created.description, "east gate");
      assert.equal(created.capabilities.can_edit, true);
      await rejectCode(() => projects.createCollection(actors.viewer, f.organizations.team, { name: "viewer map" }), "FORBIDDEN");
      await rejectCode(() => projects.createCollection(actors.foreign, f.organizations.team, { name: "foreign map" }), "FORBIDDEN");
      await rejectCode(() => projects.createCollection(actors.unassigned, f.organizations.team, { name: " " }), "VALIDATION_FAILED");
      await rejectCode(() => projects.createCollection(actors.unassigned, f.organizations.team, { name: "x", members: [] }), "VALIDATION_FAILED");
      const renamed = await projects.updateCollection(actors.editor, created.id, { name: "renamed map", description: null });
      assert.equal(renamed.name, "renamed map");
      assert.equal(renamed.description, null);
      await rejectCode(() => projects.updateCollection(actors.viewer, created.id, { name: "viewer rename" }), "FORBIDDEN");
      await rejectCode(() => projects.getCollection(actors.foreign, created.id), "NOT_FOUND");
      const model = await assetService.createAssetInOrganization(actors.editor, f.organizations.team, {
        name: "collection model", fileType: "model", payload: { kind: "model" },
        resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/collection.glb" }], idempotencyKey: `${f.run}-collection-model`,
      });
      const scene = await sceneService.createOrganizationScene(actors.editor, f.organizations.team, { name: "collection scene", document: assetDocument(model.asset.id) });
      const placed = (await placementService.createPlacement(actors.unassigned, created.id, {
        target: { kind: "scene", sceneId: scene.id }, location: { longitude: 121.51, latitude: 31.21 },
      })).placement;
      const direct = (await placementService.createPlacement(actors.unassigned, created.id, {
        target: { kind: "asset", assetId: model.asset.id }, location: { longitude: 121.52, latitude: 31.21 },
      })).placement;
      const scope = { workspaceId: created.id, organizationId: f.organizations.team };
      const discovered = (await runtime.nearbyPlacements(scope, 31.21, 121.51, 2000)).map((item) => item.id);
      assert.ok(discovered.includes(placed.public_id) && discovered.includes(direct.public_id), "a new collection is a mini-program scope (old p_workspace_id parameter)");
      assert.equal((await runtime.sceneManifest(placed.public_id, scope)).assetId, placed.public_id);
      const fingerprint = async () => JSON.stringify([
        await db.selectFrom("asset").selectAll().where("id", "=", model.asset.id).executeTakeFirstOrThrow(),
        await db.selectFrom("scene").selectAll().where("id", "=", scene.id).executeTakeFirstOrThrow(),
        await db.selectFrom("asset").select("id").where("id", "=", model.asset.id).execute(),
      ]);
      const before = await fingerprint();
      await rejectCode(() => projects.setWorkspaceArchived(actors.viewer, created.id, true), "FORBIDDEN");
      const archived = await projects.setWorkspaceArchived(actors.unassigned, created.id, true);
      assert.ok(archived.archived_at);
      assert.equal(archived.capabilities.can_edit, false);
      assert.equal(archived.capabilities.can_archive, true);
      assert.equal(await fingerprint(), before, "archiving a collection never changes team assets or scenes");
      assert.equal((await runtime.nearbyPlacements(scope, 31.21, 121.51, 2000)).length, 0, "an archived collection stops its public entries");
      await rejectCode(() => placementService.updatePlacement(actors.editor, direct.id, { expectedLockVersion: direct.lock_version, status: "paused" }), "ARCHIVED");
      await rejectCode(() => placementService.createPlacement(actors.editor, created.id, {
        target: { kind: "asset", assetId: model.asset.id }, location: { longitude: 121.53, latitude: 31.21 },
      }), "ARCHIVED");
      await rejectCode(() => projects.updateCollection(actors.editor, created.id, { name: "renamed while archived" }), "ARCHIVED");
      const stillEditable = await sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: scene.lock_version, name: "edited while collection archived" });
      assert.equal(stillEditable.capabilities.can_edit, true, "team scenes do not depend on collections");
      await assetService.updateAsset(actors.editor, model.asset.id, { name: "renamed while collection archived", expectedLockVersion: model.asset.lock_version });
      assert.equal((await projects.listCollections(actors.viewer, f.organizations.team, {})).some((item) => item.id === created.id), false);
      assert.ok((await projects.listCollections(actors.viewer, f.organizations.team, { state: "archived" })).some((item) => item.id === created.id));
      assert.ok((await projects.listCollections(actors.viewer, f.organizations.team, { state: "all" })).some((item) => item.id === created.id));
      const restored = await projects.setWorkspaceArchived(actors.editor, created.id, false);
      assert.equal(restored.archived_at, null);
      const paused = await placementService.updatePlacement(actors.editor, direct.id, { expectedLockVersion: direct.lock_version, status: "paused" });
      assert.equal(paused.status, "paused");

    });


    await check("T21 a real sign-up bootstraps a personal team with zero collections; scenes keep a direct tenant FK", async () => {
      const newcomer = randomUUID();
      let personal: string | undefined;
      try {
        await client.query("insert into auth.users(id,name,email) values($1,'newcomer',$2)", [newcomer, `${f.run}-newcomer@example.test`]);
        const org = (await client.query<{ id: string }>(
          "select id from organization where created_by=$1", [newcomer])).rows;
        assert.equal(org.length, 1, "exactly one personal team");
        personal = org[0].id;
        assert.equal(Number((await client.query("select count(*) n from workspace where organization_id=$1", [personal])).rows[0].n), 0, "no default workspace");
        assert.equal((await client.query("select role from organization_member where organization_id=$1 and user_id=$2", [personal, newcomer])).rows[0]?.role, "owner");
        const actor = await access.loadActor(db, newcomer);
        const asset = await assetService.createAssetInOrganization(actor, personal, {
          name: "first model", fileType: "model", payload: { kind: "model" },
          resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/newcomer.glb" }], idempotencyKey: `${f.run}-newcomer-asset`,
        });
        await sceneService.createOrganizationScene(actor, personal, { name: "first scene", document: assetDocument(asset.asset.id) });
        assert.deepEqual(await projects.listCollections(actor, personal, { state: "all" }), []);
        // Isolate the tenant FK: malformed documents fail the schema CHECK first.
        await rejectSql("insert into scene(organization_id,name,document) values($1,'orphan',$2::jsonb)", [randomUUID(), JSON.stringify(createBlankSceneDocument())], "23503");
        await rejectSql("delete from organization where id=$1", [personal], "23503");
        await client.query("begin");
        try {
          await client.query("select set_config('content_model.writer','purge',true)");
          await client.query("delete from scene_asset_ref where organization_id=$1", [personal]);
          await client.query("delete from asset where organization_id=$1", [personal]);
          await client.query("savepoint only_scene");
          await assert.rejects(client.query("delete from organization where id=$1", [personal]), (error: { code?: string }) => error.code === "23503", "a remaining team scene alone blocks deletion");
          await client.query("rollback to savepoint only_scene");
        } finally { await client.query("rollback"); }
      } finally {
        if (personal) await client.query("select purge_organizations(array[$1]::uuid[])", [personal]);
        await client.query("delete from auth.users where id=$1", [newcomer]);
      }
    });

    await check("T07 independent placements move/pause/copy/upgrade/archive without mutating their sibling or source", async () => {
      const first = await placementService.getPlacement(actors.editor, f.placements.first);
      const sibling = await placementService.getPlacement(actors.editor, f.placements.second);
      assert.equal(first.public_id, first.id);
      assert.equal(first.target.kind, "asset");
      await rejectCode(() => placementService.getPlacement(actors.foreign, first.id), "NOT_FOUND");
      await rejectCode(() => placementService.updatePlacement(actors.viewer, first.id, { expectedLockVersion: first.lock_version, status: "paused" }), "FORBIDDEN");
      await rejectCode(() => placementService.updatePlacement(actors.editor, first.id, { status: "paused" }), "LOCK_VERSION_REQUIRED");
      const moved = await placementService.updatePlacement(actors.editor, first.id, {
        expectedLockVersion: first.lock_version, location: { longitude: 121.6, latitude: 31.3, altitude: 4 }, status: "paused",
      });
      assert.equal(moved.status, "paused");
      assert.deepEqual(moved.location, { longitude: 121.6, latitude: 31.3, altitude: 4 });
      await rejectCode(() => placementService.updatePlacement(actors.editor, first.id, { expectedLockVersion: first.lock_version, status: "active" }), "LOCK_VERSION_CONFLICT");
      const copy = await placementService.copyPlacement(actors.editor, first.id, { idempotencyKey: `${f.run}-copy-placement` });
      const replay = await placementService.copyPlacement(actors.editor, first.id, { idempotencyKey: `${f.run}-copy-placement` });
      assert.equal(replay.placement.id, copy.placement.id);
      assert.equal(replay.created, false);
      assert.notEqual(copy.placement.id, first.id);
      assert.equal(copy.placement.public_id, copy.placement.id);
      assert.deepEqual(copy.placement.target, moved.target);
      const upgraded = await placementService.updatePlacement(actors.editor, copy.placement.id, {
        expectedLockVersion: copy.placement.lock_version, target: { kind: "asset", assetId: f.assets.shared },
      });
      assert.ok(upgraded.target.kind === "asset" && upgraded.target.asset_id === f.assets.shared);
      const archived = await placementService.archivePlacement(actors.editor, copy.placement.id, upgraded.lock_version);
      assert.equal(archived.status, "archived");
      assert.deepEqual(await placementService.getPlacement(actors.editor, f.placements.second), sibling);
      assert.equal((await assetService.getAssetDetail(actors.maintainer, f.assets.shared)).id, f.assets.shared);
      assert.deepEqual((await placementService.getPlacement(actors.editor, first.id)).target, first.target);
    });

    await check("T05/T07 batch moves are atomic for stale locks, viewers and archived collections; writers move across collections", async () => {
      const one = await placementService.getPlacement(actors.editor, f.placements.first);
      const two = await placementService.getPlacement(actors.editor, f.placements.second);
      const move = (id: string, lock: number, longitude = 122) => ({ placementId: id, expectedLockVersion: lock, longitude, latitude: 32 });
      await rejectCode(() => placementService.movePlacements(actors.editor, { moves: [move(one.id, one.lock_version), move(two.id, two.lock_version + 99)] }), "LOCK_VERSION_CONFLICT");
      assert.deepEqual(await placementService.getPlacement(actors.editor, one.id), one);
      assert.deepEqual(await placementService.getPlacement(actors.editor, two.id), two);
      await rejectCode(() => placementService.movePlacements(actors.viewer, { moves: [move(one.id, one.lock_version)] }), "FORBIDDEN");
      const frozen = (await placementService.createPlacement(actors.editor, f.workspaces.secret, {
        target: { kind: "asset", assetId: f.assets.shared }, location: { longitude: 121.5, latitude: 31.2 },
      })).placement;
      await client.query("update workspace set archived_at=now() where id=$1", [f.workspaces.secret]);
      try {
        await rejectCode(() => placementService.movePlacements(actors.editor, { moves: [move(one.id, one.lock_version), move(frozen.id, frozen.lock_version)] }), "ARCHIVED");
      } finally { await client.query("update workspace set archived_at=null where id=$1", [f.workspaces.secret]); }
      assert.deepEqual(await placementService.getPlacement(actors.editor, one.id), one);
      const other = await placementService.getPlacement(actors.editor, f.placements.scene);
      const result = await placementService.movePlacements(actors.editor, { moves: [move(one.id, one.lock_version), move(two.id, two.lock_version), move(other.id, other.lock_version, 122.1)] });
      assert.equal(result.length, 3);
      assert.ok(result.every((item) => item.location?.latitude === 32));
    });

    await check("T02/T07 a saved team Scene is placed into two collections by any writers without copying the Scene; placements stay independent", async () => {
      const sourceAsset = await assetService.createAssetInOrganization(actors.maintainer, f.organizations.team, {
        name: "team scene model", fileType: "model", visibility: "restricted", payload: { kind: "model" },
        resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/team-scene-v1.glb" }], idempotencyKey: `${f.run}-team-scene-asset`,
      });
      const scene = await sceneService.createOrganizationScene(actors.maintainer, f.organizations.team, {
        name: "team fixed work", document: assetDocument(sourceAsset.asset.id),
      });
      assert.equal(scene.workspace_id, null);
      const scenesBefore = await sceneCount(f.organizations.team);
      const at = (longitude: number) => ({ target: { kind: "scene", sceneId: scene.id }, location: { longitude, latitude: 31.2 } });
      const inB = await placementService.createPlacement(actors.editor, f.workspaces.b, at(121.5));
      const inA = await placementService.createPlacement(actors.unassigned, f.workspaces.a, at(121.6));
      await rejectCode(() => placementService.createPlacement(actors.viewer, f.workspaces.b, at(121.7)), "FORBIDDEN");
      assert.equal(await sceneCount(f.organizations.team), scenesBefore, "placing never copies the Scene");
      assert.notEqual(inA.placement.id, inB.placement.id);
      for (const placed of [inA, inB])
        assert.ok(placed.placement.target.kind === "scene" && placed.placement.target.scene_id === scene.id && placed.placement.target.scene_workspace_id === null);
      assert.equal((await sceneService.getScene(actors.editor, scene.id)).placement_count, 2);
      const paused = await placementService.updatePlacement(actors.editor, inB.placement.id, {
        expectedLockVersion: inB.placement.lock_version, location: { longitude: 121.55, latitude: 31.25 }, status: "paused",
      });
      assert.equal(paused.status, "paused");
      assert.deepEqual(await placementService.getPlacement(actors.editor, inA.placement.id), inA.placement, "the sibling placement is untouched");
      await assetService.updateAsset(actors.editor, sourceAsset.asset.id, {
        payload: { kind: "model" }, resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/team-scene-v2.glb" }], expectedLockVersion: sourceAsset.asset.lock_version,
      });
      const fixed = await sceneService.loadSceneForPlayback(db, scene.id);
      assert.equal(fixed?.resources[0].asset_id, sourceAsset.asset.id, "asset edits retain publication identities");
      assert.ok(fixed?.resources[0].url?.endsWith("team-scene-v2.glb"));
      const newer = await sceneService.saveScene(actors.unassigned, scene.id, { expectedLockVersion: scene.lock_version, name: "later draft" });
      const sibling = await placementService.getPlacement(actors.editor, inA.placement.id);
      assert.ok(sibling.target.kind === "scene" && sibling.target.scene_name === "later draft");
      assert.equal(sibling.lock_version, inA.placement.lock_version, "scene edits do not overwrite placement settings or locks");
      const switched = await placementService.getPlacement(actors.editor, paused.id);
      await sceneService.saveScene(actors.maintainer, scene.id, { expectedLockVersion: newer.lock_version, state: "archived" });
      await rejectCode(() => placementService.createPlacement(actors.owner, f.workspaces.secret, at(121.8)), "ARCHIVED");
      const existing = await placementService.updatePlacement(actors.editor, switched.id, { expectedLockVersion: switched.lock_version, status: "active" });
      assert.equal(existing.status, "active");
    });

    await check("T08 archived Asset keeps existing placement controls and fixed files but blocks new placements and copies", async () => {
      const asset = await assetService.createAssetForCollection(actors.editor, f.workspaces.b, {
        name: "archived placement source", fileType: "text", payload: { kind: "text", text: "retained" }, resources: [], idempotencyKey: `${f.run}-archive-placement-asset`,
      });
      const body = { target: { kind: "asset", assetId: asset.asset.id }, location: { longitude: 121, latitude: 31 } };
      const placed = await placementService.createPlacement(actors.editor, f.workspaces.b, body);
      await assetService.archiveAsset(actors.editor, asset.asset.id, asset.asset.lock_version);
      await rejectCode(() => placementService.createPlacement(actors.editor, f.workspaces.b, body), "ARCHIVED");
      await rejectCode(() => placementService.copyPlacement(actors.editor, placed.placement.id, {}), "ARCHIVED");
      const changed = await placementService.updatePlacement(actors.editor, placed.placement.id, {
        expectedLockVersion: placed.placement.lock_version, target: body.target, status: "paused",
      });
      assert.equal(changed.status, "paused");
      assert.ok(changed.target.kind === "asset" && changed.target.asset_state === "archived");
      assert.equal((await assetService.getAssetDetail(actors.editor, asset.asset.id)).payload.kind, "text");
    });

    await check("T10/T18 upload-and-place is atomic and idempotent; media placements require discovery", async () => {
      const body = { asset: { name: "onsite text", fileType: "text", payload: { kind: "text", text: "onsite" }, resources: [] },
        idempotencyKey: `${f.run}-onsite`, location: { longitude: 121, latitude: 31 } };
      const first = await placementService.createPlacement(actors.editor, f.workspaces.b, body);
      const retry = await placementService.createPlacement(actors.editor, f.workspaces.b, body);
      assert.ok(first.asset && first.asset);
      assert.equal(first.placement.target.kind, "asset");
      assert.equal(retry.asset?.id, first.asset.id);
      assert.equal(retry.placement.id, first.placement.id);
      assert.equal(retry.created, false);
      const before = await db.selectFrom("asset").select("id").where("organization_id", "=", f.organizations.team).execute();
      await rejectCode(() => placementService.createPlacement(actors.editor, f.workspaces.b, { ...body, idempotencyKey: `${f.run}-invalid-onsite`, location: null }), "VALIDATION_FAILED");
      assert.equal((await db.selectFrom("asset").select("id").where("organization_id", "=", f.organizations.team).execute()).length, before.length);
      await rejectCode(() => placementService.createPlacement(actors.editor, f.workspaces.b, { target: { kind: "asset", assetId: f.assets.image } }), "VALIDATION_FAILED");
      await rejectCode(() => placementService.createPlacement(actors.editor, f.workspaces.b, { target: { kind: "asset", assetId: f.assets.shared } }), "VALIDATION_FAILED");
      await rejectCode(() => placementService.createPlacement(actors.editor, f.workspaces.b, { target: { kind: "asset", assetId: f.assets.foreign }, status: "draft" }), "NOT_FOUND");
    });






    await check("T11 public discovery uses independent collection placements and current assets", async () => {
      const ids = await seedRuntimeProjectionFixture(client, f, { kind: "model", payload: { kind: "model" },
        resources: [{ role: "primary", url: "https://external-fixture.invalid/runtime-v1.glb" }] });
      const copied = (await placementService.copyPlacement(actors.editor, ids.placement, { targetWorkspaceId: f.workspaces.b })).placement;
      const inA = { workspaceId: f.workspaces.a, organizationId: f.organizations.team };
      const inB = { workspaceId: f.workspaces.b, organizationId: f.organizations.team };
      const discover = async (scope: typeof inA) => (await runtime.nearbyPlacements(scope, 31.2, 121.5, 1000)).map((row) => row.id);
      assert.ok((await discover(inA)).includes(ids.placement));
      assert.ok(!(await discover(inB)).includes(ids.placement));
      assert.ok((await discover(inB)).includes(copied.id));
      await placementService.updatePlacement(actors.editor, copied.id, { expectedLockVersion: copied.lock_version, status: "paused" });
      assert.ok(!(await discover(inB)).includes(copied.id));
      assert.ok((await discover(inA)).includes(ids.placement));
      assert.deepEqual(await runtime.nearbyPlacements({ ...inA, organizationId: f.organizations.foreign }, 31.2, 121.5, 1000), []);
      for (const table of ["legacy_runtime_binding", "legacy_content_map", "asset_workspace_grant", "workspace_assignment"]) {
        assert.equal((await client.query("select to_regclass($1) relation", [`public.${table}`])).rows[0].relation, null);
      }
    });

    await check("T11 new link projection remains readable by the existing link consumer", async () => {
      const fresh = await placementService.createPlacement(actors.editor, f.workspaces.b, {
        asset: { name: "new link", fileType: "link", payload: { kind: "link", url: "https://example.test/article" }, resources: [] },
        idempotencyKey: `${f.run}-fresh-link`, location: { longitude: 121.5, latitude: 31.2 },
      });
      const current = (await runtime.nearbyPlacements({ workspaceId: f.workspaces.b, organizationId: f.organizations.team }, 31.2, 121.5, 50)).find((item) => item.id === fresh.placement.public_id);
      assert.ok(current);
      assert.deepEqual((current.config as Record<string, unknown>).link, parseLinkAssetInput("https://example.test/article"));
    });


    // Activity submission and archival races are covered in test-activities.ts.

    await check("T02 boundary-regression: same organization alone does not register an Anchor in a different collection", async () => {
      const anchor = await seedRuntimeProjectionFixture(client, f, { kind: "anchor", payload: { kind: "anchor" }, location: false });
      const permitted = await placementService.createPlacement(actors.maintainer, f.workspaces.a, {
        target: { kind: "asset", assetId: f.assets.shared }, anchorId: anchor.asset,
      });
      assert.equal(permitted.placement.anchor_id, anchor.asset, "the Anchor is usable in its actual collection A");
      const before = await db.selectFrom("placement").select("id").where("workspace_id", "=", f.workspaces.b).execute();
      let rejection: unknown;
      try {
        await placementService.createPlacement(actors.editor, f.workspaces.b, {
          target: { kind: "asset", assetId: f.assets.shared }, anchorId: anchor.asset,
        });
      } catch (error) { rejection = error; }
      const after = await db.selectFrom("placement").select("id").where("workspace_id", "=", f.workspaces.b).execute();
      assert.equal(after.length, before.length, "collection B must not gain an anchored Placement for an Anchor recognition never searches there");
      assert.ok(rejection instanceof ContentError && rejection.code === "VALIDATION_FAILED", "an Anchor outside the collection is rejected by the service");
    });

    await check("T12 anchor edits update every collection and invalidate in-flight descriptors", async () => {
      const { findNearbyAnchors } = await import("../lib/anchor/recognize.server");
      const { getMatchingAnchor } = await import("../lib/anchor/access.server");
      const anchor = await assetService.createAssetForCollection(actors.editor, f.workspaces.a, {
        name: "live anchor", fileType: "anchor", payload: { kind: "anchor" },
        resources: [{ role: "reference", externalUrl: "https://fixture.invalid/anchor-before.jpg" }],
        idempotencyKey: `${f.run}-live-anchor`, placement: { location: { longitude: 120, latitude: 30 } },
      });
      await placementService.createPlacement(actors.editor, f.workspaces.b, {target:{kind:"asset",assetId:anchor.asset.id},location:{longitude:120,latitude:30}});
      const generation = randomUUID();
      await client.query("insert into anchor_embedding(anchor_id,image_url,status,generation) values($1,$2,'pending',$3)",
        [anchor.asset.id,"https://fixture.invalid/anchor-before.jpg",generation]);
      await assetService.updateAsset(actors.editor, anchor.asset.id, {expectedLockVersion:anchor.asset.lock_version,
        payload:{kind:"anchor"},resources:[{role:"reference",externalUrl:"https://fixture.invalid/anchor-after.jpg"}]});
      assert.equal((await getMatchingAnchor(anchor.asset.id)).file_url,"https://fixture.invalid/anchor-after.jpg");
      for (const workspace of [f.workspaces.a,f.workspaces.b]) {
        const nearby = await findNearbyAnchors(workspace,{longitude:120,latitude:30,radius:100});
        assert.deepEqual(nearby.map((row)=>row.id),[anchor.asset.id]);
        assert.equal(nearby[0].file_url,"https://fixture.invalid/anchor-after.jpg");
      }
      assert.equal((await client.query("select * from anchor_embedding where anchor_id=$1",[anchor.asset.id])).rowCount,0);
      assert.equal((await client.query("update anchor_embedding set status='failed' where anchor_id=$1 and generation=$2",[anchor.asset.id,generation])).rowCount,0);
    });

    await check("T02 probe-content-regression: hash probes stay inside the team and never expose another actor's upload lease", async () => {
      const team = await access.requireOrgWrite(db, actors.editor, f.organizations.team);
      const maintainerTeam = await access.requireOrgWrite(db, actors.maintainer, f.organizations.team);
      const foreignOrg = await access.requireOrgWrite(db, actors.foreign, f.organizations.foreign);
      assert.equal(await receipts.findProbeKey(db, actors.editor, team, `hash-${f.assets.shared}`), f.keys.current, "published history remains discoverable by its own hash");
      assert.equal(await receipts.findProbeKey(db, actors.editor, team, `hash-${f.assets.restricted}`), f.keys.restricted, "formerly restricted team files are team-readable");
      assert.equal(await receipts.findProbeKey(db, actors.editor, team, `hash-${f.assets.foreign}`), null, "another tenant's file is never found");
      assert.equal(await receipts.findProbeKey(db, actors.foreign, foreignOrg, `hash-${f.assets.restricted}`), null, "a team hash is not disclosed to another tenant");
      assert.equal(await receipts.findProbeKey(db, actors.editor, team, `receipt-${f.receipts.active}`), null, "another actor's uncommitted upload is not a readable version");
      assert.equal(await receipts.findProbeKey(db, actors.maintainer, maintainerTeam, `receipt-${f.receipts.active}`), f.keys.lease, "own valid receipt remains reusable");
      assert.equal(await receipts.findProbeKey(db, actors.maintainer, maintainerTeam, `receipt-${f.receipts.expired}`), null);
      const privateHash = `${f.run}-private-hash`;
      const privateAsset = await seedRuntimeProjectionFixture(client, f, { kind: "model", payload: { kind: "model" },
        resources: [{ role: "primary", storageKey: `assets/${f.run}/private-preview.glb`, contentHash: privateHash }] });
      assert.equal(await receipts.findProbeKey(db, actors.editor, team, privateHash), `assets/${f.run}/private-preview.glb`);
      assert.equal((await assetService.getAssetDetail(actors.editor, privateAsset.asset)).id, privateAsset.asset);
      await rejectCode(() => receipts.resolveUploadScope(db, actors.foreign, { organizationId: f.organizations.team, workspaceId: null }), "FORBIDDEN");
      await rejectCode(() => receipts.resolveUploadScope(db, actors.foreign, { organizationId: f.organizations.foreign, workspaceId: f.workspaces.b }), "NOT_FOUND");
      await rejectCode(() => receipts.resolveUploadScope(db, actors.editor, { organizationId: f.organizations.foreign, workspaceId: f.workspaces.b }), "NOT_FOUND");
      await rejectCode(() => receipts.resolveUploadScope(db, actors.viewer, { organizationId: f.organizations.team, workspaceId: null }), "FORBIDDEN");
      await rejectCode(() => receipts.resolveUploadScope(db, actors.editor, { organizationId: null, workspaceId: null }), "VALIDATION_FAILED");
      await rejectCode(() => receipts.resolveUploadScope(db, actors.editor, { organizationId: "not-a-uuid", workspaceId: null }), "NOT_FOUND");
      const viaCollection = await receipts.resolveUploadScope(db, actors.unassigned, { organizationId: null, workspaceId: f.workspaces.secret });
      assert.equal(viaCollection.org.org.id, f.organizations.team);
      assert.equal(viaCollection.workspaceId, f.workspaces.secret);
    });

    await check("T02 probe-content-regression: placement content returns the latest asset; source access comes from the team, never from the placement", async () => {
      const ids = await seedRuntimeProjectionFixture(client, f, { kind: "model", payload: { kind: "model", attributes: { label: "fixed-v1" } },
        resources: [{ role: "primary", url: "https://external-fixture.invalid/fixed-preview-v1.glb" }] });
      const newest = await assetService.updateAsset(actors.maintainer, ids.asset, {
        payload: { kind: "model", attributes: { label: "private-v2" } }, resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/private-preview-v2.glb" }],
        expectedLockVersion: 1,
      });
      const fixed = await placementService.getPlacementContent(actors.editor, ids.placement, f.workspaces.a);
      assert.equal(fixed.kind, "asset");
      if (fixed.kind !== "asset") throw new Error("Expected fixed AssetVersion content");
      assert.equal(fixed.placement_id, ids.placement);
      assert.equal(fixed.public_id, ids.public);
      assert.equal(fixed.asset_id, ids.asset);
      assert.equal(fixed.asset_lock_version, newest.lock_version);
      assert.equal(fixed.resources[0].url, "https://external-fixture.invalid/private-preview-v2.glb");
      assert.equal(fixed.payload.attributes?.label, "private-v2");
      for (const forbidden of ["migration_legacy", "current_version_id", "versions", "grants"]) assert.equal(JSON.stringify(fixed).includes(forbidden), false, forbidden);
      assert.equal((await placementService.getPlacementContent(actors.viewer, ids.placement, f.workspaces.a)).kind, "asset", "viewers preview the shared placement");
      assert.equal((await placementService.getPlacementContent(actors.editor, ids.placement)).kind, "asset", "team members read it without a context");
      const detail = await assetService.getAssetDetail(actors.editor, ids.asset);
      assert.equal(detail.id, newest.id, "the team catalog shows the source history");
      const duplicate = await assetService.duplicateAsset(actors.editor, ids.asset, { idempotencyKey: `${f.run}-team-duplicate` });
      assert.equal(duplicate.asset.origin_workspace_id, null);
      assert.equal(duplicate.asset.resources[0].external_url, "https://external-fixture.invalid/private-preview-v2.glb");
      const pinnedElsewhere = await placementService.createPlacement(actors.editor, f.workspaces.b, {
        target: { kind: "asset", assetId: ids.asset }, location: { longitude: 121.5, latitude: 31.2 },
      });
      assert.ok(pinnedElsewhere.placement.target.kind === "asset" && pinnedElsewhere.placement.target.asset_id === ids.asset);
      const reused = await assetService.createAssetForCollection(actors.editor, f.workspaces.b, {
        name: "team reuse of pinned bytes", fileType: "model", payload: { kind: "model" },
        resources: [{ role: "primary", fromAssetId: ids.asset, fromRole: "primary" }], idempotencyKey: `${f.run}-team-source-bytes`,
      });
      assert.equal(reused.asset.resources[0].external_url, "https://external-fixture.invalid/private-preview-v2.glb");
      for (const viewer of [f.workspaces.b, f.workspaces.empty, f.workspaces.foreign, randomUUID()]) {
        await rejectCode(() => placementService.getPlacementContent(actors.editor, ids.placement, viewer), "NOT_FOUND");
      }
      await rejectCode(() => placementService.getPlacementContent(actors.foreign, ids.placement, f.workspaces.b), "NOT_FOUND");
      await rejectCode(() => placementService.getPlacementContent(actors.foreign, ids.placement), "NOT_FOUND");
    });

    await check("T02 probe-content-regression: shared Scene Placement preview resolves current asset resources; the scene is team content", async () => {
      const asset = await assetService.createAssetForCollection(actors.maintainer, f.workspaces.a, {
        name: "private scene model", fileType: "model", visibility: "restricted", payload: { kind: "model" },
        resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/fixed-scene-model.glb" }], idempotencyKey: `${f.run}-fixed-scene-model`,
      });
      const scene = await sceneService.createOrganizationScene(actors.maintainer, f.organizations.team, {
        name: "published preview", document: assetDocument(asset.asset.id),
      });
      assert.equal(scene.workspace_id, null);
      const placed = (await placementService.createPlacement(actors.maintainer, f.workspaces.a, {
        target: { kind: "scene", sceneId: scene.id }, location: { longitude: 121.5, latitude: 31.2 },
      })).placement;
      const publicId = placed.id;
      const newest = await assetService.updateAsset(actors.maintainer, asset.asset.id, {
        payload: { kind: "model" }, resources: [{ role: "primary", externalUrl: "https://external-fixture.invalid/private-scene-model-new.glb" }], expectedLockVersion: asset.asset.lock_version,
      });
      await sceneService.saveScene(actors.maintainer, scene.id, { expectedLockVersion: scene.lock_version, name: "saved scene name", document: assetDocument(asset.asset.id) });
      const fixed = await placementService.getPlacementContent(actors.editor, placed.id, f.workspaces.a);
      assert.equal(fixed.kind, "scene");
      if (fixed.kind !== "scene") throw new Error("Expected fixed SceneRevision content");
      assert.equal(fixed.public_id, publicId);
      assert.equal(fixed.scene_id, scene.id);
      assert.equal(fixed.name, "saved scene name");
      assert.equal(fixed.document.content.assets.model.assetId, asset.asset.id);
      assert.equal(fixed.resources[0].asset_id, asset.asset.id);
      assert.equal(fixed.resources[0].url, "https://external-fixture.invalid/private-scene-model-new.glb");
      assert.equal(JSON.stringify(fixed).includes("saved scene name"), true, "placement content follows saved changes");
      assert.equal(JSON.stringify(fixed).includes(newest.id), true);
      const draft = await sceneService.getScene(actors.editor, scene.id);
      assert.equal(draft.name, "saved scene name", "team members read the draft itself");
      assert.equal(draft.referenced_resources[0].asset_id, newest.id);
      const copied = await sceneService.copyScene(actors.editor, scene.id, { targetWorkspaceId: f.workspaces.b, idempotencyKey: `${f.run}-scene-copy-b` });
      assert.equal(copied.workspace_id, f.workspaces.b);
      const teamCopy = await sceneService.copyScene(actors.editor, scene.id, { idempotencyKey: `${f.run}-scene-copy-team` });
      assert.equal(teamCopy.workspace_id, null);
      assert.equal(teamCopy.organization_id, f.organizations.team);
      assert.equal(teamCopy.referenced_resources[0].asset_id, newest.id, "copies reference the same assets");
      await rejectCode(() => sceneService.copyScene(actors.editor, scene.id, { targetWorkspaceId: f.workspaces.foreign }), "NOT_FOUND");
      await rejectCode(() => sceneService.copyScene(actors.viewer, scene.id, {}), "FORBIDDEN");
      await rejectCode(() => sceneService.getScene(actors.foreign, scene.id), "NOT_FOUND");
    });

    await check("agent preflight validates references without changing scene, lock or index", async () => {
      const scene = await sceneService.createOrganizationScene(actors.editor, f.organizations.team, { name: "agent preflight", document: createBlankSceneDocument() });
      const document = assetDocument(f.assets.shared);
      const before = await sceneService.getScene(actors.editor, scene.id);
      const body = { document, sceneId: scene.id, expectedLockVersion: scene.lock_version };
      const result = await sceneService.validateOrganizationScene(actors.editor, f.organizations.team, body);
      assert.equal(result.valid, true);
      assert.equal(result.referenced_resources.length, 1);
      assert.deepEqual(await sceneService.getScene(actors.editor, scene.id), before, "preflight preserves document, refs and lock");
      await rejectCode(() => sceneService.validateOrganizationScene(actors.viewer, f.organizations.team, body), "FORBIDDEN");
      await rejectCode(() => sceneService.validateOrganizationScene(actors.foreign, f.organizations.team, body), "FORBIDDEN");
      await rejectCode(() => sceneService.validateOrganizationScene(actors.editor, f.organizations.team, { ...body, expectedLockVersion: scene.lock_version + 1 }), "LOCK_VERSION_CONFLICT");
      await rejectCode(() => sceneService.validateOrganizationScene(actors.editor, f.organizations.team, { document: assetDocument(randomUUID()) }), "NOT_FOUND");
      await sceneService.saveScene(actors.editor, scene.id, { expectedLockVersion: scene.lock_version, state: "archived" });
      await rejectCode(() => sceneService.validateOrganizationScene(actors.editor, f.organizations.team, body), "ARCHIVED");
    });

    await check("T02 probe-content-regression: explicit viewer-collection context is validated even for the source owner", async () => {
      const ids = await seedRuntimeProjectionFixture(client, f, { kind: "model", payload: { kind: "model" },
        resources: [{ role: "primary", url: "https://external-fixture.invalid/context.glb" }] });
      assert.equal((await placementService.getPlacementContent(actors.owner, ids.placement, f.workspaces.a)).kind, "asset");
      for (const invalidViewer of [f.workspaces.b, f.workspaces.empty, f.workspaces.foreign, randomUUID()]) {
        await rejectCode(() => placementService.getPlacementContent(actors.owner, ids.placement, invalidViewer), "NOT_FOUND");
        await rejectCode(() => placementService.getPlacement(actors.owner, ids.placement, invalidViewer), "NOT_FOUND");
      }
    });


  } finally {
    try { await cleanupServicesFixture(client, f); }
    finally { await Promise.all([client.end(), db.destroy()]); }
  }
  console.log(`${passed} service integration groups passed; ${failures.length} failed`);
  assert.ok(passed + failures.length > 0, "No test matched the requested filter");
  if (failures.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database URL redacted]") : "Service regression failed");
  process.exitCode = 1;
});
