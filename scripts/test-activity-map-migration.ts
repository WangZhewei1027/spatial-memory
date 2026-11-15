/** Single-map/status upgrade, conflict handling and rollback on a disposable database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55439");
  assert.equal(url.username, "postgres"); assert.equal(url.pathname, "/postgres");
  const admin = new Client({ connectionString: url.toString() }); await admin.connect();
  const name = `activity_map_${randomUUID().replaceAll("-", "")}`;
  let client: Client | undefined;
  let closeService: (() => Promise<void>) | undefined;
  try {
    await admin.query(`create database ${name}`);
    url.pathname = `/${name}`;
    client = new Client({ connectionString: url.toString() }); await client.connect();
    const migrationName = "20261115000000_single_activity_map.sql";
    const migration = readFileSync(`db/migrations/${migrationName}`, "utf8");
    const baseline = readFileSync("db/schema.sql", "utf8");
    const marker = "-- A paused activity still occupies its map.";
    assert.equal(baseline.split(marker).length, 2);
    await client.query(baseline.split(marker)[0]);
    const team = randomUUID(), activity = randomUUID(), maps = [randomUUID(), randomUUID(), randomUUID()];
    await client.query("insert into organization(id,name) values($1,'migration fixture')", [team]);
    for (const map of maps) await client.query("insert into workspace(id,organization_id,name) values($1,$2,'map')", [map, team]);
    await client.query("insert into activity(id,organization_id,name,type) values($1,$2,'activity','danmaku')", [activity, team]);
    const links = [];
    for (const map of maps.slice(0, 2)) links.push((await client.query("insert into activity_placement(activity_id,organization_id,workspace_id) values($1,$2,$3) returning id", [activity, team, map])).rows[0].id);
    const record = (await client.query("insert into activity_record(organization_id,activity_id,placement_id,kind,content) values($1,$2,$3,'danmaku','retained source') returning id", [team, activity, links[1]])).rows[0].id;
    // Management must stay readable while the owner resolves pre-migration links.
    process.env.DATABASE_URL = url.toString();
    const { db } = await import("../lib/db");
    closeService = () => db.destroy();
    const { loadActor } = await import("../lib/content-model/access.server");
    const service = await import("../lib/activities/service.server");
    const user = randomUUID();
    await client.query("insert into auth.users(id,name,email) values($1,'migration owner',$2)", [user, `${user}@example.test`]);
    await client.query("insert into organization_member(organization_id,user_id,role) values($1,$2,'owner')", [team, user]);
    const actor = await loadActor(db, user);
    const listed = await service.listActivities(actor, team);
    assert.equal(listed.length, 1, "multiple old links must not prevent the activity library from loading");
    assert.equal(listed[0].has_map_link, true);
    assert.equal((await service.getActivity(actor, activity)).has_map_link, true);
    assert.deepEqual((await service.listActivityPlacements(actor, activity)).map((link) => link.status), ["paused", "paused"], "legacy draft links are displayed as paused while awaiting migration");
    await client.query("begin");
    await assert.rejects(client.query(migration), (error: unknown) => error instanceof Error && error.message.includes("multiple maps"));
    await client.query("rollback");
    assert.equal((await client.query("select count(*)::int n from activity_placement where status='draft'")).rows[0].n, 2, "conflicts cannot silently unlink a map");
    await client.query("update activity_placement set status='archived' where id=$1", [links[1]]);
    await client.query("begin");
    await client.query(migration);
    const link = (await client.query("select status,lock_version from activity_placement where id=$1", [links[0]])).rows[0];
    assert.deepEqual(link, { status: "paused", lock_version: 2 });
    const rejectedSql = async (statement: string, params: unknown[], constraint: string) => {
      await client!.query("savepoint invalid_link");
      await assert.rejects(client!.query(statement, params), new RegExp(constraint));
      await client!.query("rollback to savepoint invalid_link");
    };
    await rejectedSql("insert into activity_placement(activity_id,organization_id,workspace_id) values($1,$2,$3)", [activity, team, maps[2]], "activity_placement_single_map_unique");
    await rejectedSql("update activity_placement set status='active' where id=$1", [links[1]], "activity_placement_single_map_unique");
    await rejectedSql("update activity_placement set status='draft' where id=$1", [links[0]], "activity_placement_status_check");
    await client.query("update activity_placement set status='archived' where id=$1", [links[0]]);
    const added = (await client.query("insert into activity_placement(activity_id,organization_id,workspace_id) values($1,$2,$3) returning status", [activity, team, maps[2]])).rows[0];
    assert.equal(added.status, "paused");
    const source = (await client.query("select r.organization_id,p.workspace_id,r.content from activity_record r join activity_placement p on p.id=r.placement_id where r.id=$1", [record])).rows[0];
    assert.deepEqual(source, { organization_id: team, workspace_id: maps[1], content: "retained source" });
    await client.query("rollback");
    assert.equal((await client.query("select status from activity_placement where id=$1", [links[0]])).rows[0].status, "draft");
    assert.equal((await client.query("select to_regclass('activity_placement_single_map_unique') name")).rows[0].name, null);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/db/migrate.ts"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    assert.deepEqual((await client.query("select status,lock_version from activity_placement where id=$1", [links[0]])).rows[0], link);
    assert.equal((await client.query("select count(*)::int n from activity_record where id=$1", [record])).rows[0].n, 1);
    console.log("PASS activity map migration: conflicts, draft conversion, default pause, unique links, history, rollback and repeatable upgrade");
  } finally {
    await closeService?.();
    await client?.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
