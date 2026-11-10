/** Upgrade, rollback and fresh-install coverage on disposable databases only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { DEFAULT_COLLECTION_MINIAPP_CONFIG } from "../lib/content-model/collection-config";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55439");
  assert.equal(url.username, "postgres"); assert.equal(url.pathname, "/postgres");
  const admin = new Client({ connectionString: url.toString() }); await admin.connect();
  const name = `collection_config_${randomUUID().replaceAll("-", "")}`;
  let client: Client | undefined;
  try {
    await admin.query(`create database ${name}`);
    url.pathname = `/${name}`;
    client = new Client({ connectionString: url.toString() }); await client.connect();
    const migrationName = "20261108000000_collection_miniapp_config.sql";
    const migration = readFileSync(`db/migrations/${migrationName}`, "utf8");
    const baseline = readFileSync("db/schema.sql", "utf8");
    const marker = "-- Copy the effective team display settings once.";
    assert.equal(baseline.split(marker).length, 2);
    await client.query(baseline.split(marker)[0]);
    const teams = [randomUUID(), randomUUID(), randomUUID()];
    const maps = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const oldConfig = { text_asset_miniapp_style: "plain_white", confetti_enabled: true, footer_enabled: true, private_setting: "retained" };
    for (let i = 0; i < teams.length; i++) await client.query("insert into organization(id,name,config) values($1,'fixture',$2)",
      [teams[i], i === 0 ? oldConfig : i === 1 ? {} : { confetti_enabled: "true", footer_enabled: null, text_asset_miniapp_style: "invalid" }]);
    for (let i = 0; i < maps.length; i++) await client.query("insert into workspace(id,organization_id,name,archived_at) values($1,$2,'retained map',case when $3 then now() else null end)",
      [maps[i], teams[Math.max(0, i - 1)], i === 1]);
    const read = async (id: string) => (await client!.query("select miniapp_config from workspace where id=$1", [id])).rows[0].miniapp_config;
    const inherited = { ...DEFAULT_COLLECTION_MINIAPP_CONFIG, text_asset_miniapp_style: "plain_white", confetti_enabled: true, footer_enabled: true };
    await client.query("begin");
    await client.query(migration);
    assert.deepEqual(await read(maps[0]), inherited);
    assert.deepEqual(await read(maps[1]), inherited, "archived maps retain their existing display configuration too");
    assert.deepEqual(await read(maps[2]), DEFAULT_COLLECTION_MINIAPP_CONFIG);
    assert.deepEqual(await read(maps[3]), DEFAULT_COLLECTION_MINIAPP_CONFIG);
    const independent = { ...inherited, retrieval_mode: "anchor", footer_enabled: false };
    await client.query("update workspace set miniapp_config=$2 where id=$1", [maps[0], independent]);
    assert.deepEqual(await read(maps[1]), inherited, "maps in the same team must be independent");
    const added = (await client.query("insert into workspace(organization_id,name) values($1,'new map') returning id", [teams[0]])).rows[0].id;
    assert.deepEqual(await read(added), DEFAULT_COLLECTION_MINIAPP_CONFIG, "new maps do not inherit retired team configuration");
    for (const config of [{}, { ...inherited, retrieval_mode: null }, { ...inherited, confetti_enabled: "true" }, { ...inherited, private_setting: true }]) {
      await client.query("savepoint invalid_config");
      await assert.rejects(client.query("update workspace set miniapp_config=$2 where id=$1", [maps[0], config]), /workspace_miniapp_config_check/);
      await client.query("rollback to savepoint invalid_config");
    }
    await client.query("rollback");
    assert.equal((await client.query("select count(*)::int n from information_schema.columns where table_name='workspace' and column_name='miniapp_config'")).rows[0].n, 0);
    assert.deepEqual((await client.query("select config from organization where id=$1", [teams[0]])).rows[0].config, oldConfig);
    const migrate = () => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/db/migrate.ts"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    migrate(); migrate();
    assert.deepEqual(await read(maps[0]), inherited);
    assert.equal((await client.query("select count(*)::int n from workspace where id=any($1::uuid[]) and name='retained map'", [maps])).rows[0].n, 4);
    assert.equal((await client.query("select count(*)::int n from schema_migrations where name=$1", [migrationName])).rows[0].n, 1);
    console.log("PASS map settings migration: inherited values, defaults, independent maps, validation, rollback and repeatable upgrade");
  } finally {
    await client?.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
