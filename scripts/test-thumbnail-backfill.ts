/** Real database regression; explicit disposable local DATABASE_URL only, never OSS. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { assertServicesDatabase, cleanupServicesFixture, fixtureIds, seedServicesFixture } from "./test-content-model-services-fixture";

async function main(): Promise<void> {
  assertServicesDatabase();
  const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: "thumbnail-backfill-regression" });
  await client.connect();
  const { db } = await import("../lib/db");
  const { contentTransaction } = await import("../lib/content-model/tx.server");
  const { issueReceipt } = await import("../lib/upload/receipts.server");
  const { isKeyProtected } = await import("../lib/storage/retention.server");
  const { ContentError } = await import("../lib/content-model/errors");
  const { attachBackfilledThumbnail, listAssetThumbnailCandidates, backfillAssetThumbnail } = await import("../lib/assets/thumbnail-backfill.server");
  const f = fixtureIds();
  let passed = 0;
  const failures: string[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); passed++; console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
  };
  const createAsset = async (options: { archived?: boolean; external?: boolean; kind?: "model" | "video" } = {}) => {
    const id = randomUUID();
    const kind = options.kind ?? "model";
    const extension = kind === "video" ? "mp4" : "glb";
    await contentTransaction(async (trx) => {
      await trx.insertInto("asset").values({ id, name: "backfill regression", file_type: kind, organization_id: f.organizations.team,
        maintained_by: f.users.maintainer, created_by: f.users.maintainer, state: options.archived ? "archived" : "active",
        payload: JSON.stringify(kind === "video" ? { kind } : { kind, animations: [{ index: 0, name: "idle", duration_seconds: 2 }] }) }).execute();
      await trx.insertInto("asset_resource").values({ asset_id: id, role: "primary", ordinal: 0,
        ...(options.external ? { external_url: `https://example.invalid/source.${extension}` } : { storage_key: `assets/${f.run}/${id}.${extension}`, content_hash: `primary-${id}` }),
        mime_type: kind === "video" ? "video/mp4" : "model/gltf-binary", size_bytes: 100 }).execute();
    });
    const candidate = (await listAssetThumbnailCandidates({ assetId: id }))[0];
    assert.ok(candidate);
    return candidate;
  };
  const receipt = (userId = f.users.maintainer, organizationId = f.organizations.team) => db.transaction().execute((trx) => issueReceipt(trx, {
    organizationId, workspaceId: null, userId, storageKey: `assets/${f.run}/${randomUUID()}.png`, contentHash: randomUUID(),
    mimeType: "image/png", sizeBytes: 128, uploadType: "image", purpose: "asset", reused: false,
  }));
  const refreshCandidates = (assetId: string) => listAssetThumbnailCandidates({ regenerateModels: true, assetId });
  const resources = (assetId: string) => db.selectFrom("asset_resource").selectAll().where("asset_id", "=", assetId)
    .orderBy("role").orderBy("ordinal").execute();
  const version = async (assetId: string) => (await db.selectFrom("asset").select("lock_version").where("id", "=", assetId).executeTakeFirstOrThrow()).lock_version;
  try {
    await seedServicesFixture(client, f);
    await check("backfill adds only thumbnail and preserves archived content; repeat is a no-op", async () => {
      const candidate = await createAsset({ archived: true });
      const before = await db.selectFrom("asset").selectAll().where("id", "=", candidate.id).executeTakeFirstOrThrow();
      const mainBefore = await db.selectFrom("asset_resource").selectAll().where("asset_id", "=", candidate.id).where("role", "=", "primary").executeTakeFirstOrThrow();
      const first = await receipt();
      assert.deepEqual(await attachBackfilledThumbnail(candidate, f.users.maintainer, first.id), { status: "updated", storageKey: first.storage_key });
      const after = await db.selectFrom("asset").selectAll().where("id", "=", candidate.id).executeTakeFirstOrThrow();
      assert.deepEqual(after.payload, before.payload);
      assert.equal(after.name, before.name);
      assert.equal(after.state, "archived");
      assert.equal(after.lock_version, before.lock_version + 1);
      assert.deepEqual(await db.selectFrom("asset_resource").selectAll().where("asset_id", "=", candidate.id).where("role", "=", "primary").executeTakeFirstOrThrow(), mainBefore);
      assert.ok((await db.selectFrom("upload_receipt").select("consumed_at").where("id", "=", first.id).executeTakeFirstOrThrow()).consumed_at);
      const audit = await db.selectFrom("content_audit_log").selectAll().where("object_id", "=", candidate.id).executeTakeFirstOrThrow();
      assert.equal(audit.action, "asset.thumbnail.backfill");
      assert.equal(audit.actor_id, null);
      assert.equal((await listAssetThumbnailCandidates({ assetId: candidate.id })).length, 0);
      const second = await receipt();
      assert.deepEqual(await attachBackfilledThumbnail(candidate, f.users.maintainer, second.id), { status: "skipped", reason: "thumbnail_exists" });
      assert.equal((await db.selectFrom("asset").select("lock_version").where("id", "=", candidate.id).executeTakeFirstOrThrow()).lock_version, after.lock_version);
      assert.equal((await db.selectFrom("upload_receipt").select("consumed_at").where("id", "=", second.id).executeTakeFirstOrThrow()).consumed_at, null);
    });
    for (const [operation, role] of [["backfill", "primary"], ["regeneration", "primary"], ["regeneration", "thumbnail"]] as const) {
      await check(`${operation} waits for a concurrent ${role} replacement and rejects the stale thumbnail`, async () => {
        const missing = await createAsset();
        let candidate = missing;
        if (operation === "regeneration") {
          await attachBackfilledThumbnail(missing, f.users.maintainer, (await receipt()).id);
          [candidate] = await refreshCandidates(missing.id);
          assert.ok(candidate);
        }
        const image = await receipt();
        await client.query("begin");
        let pending: ReturnType<typeof attachBackfilledThumbnail> | undefined;
        try {
          await client.query("select id from asset where id=$1 for update", [candidate.id]);
          pending = attachBackfilledThumbnail(candidate, f.users.maintainer, image.id);
          let blocked = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const row = await client.query<{ blocked: boolean }>("select exists(select 1 from pg_stat_activity where pg_backend_pid()=any(pg_blocking_pids(pid))) blocked");
            if (row.rows[0].blocked) { blocked = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          assert.ok(blocked, "thumbnail write should serialize with the asset writer");
          const replacement = `assets/${f.run}/concurrent-${role}`;
          await client.query("update asset_resource set storage_key=$2 where asset_id=$1 and role=$3 and ordinal=0", [candidate.id, replacement, role]);
          await client.query("commit");
          assert.deepEqual(await pending, { status: "skipped", reason: `${role}_changed` });
          const rows = await resources(candidate.id);
          assert.equal(rows.find(row => row.role === role)?.storage_key, replacement);
          assert.ok(!rows.some(row => row.storage_key === image.storage_key));
        } finally {
          await client.query("rollback");
          await pending?.catch(() => {});
        }
      });
    }
    await check("regeneration replaces only the generated cover, protects shared bytes and is idempotent", async () => {
      const missing = await createAsset({ archived: true });
      const shared = await createAsset();
      const oldCover = await receipt();
      await attachBackfilledThumbnail(missing, f.users.maintainer, oldCover.id);
      const originalCover = (await resources(missing.id)).find(row => row.role === "thumbnail");
      assert.ok(originalCover);
      await contentTransaction(async (trx) => {
        await trx.insertInto("asset_resource").values([{ ...originalCover, asset_id: shared.id },
          { ...originalCover, ordinal: 1, storage_key: `assets/${f.run}/alternate.png` }]).execute();
        await trx.updateTable("upload_receipt").set({ expires_at: new Date(0) }).where("id", "=", oldCover.id).execute();
      });
      const [candidate] = await refreshCandidates(missing.id);
      assert.ok(candidate, "backfill audit proves the existing model cover was generated");
      const beforeVersion = await version(candidate.id);
      const others = (await resources(candidate.id)).filter(row => row.role !== "thumbnail" || row.ordinal !== 0);
      const image = await receipt();
      assert.deepEqual(await attachBackfilledThumbnail(candidate, f.users.maintainer, image.id),
        { status: "updated", storageKey: image.storage_key, previousStorageKey: oldCover.storage_key });
      const after = await resources(candidate.id);
      assert.deepEqual(after.filter(row => row.role !== "thumbnail" || row.ordinal !== 0), others);
      assert.equal(after.find(row => row.role === "thumbnail" && row.ordinal === 0)?.storage_key, image.storage_key);
      assert.equal(await version(candidate.id), beforeVersion + 1);
      assert.equal(await isKeyProtected(db, oldCover.storage_key), true, "other model retains the retired object after the old receipt expired");
      const [repeated] = await refreshCandidates(candidate.id);
      assert.ok(repeated, "regeneration records provenance for the new cover");
      const repeatedImage = await db.transaction().execute(trx => issueReceipt(trx, {
        organizationId: f.organizations.team, workspaceId: null, userId: f.users.maintainer, storageKey: image.storage_key,
        contentHash: image.content_hash, mimeType: image.mime_type, sizeBytes: image.size_bytes, uploadType: "image", purpose: "asset", reused: true,
      }));
      assert.deepEqual(await attachBackfilledThumbnail(repeated, f.users.maintainer, repeatedImage.id), { status: "unchanged", storageKey: image.storage_key });
      assert.equal(await version(candidate.id), beforeVersion + 1);
    });
    await check("regeneration selects matching paired upload receipts and excludes custom, external and video covers", async () => {
      const uploaded = await createAsset();
      const cover = await receipt();
      const item = { asset_id: uploaded.id, role: "thumbnail", ordinal: 0, storage_key: cover.storage_key,
        content_hash: cover.content_hash, mime_type: cover.mime_type, size_bytes: cover.size_bytes };
      await contentTransaction(async (trx) => {
        await trx.insertInto("asset_resource").values(item).execute();
      });
      assert.deepEqual(await refreshCandidates(uploaded.id), [], "managed cover alone does not prove generation");
      const { storageKey, contentHash } = uploaded;
      assert.ok(storageKey && contentHash);
      const source = await db.transaction().execute((trx) => issueReceipt(trx, { organizationId: f.organizations.team, workspaceId: null,
        userId: f.users.maintainer, storageKey, contentHash, mimeType: uploaded.mimeType,
        sizeBytes: 100, uploadType: "model", purpose: "asset", reused: false }));
      await db.updateTable("upload_receipt").set({ thumbnail_receipt_id: cover.id }).where("id", "=", source.id).execute();
      assert.equal((await refreshCandidates(uploaded.id)).length, 1, "paired primary and thumbnail receipts prove automatic generation");
      await contentTransaction(async trx => {
        await trx.updateTable("asset_resource").set({ storage_key: null, external_url: "https://example.invalid/cover.png" })
          .where("asset_id", "=", uploaded.id).where("role", "=", "thumbnail").execute();
      });
      assert.deepEqual(await refreshCandidates(uploaded.id), [], "external cover is not eligible");
      const video = await createAsset({ kind: "video" });
      await attachBackfilledThumbnail(video, f.users.maintainer, (await receipt()).id);
      assert.deepEqual(await refreshCandidates(video.id), [], "video backfill evidence does not make a video eligible for model regeneration");
    });
    await check("backfill validates lease actor and organization", async () => {
      const candidate = await createAsset();
      for (const image of [await receipt(f.users.editor), await receipt(f.users.maintainer, f.organizations.foreign)]) {
        await assert.rejects(() => attachBackfilledThumbnail(candidate, f.users.maintainer, image.id),
          (error: unknown) => error instanceof ContentError && error.code === "RECEIPT_INVALID");
      }
      assert.equal((await db.selectFrom("asset_resource").select("role").where("asset_id", "=", candidate.id).execute()).length, 1);
    });
    await check("external primary is explicitly skipped before any network access", async () => {
      const candidate = await createAsset({ external: true });
      assert.deepEqual(await backfillAssetThumbnail(candidate), { status: "skipped", reason: "external_url_requires_import" });
    });
    console.log(`Thumbnail backfill: ${passed} passed, ${failures.length} failed`);
    if (failures.length) process.exitCode = 1;
  } finally {
    await cleanupServicesFixture(client, f);
    await db.destroy();
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
