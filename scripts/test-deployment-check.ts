/** Verify deployment gates on a NEW disposable DB, never on an application DB. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55439");
  assert.equal(url.pathname, "/postgres", "use the validation cluster's admin database");
  const name = `release_gate_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  let created = false;
  let db: Client | undefined;
  const sql = execFileSync(process.execPath, ["scripts/db/deployment-check.mjs"], { encoding: "utf8" });
  try {
    await admin.query(`create database ${name}`); created = true;
    url.pathname = `/${name}`;
    db = new Client({ connectionString: url.toString() }); await db.connect();
    const reject = async (pattern: RegExp) => {
      await assert.rejects(db!.query(sql), pattern);
      await db!.query("rollback");
    };
    await reject(/no migration ledger/);
    for (let pass = 0; pass < 2; pass++) {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/db/migrate.ts"], {
        env: { ...process.env, DATABASE_URL: url.toString(), NEXT_PUBLIC_MEDIA_BASE_URL: "https://release-check.invalid" }, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    await db.query(sql);
    const ledger = (await db.query<{ name: string }>("select name from schema_migrations order by name")).rows;
    const latest = ledger.filter((entry) => entry.name !== "schema.sql").at(-1)!.name;
    await db.query("delete from schema_migrations where name=$1", [latest]);
    await reject(/pending database migrations/);
    await db.query("insert into schema_migrations(name) values($1)", [latest]);
    await db.query("alter table scene rename column document to draft_document");
    await reject(/ledger disagrees with schema/);
    await db.query("alter table scene rename column draft_document to document");
    await db.query("alter table organization rename column wechat_qr_center_image_key to missing_center_image");
    await reject(/missing organization\.wechat_qr_center_image_key/);
    await db.query("alter table organization rename column missing_center_image to wechat_qr_center_image_key");
    await db.query("create table asset_version(id uuid)");
    await reject(/obsolete runtime content structures/);
    await db.query("drop table asset_version");
    await db.query("alter table activity_record rename column placement_id to obsolete_placement_id");
    await reject(/ledger disagrees with schema/);
    await db.query("alter table activity_record rename column obsolete_placement_id to placement_id");
    await db.query("alter table activity_point rename column location to obsolete_location");
    await reject(/ledger disagrees with schema/);
    await db.query("alter table activity_point rename column obsolete_location to location");
    await db.query("create table activity_point_placement(id uuid)");
    await reject(/obsolete runtime content structures/);
    await db.query("drop table activity_point_placement");
    for (const column of ["location", "radius_meters", "config"]) {
      await db.query(`alter table activity_placement add column ${column} text`);
      await reject(/obsolete runtime content structures/);
      await db.query(`alter table activity_placement drop column ${column}`);
    }
    const orgId = randomUUID();
    const assetId = randomUUID();
    await db.query("insert into organization(id,name) values($1,'release gate activity fixture')", [orgId]);
    await db.query("insert into asset(id,organization_id,file_type,payload) values($1,$2,'shop','{\"kind\":\"shop\"}')", [assetId, orgId]);
    await reject(/unmigrated shop or public-submission assets/);
    await db.query("update asset set file_type='text',origin='public_submission',payload='{\"kind\":\"text\",\"text\":\"pending migration\"}' where id=$1", [assetId]);
    await reject(/unmigrated shop or public-submission assets/);
    await db.query("delete from asset where id=$1", [assetId]);
    await db.query(sql);
    assert.deepEqual((await db.query("select name from schema_migrations order by name")).rows, ledger);
    assert.ok(readFileSync("scripts/deploy.sh", "utf8").includes("deployment-check.mjs"));
    assert.ok(readFileSync(".github/workflows/deploy.yml", "utf8").includes("needs: quality"));
    console.log("PASS fresh migration + replay; release gate rejects absent/pending ledger, schema drift, obsolete tables and unmigrated activity assets without changing the ledger");
  } finally {
    await db?.end();
    if (created) await admin.query(`drop database ${name}`);
    await admin.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Deployment check failed"); process.exitCode = 1; });
