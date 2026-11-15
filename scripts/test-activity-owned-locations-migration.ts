/** Real upgrade from the previous activity model, on a newly created disposable DB. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { ACTIVITY_MIGRATION, prepareActivityMigration } from "./db/activity-migration";
import { ACTIVITY_LOCATION_MIGRATION, activityLocationMigrationReport, prepareActivityOwnedLocationsMigration } from "./db/activity-owned-locations";

const id = (n: number) => `20261028-0100-4000-8000-${String(n).padStart(12, "0")}`;

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55439");
  assert.equal(url.username, "postgres"); assert.equal(url.pathname, "/postgres");
  const admin = new Client({ connectionString: url.toString() }); await admin.connect();
  const name = `activity_locations_${randomUUID().replaceAll("-", "")}`;
  let created = false;
  let db: Client | undefined;
  try {
    await admin.query(`create database ${name}`); created = true;
    url.pathname = `/${name}`;
    db = new Client({ connectionString: url.toString() }); await db.connect();
    const client = db;
    const upgradeSql = readFileSync(`db/migrations/${ACTIVITY_LOCATION_MIGRATION}`, "utf8");
    await client.query("begin");
    await client.query(readFileSync("scripts/test-support/pre-activities.sql", "utf8"));
    await prepareActivityMigration(client);
    await client.query(readFileSync(`db/migrations/${ACTIVITY_MIGRATION}`, "utf8"));
    await client.query("insert into schema_migrations(name) values($1)", [ACTIVITY_MIGRATION]);
    await client.query("commit");
    for (const n of [1, 2]) await client.query("insert into organization(id,name) values($1,$2)", [id(n), `location-team-${n}`]);
    for (const n of [10, 11, 12, 13]) await client.query("insert into workspace(id,organization_id,name) values($1,$2,$3)", [id(n), id(n === 13 ? 2 : 1), `map-${n}`]);
    await client.query("insert into asset(id,organization_id,name,file_type,payload) values($1,$2,'retained image','image','{\"kind\":\"image\"}')", [id(90), id(1)]);
    await client.query("insert into asset_resource(asset_id,role,external_url) values($1,'primary','https://fixture.invalid/image.jpg')", [id(90)]);
    const activity = async (n: number, type: string, config: object, org = 1) => client.query(
      "insert into activity(id,organization_id,type,name,config) values($1,$2,$3,$4,$5)", [id(n), id(org), type, `activity-${n}`, config]);
    await activity(20, "shop_checkin", { checkinRadiusMeters: 90 });
    await activity(21, "danmaku", { maxLength: 200 });
    await activity(22, "shop_checkin", {}); // Unplaced points retain their draft state.
    await activity(23, "shop_checkin", {}, 2);
    const placement = async (n: number, a: number, workspace: number, config: object, located: boolean, radius: number | null) => client.query(`
      insert into activity_placement(id,activity_id,organization_id,workspace_id,status,config,location,radius_meters)
      values($1,$2,$3,$4,'active',$5,case when $6 then st_setsrid(st_makepoint(121.5,31.2),4326) else null end,$7)`,
    [id(n), id(a), id(a === 23 ? 2 : 1), id(workspace), config, located, radius]);
    await placement(30, 20, 10, {}, true, 1000);
    await placement(31, 20, 11, { checkinRadiusMeters: 90 }, true, 1000);
    await placement(32, 21, 10, { maxLength: 100 }, false, null);
    await placement(33, 21, 11, { maxLength: 100 }, false, null);
    await placement(34, 23, 13, {}, false, null);
    for (const [n, a, state] of [[40, 20, "active"], [41, 20, "active"], [42, 20, "active"], [43, 20, "archived"], [44, 22, "active"], [45, 23, "active"]] as const) {
      await client.query("insert into activity_point(id,activity_id,organization_id,name,state,image_asset_id,reward_asset_id) values($1,$2,$3,$4,$5,$6,$6)",
        [id(n), id(a), id(a === 23 ? 2 : 1), `point-${n}`, state, n === 40 ? id(90) : null]);
    }
    const pointPlacement = async (n: number, point: number, p: number, located: boolean, enabled: boolean) => client.query(`
      insert into activity_point_placement(id,point_id,activity_id,organization_id,placement_id,enabled,location,config)
      values($1,$2,$3,$4,$5,$6,case when $7 then st_setsrid(st_makepoint(121.5,31.2),4326) else null end,$8)`,
    [id(n), id(point), id(20), id(1), id(p), enabled, located, { legacy: { altitude: 8, tagIds: ["retained-source"] } }]);
    await pointPlacement(50, 40, 30, false, true); await pointPlacement(51, 40, 31, true, true);
    await pointPlacement(52, 41, 30, true, false); await pointPlacement(53, 41, 31, true, false);
    await pointPlacement(54, 43, 30, true, true); await pointPlacement(55, 43, 31, true, true);
    await client.query(`insert into activity_record(id,organization_id,activity_id,placement_id,point_id,participant_id,kind,idempotency_key)
      values($1,$2,$3,$4,$5,'location-device','checkin','existing-key')`, [id(60), id(1), id(20), id(30), id(40)]);
    await client.query(`insert into activity_record(id,organization_id,activity_id,placement_id,kind,content,location)
      values($1,$2,$3,$4,'danmaku','Existing message',st_setsrid(st_makepoint(121.5,31.2),4326))`, [id(61), id(1), id(21), id(32)]);

    const snapshot = async (table: string) => (await client.query(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows.map((r) => r.row);
    const preserved: Record<string, unknown[]> = {};
    const sourceRows: Record<string, unknown[]> = {};
    for (const table of ["asset", "asset_resource", "placement", "activity_record"]) preserved[table] = await snapshot(table);
    for (const table of ["activity", "activity_point", "activity_placement", "activity_point_placement"]) sourceRows[table] = await snapshot(table);
    assert.equal((await activityLocationMigrationReport(client)).conflicts.length, 0);
    const conflict = async (mutation: string, expected: string, args: unknown[]) => {
      await client.query("begin");
      await client.query(mutation, args);
      const report = await activityLocationMigrationReport(client);
      assert.ok(report.conflicts.some((row) => row.kind === expected && row.organization_id === id(1)));
      assert.ok(report.conflicts.every((row) => row.activity_id && row.sources), "Conflict reports identify actual source rows");
      await assert.rejects(prepareActivityOwnedLocationsMigration(client), /migration blocked/);
      await assert.rejects(client.query(upgradeSql), /migration blocked/);
      await client.query("rollback");
      assert.equal((await client.query("select to_regclass('migration_archive.activity_location_source') relation")).rows[0].relation, null);
      assert.equal((await client.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='activity_point' and column_name='location'")).rows[0].n, 0);
      for (const [table, rows] of Object.entries(sourceRows)) assert.deepEqual(await snapshot(table), rows, "Failed migration must be atomic");
    };
    await conflict("update activity_point_placement set location=st_setsrid(st_makepoint(120,30),4326) where id=$1", "point_location", [id(50)]);
    await conflict("update activity_placement set radius_meters=500 where id=$1", "participation_area", [id(31)]);
    await conflict("update activity_placement set location=null,radius_meters=null where id=$1", "participation_area", [id(31)]);
    await conflict("update activity_placement set location=st_setsrid(st_makepoint(120,30),4326) where id=$1", "activity_center", [id(31)]);
    await conflict("update activity_placement set location=st_setsrid(st_makepoint(121.5,31.2),4326) where id=$1", "incomplete_area", [id(32)]);
    await conflict("update activity_placement set config='{\"checkinRadiusMeters\":91}' where id=$1", "effective_config", [id(31)]);
    await conflict("update activity_placement set config='{}' where id=$1", "effective_config", [id(33)]);
    await conflict("update activity_placement set config='{\"maxLength\":\"100\"}' where id=$1", "effective_config", [id(33)]);
    await conflict("update activity_point_placement set enabled=false where id=$1", "point_enabled", [id(51)]);
    await conflict("delete from activity_point_placement where id=$1", "point_enabled", [id(51)]);
    await conflict("insert into activity_placement(activity_id,organization_id,workspace_id,status,config) values($1,$2,$3,'archived','{\"maxLength\":100}')", "duplicate_association", [id(21), id(1), id(10)]);
    await client.query("begin");
    await client.query("delete from activity_point_placement where id=$1", [id(53)]);
    assert.equal((await activityLocationMigrationReport(client)).conflicts.length, 0, "Explicit disabled and missing both mean unavailable");
    await client.query("rollback");

    // The location upgrade preserves both maps; the later single-map upgrade
    // must stop until the fixture owner explicitly chooses which links to retain.
    const blocked = spawnSync(process.execPath, ["--import", "tsx", "scripts/db/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8",
    });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Activities linked to multiple maps/);
    await client.query("update activity_placement set status='archived',lock_version=lock_version+1 where id=any($1::uuid[])", [[id(31), id(33)]]);
    // Use the actual migrator to verify integration and ledger-based replay.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/db/migrate.ts"], {
        env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    assert.equal((await client.query("select to_regclass('public.activity_point_placement') relation")).rows[0].relation, null);
    assert.equal((await client.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='activity_placement' and column_name in ('location','radius_meters','config')")).rows[0].n, 0);
    const activities = (await client.query("select id,config,st_x(location) longitude,st_y(location) latitude,radius_meters from activity order by id")).rows;
    assert.deepEqual(activities[0], { id: id(20), config: { checkinRadiusMeters: 90 }, longitude: 121.5, latitude: 31.2, radius_meters: 1000 });
    assert.deepEqual(activities[1], { id: id(21), config: { maxLength: 100 }, longitude: null, latitude: null, radius_meters: null });
    assert.deepEqual(activities[2].config, { checkinRadiusMeters: 50 });
    const points = (await client.query("select id,state,st_x(location) longitude,st_y(location) latitude,image_asset_id,reward_asset_id from activity_point order by id")).rows;
    assert.deepEqual(points[0], { id: id(40), state: "active", longitude: 121.5, latitude: 31.2, image_asset_id: id(90), reward_asset_id: id(90) });
    assert.deepEqual(points.map((point) => point.state), ["active", "archived", "archived", "archived", "active", "archived"]);
    assert.equal(points[4].longitude, null, "Unplaced point has no invented coordinate");
    for (const [table, rows] of Object.entries(preserved)) assert.deepEqual(await snapshot(table), rows, "Records and ordinary content remain byte-for-byte identical");
    for (const [table, rows] of Object.entries(sourceRows)) {
      const archive = (await client.query("select row_data from migration_archive.activity_location_source where source_table=$1 order by row_data::text", [table])).rows.map((row) => row.row_data);
      assert.deepEqual(archive, rows, "Every obsolete source row is fully retained");
    }
    await client.query("update activity_placement set status='archived',lock_version=lock_version+1 where id=$1", [id(30)]);
    await client.query("insert into activity_placement(id,activity_id,organization_id,workspace_id,status) values($1,$2,$3,$4,'active')", [id(35), id(20), id(1), id(12)]);
    await client.query("update activity_placement set status='archived' where id=$1", [id(35)]);
    await assert.rejects(client.query("insert into activity_placement(activity_id,organization_id,workspace_id) values($1,$2,$3)", [id(20), id(1), id(12)]), { code: "23505" });
    await client.query("update activity_placement set status='active' where id=$1", [id(35)]);
    const write = (point: number, activityId = 20, org = 1) => client.query(`insert into activity_record(organization_id,activity_id,placement_id,point_id,participant_id,kind)
      values($1,$2,$3,$4,$5,'checkin')`, [id(org), id(activityId), id(35), id(point), `new-map-${point}-${activityId}-${org}`]);
    await write(40); // Fixed activity point automatically belongs to a new map deployment.
    await assert.rejects(write(44), { code: "23503" });
    await assert.rejects(write(45), { code: "23503" });
    await assert.rejects(write(40, 20, 2), { code: "23503" });
    await assert.rejects(client.query("delete from activity_point where id=$1", [id(40)]), { code: "23503" });
    await assert.rejects(client.query("update activity set location=null where id=$1", [id(20)]), { code: "23514" });
    await assert.rejects(client.query("update activity set radius_meters=null where id=$1", [id(20)]), { code: "23514" });
    await assert.rejects(client.query("update activity set location=st_setsrid(st_makepoint(121.5,31.2),4326) where id=$1", [id(21)]), { code: "23514" });
    await assert.rejects(client.query("update activity set radius_meters='Infinity'::float8 where id=$1", [id(20)]), { code: "23514" });
    await assert.rejects(client.query("update activity_point set location=st_setsrid(st_makepoint(181,31),4326) where id=$1", [id(40)]), { code: "23514" });
    await client.query("select purge_organizations($1::uuid[])", [[id(1), id(2)]]);
    assert.equal((await client.query("select count(*)::int n from activity_record")).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from activity")).rows[0].n, 0);
    assert.ok((await client.query("select count(*)::int n from migration_archive.activity_location_source")).rows[0].n > 0);
    console.log("PASS activity-owned locations: eleven conflict/rollback cases, complete participation areas, unique map association including archives, effective overrides/defaults, null convergence, missing/disabled points, archived and unplaced state, exact archives/content/record preservation, fixed-point FK isolation, purge and migrator replay");
  } finally {
    await db?.end();
    if (created) await admin.query(`drop database ${name}`);
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
