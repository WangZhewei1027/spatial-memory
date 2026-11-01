/** URL migration regression on a NEW disposable validation database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { migrateMediaOrigins, type MediaMigrationOptions } from "./migrate/spatial-memory-media";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55439"); assert.equal(url.pathname, "/postgres");
  const name = `media_migration_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: url.toString() }); await admin.connect();
  let created = false;
  let db: Client | undefined;
  const old = "https://sanlinlaojie-media.oss-cn-shanghai.aliyuncs.com";
  const target = "https://spatial-memory-media.oss-cn-shanghai.aliyuncs.com";
  const options: MediaMigrationOptions = { sources: [old, old.replace("https:", "http:")], target, execute: false };
  try {
    await admin.query(`create database ${name}`); created = true; url.pathname = `/${name}`;
    const migrated = spawnSync(process.execPath, ["--import", "tsx", "scripts/db/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: url.toString(), NEXT_PUBLIC_MEDIA_BASE_URL: "https://media-test.invalid" }, encoding: "utf8",
    });
    assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
    db = new Client({ connectionString: url.toString() }); await db.connect();
    const org = randomUUID(); const asset = randomUUID(); const scene = randomUUID();
    await db.query("insert into organization(id,name) values($1,'三林老街')", [org]);
    // SQL keeps the large integer exact; parsing/re-encoding JSON in JavaScript
    // would silently round it and is deliberately avoided by the migrator.
    await db.query(`insert into asset(id,organization_id,file_type,payload,updated_at,lock_version)
      values($1,$2,'image',$3::jsonb,'2026-01-02T03:04:05Z',7)`, [asset, org,
      `{"kind":"image","integer":900719925474099312345,"nested":{"caption":"三林老街","array":["${old}/assets/a%20b.png?x=1#view","HTTP://SANLINLAOJIE-MEDIA.OSS-CN-SHANGHAI.ALIYUNCS.COM:80/assets/a.png",null,true,42]},"unrelated":"${old}.evil.invalid/assets/no.png","differentPort":"${old}:8443/assets/no.png","userInfo":"${old}@evil.invalid/no.png"}`]);
    await db.query("insert into asset_resource(asset_id,role,external_url) values($1,'primary',$2)", [asset, `${old}/assets/a%20b.png?x=1#view`]);
    await db.query("insert into asset_resource(asset_id,role,storage_key) values($1,'thumbnail','assets/unchanged.png')", [asset]);
    await db.query("insert into anchor_embedding(anchor_id,image_url,generation,status) values($1,$2,$3,'pending')", [asset, `${old}:443/assets/a.png`, randomUUID()]);
    await db.query("insert into scene(id,organization_id,name,document,lock_version) values($1,$2,'三林老街',$3,11)", [scene, org,
      { schemaVersion: 6, content: { image: `${old}/assets/a.png` } }]);
    await db.query("insert into scene_asset_ref(scene_id,organization_id,resource_alias,asset_id) values($1,$2,'unchanged-alias',$3)", [scene, org, asset]);
    await db.query("insert into error_log(message,context) values($1,$2)", [`historical ${old}/assets/a.png`, { url: `${old}/assets/a.png` }]);
    await db.query("create table migration_archive.media_fixture(id integer primary key,original_url text)");
    await db.query("insert into migration_archive.media_fixture values(1,$1)", [`${old}/assets/a.png`]);
    const beforeAsset = (await db.query("select payload::text,updated_at,lock_version from asset where id=$1", [asset])).rows[0];
    const beforeRefs = (await db.query("select * from scene_asset_ref")).rows;
    const beforeLogs = (await db.query("select * from error_log")).rows;
    const dryRun = await migrateMediaOrigins(db, options);
    assert.equal(dryRun.blocked, false);
    assert.ok(dryRun.findings.some((finding) => finding.column === "public.asset.payload" && finding.disposition === "rewrite"));
    assert.deepEqual((await db.query("select payload::text,updated_at,lock_version from asset where id=$1", [asset])).rows[0], beforeAsset);

    // Unknown runtime locations and JSON keys are evidence for operator review,
    // never permission for a blanket database-wide replacement.
    await db.query("insert into auth.verification(identifier,value,expires_at) values('signed-challenge',$1,now()+interval '1 hour')", [`${old}/assets/a.png`]);
    assert.equal((await migrateMediaOrigins(db, options)).blocked, true);
    await assert.rejects(migrateMediaOrigins(db, { ...options, execute: true }), /Unreviewed runtime URL locations/);
    await db.query("delete from auth.verification");
    await db.query("update asset set payload=payload || jsonb_build_object($2::text,'key-must-not-change') where id=$1", [asset, `${old}/assets/key.png`]);
    assert.equal((await migrateMediaOrigins(db, options)).blocked, true);
    await assert.rejects(migrateMediaOrigins(db, { ...options, execute: true }), /Unreviewed runtime URL locations/);
    await db.query("update asset set payload=payload-$2 where id=$1", [asset, `${old}/assets/key.png`]);
    const executionBefore = (await db.query("select payload::text,updated_at,lock_version from asset where id=$1", [asset])).rows[0];
    // An unexpected trigger that changes anything beyond the URL must force a
    // full rollback, including earlier table updates and trigger enable state.
    await db.query(`create function public.media_fixture_trigger() returns trigger language plpgsql as $fn$
      begin new.status := 'failed'; return new; end $fn$;
      create trigger media_fixture_trigger before update on anchor_embedding for each row execute function public.media_fixture_trigger()`);
    await assert.rejects(migrateMediaOrigins(db, { ...options, execute: true }), /Preservation check failed/);
    assert.deepEqual((await db.query("select payload::text,updated_at,lock_version from asset where id=$1", [asset])).rows[0], executionBefore);
    assert.equal((await db.query("select tgenabled from pg_trigger where tgname='trg_asset_set_updated_at'")).rows[0].tgenabled, "O");
    await db.query("drop trigger media_fixture_trigger on anchor_embedding; drop function public.media_fixture_trigger()");
    const executed = await migrateMediaOrigins(db, { ...options, execute: true });
    assert.ok(executed.tableEvidence.every((entry) => entry.verified));
    const afterAsset = (await db.query("select payload::text,updated_at,lock_version from asset where id=$1", [asset])).rows[0];
    assert.equal(afterAsset.lock_version, executionBefore.lock_version);
    assert.deepEqual(afterAsset.updated_at, executionBefore.updated_at);
    assert.match(afterAsset.payload, /900719925474099312345/);
    assert.match(afterAsset.payload, /三林老街/);
    assert.ok(afterAsset.payload.includes(`${target}/assets/a%20b.png?x=1#view`));
    assert.ok(afterAsset.payload.includes(`${target}/assets/a.png`));
    assert.ok(afterAsset.payload.includes(`${old}.evil.invalid/assets/no.png`));
    assert.ok(afterAsset.payload.includes(`${old}:8443/assets/no.png`));
    assert.ok(afterAsset.payload.includes(`${old}@evil.invalid/no.png`));
    assert.equal((await db.query("select image_url from anchor_embedding")).rows[0].image_url, `${target}/assets/a.png`);
    assert.deepEqual((await db.query("select * from scene_asset_ref")).rows, beforeRefs);
    assert.deepEqual((await db.query("select * from error_log")).rows, beforeLogs);
    assert.equal((await db.query("select original_url from migration_archive.media_fixture")).rows[0].original_url, `${old}/assets/a.png`);
    assert.equal((await db.query("select lock_version from scene where id=$1", [scene])).rows[0].lock_version, 11);
    const replay = await migrateMediaOrigins(db, { ...options, execute: true });
    assert.ok(replay.tableEvidence.every((entry) => entry.verified && entry.beforeSha256 === entry.afterSha256));
    assert.equal(replay.findings.some((entry) => entry.disposition === "rewrite"), false);
    console.log("PASS media migration: dry-run, exact origins/default ports, JSON precision/keys, unknown-column rejection, trigger rollback, timestamps/versions/references, historical records and replay");
  } finally {
    await db?.end();
    if (created) await admin.query(`drop database ${name}`);
    await admin.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Media migration test failed"); process.exitCode = 1; });
