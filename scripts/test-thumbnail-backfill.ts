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
  const { ContentError } = await import("../lib/content-model/errors");
  const { attachBackfilledThumbnail, listMissingAssetThumbnails, backfillAssetThumbnail } = await import("../lib/assets/thumbnail-backfill.server");
  const f = fixtureIds();
  let passed = 0;
  const failures: string[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); passed++; console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
  };
  const model = async (archived = false, external = false) => {
    const id = randomUUID();
    await contentTransaction(async (trx) => {
      await trx.insertInto("asset").values({ id, name: "backfill regression", file_type: "model", organization_id: f.organizations.team,
        maintained_by: f.users.maintainer, created_by: f.users.maintainer, state: archived ? "archived" : "active",
        payload: JSON.stringify({ kind: "model", animations: [{ index: 0, name: "idle", duration_seconds: 2 }] }) }).execute();
      await trx.insertInto("asset_resource").values({ asset_id: id, role: "primary", ordinal: 0,
        ...(external ? { external_url: "https://example.invalid/model.glb" } : { storage_key: `assets/${f.run}/${id}.glb`, content_hash: `primary-${id}` }),
        mime_type: "model/gltf-binary", size_bytes: 100 }).execute();
    });
    const candidate = (await listMissingAssetThumbnails({ assetId: id }))[0];
    assert.ok(candidate);
    return candidate;
  };
  const receipt = (userId = f.users.maintainer, organizationId = f.organizations.team) => db.transaction().execute((trx) => issueReceipt(trx, {
    organizationId, workspaceId: null, userId, storageKey: `assets/${f.run}/${randomUUID()}.png`, contentHash: randomUUID(),
    mimeType: "image/png", sizeBytes: 128, uploadType: "image", purpose: "asset", reused: false,
  }));
  try {
    await seedServicesFixture(client, f);
    await check("backfill adds only thumbnail and preserves archived content; repeat is a no-op", async () => {
      const candidate = await model(true);
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
      assert.equal((await listMissingAssetThumbnails({ assetId: candidate.id })).length, 0);
      const second = await receipt();
      assert.deepEqual(await attachBackfilledThumbnail(candidate, f.users.maintainer, second.id), { status: "skipped", reason: "thumbnail_exists" });
      assert.equal((await db.selectFrom("asset").select("lock_version").where("id", "=", candidate.id).executeTakeFirstOrThrow()).lock_version, after.lock_version);
      assert.equal((await db.selectFrom("upload_receipt").select("consumed_at").where("id", "=", second.id).executeTakeFirstOrThrow()).consumed_at, null);
    });
    await check("backfill waits for concurrent replacement then rejects its stale snapshot", async () => {
      const candidate = await model();
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
        assert.ok(blocked, "backfill should serialize with the asset writer");
        await client.query("update asset_resource set storage_key=$2 where asset_id=$1 and role='primary'", [candidate.id, `assets/${f.run}/replacement.glb`]);
        await client.query("commit");
        assert.deepEqual(await pending, { status: "skipped", reason: "primary_changed" });
        assert.equal((await db.selectFrom("asset_resource").select("role").where("asset_id", "=", candidate.id).where("role", "=", "thumbnail").execute()).length, 0);
      } finally {
        await client.query("rollback");
        await pending?.catch(() => {});
      }
    });
    await check("backfill validates lease actor and organization", async () => {
      const candidate = await model();
      for (const image of [await receipt(f.users.editor), await receipt(f.users.maintainer, f.organizations.foreign)]) {
        await assert.rejects(() => attachBackfilledThumbnail(candidate, f.users.maintainer, image.id),
          (error: unknown) => error instanceof ContentError && error.code === "RECEIPT_INVALID");
      }
      assert.equal((await db.selectFrom("asset_resource").select("role").where("asset_id", "=", candidate.id).execute()).length, 1);
    });
    await check("external primary is explicitly skipped before any network access", async () => {
      const candidate = await model(false, true);
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
