/** Account cutover regression on a NEW disposable validation database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55439");
  assert.equal(url.pathname, "/postgres", "use the validation cluster's admin database");
  const name = `identity_migration_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  let created = false;
  let db: Client | undefined;
  try {
    await admin.query(`create database ${name}`); created = true;
    url.pathname = `/${name}`;
    const migrated = spawnSync(process.execPath, ["--import", "tsx", "scripts/db/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: url.toString(), NEXT_PUBLIC_MEDIA_BASE_URL: "https://identity-test.invalid" },
      encoding: "utf8",
    });
    assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
    db = new Client({ connectionString: url.toString() }); await db.connect();
    const connection = db;
    const migration = readFileSync("db/migrations/20261101000000_spatial_memory_identity.sql", "utf8");
    const phoneId = randomUUID();
    const otherId = randomUUID();
    const uppercaseId = randomUUID();
    await db.query(`insert into auth.users(id,email) values
      ($1,'13800138000@phone.sanlinlaojie.local'),
      ($2,'retained@example.invalid'),
      ($3,'13700137000@PHONE.SANLINLAOJIE.LOCAL')`, [phoneId, otherId, uppercaseId]);
    await db.query(`insert into auth.account(user_id,account_id,provider_id,password)
      values($1,$2,'credential','unchanged-password-hash')`, [phoneId, phoneId]);
    await db.query(`insert into auth.session(user_id,token,expires_at)
      values($1,'unchanged-session-token',now()+interval '30 days')`, [phoneId]);
    await db.query(`insert into auth.verification(identifier,value,expires_at) values
      ('13800138000@phone.sanlinlaojie.local','email-challenge',now()+interval '1 hour'),
      ('signed-account-challenge','{"email":"13700137000@PHONE.SANLINLAOJIE.LOCAL"}',now()+interval '1 hour'),
      ('unrelated-oauth-state','unmodified-signed-value',now()+interval '1 hour')`);
    const snapshot = async () => ({
      users: (await connection.query("select * from auth.users order by id")).rows,
      publicUsers: (await connection.query("select * from public.users order by user_id")).rows,
      accounts: (await connection.query("select * from auth.account order by id")).rows,
      sessions: (await connection.query("select * from auth.session order by id")).rows,
      verifications: (await connection.query("select * from auth.verification order by id")).rows,
    });
    const upgrade = async () => {
      await connection.query("begin");
      try { await connection.query(migration); await connection.query("commit"); }
      catch (error) { await connection.query("rollback"); throw error; }
    };
    const before = await snapshot();
    const conflictId = randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'13800138000@PHONE.SPATIALMEMORY.LOCAL')", [conflictId]);
    const conflictBefore = await snapshot();
    await assert.rejects(upgrade(), /account destination conflict/);
    assert.deepEqual(await snapshot(), conflictBefore, "A collision must not change any account or challenge");
    await db.query("delete from auth.users where id=$1", [conflictId]);
    const malformedId = randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'unexpected@phone.sanlinlaojie.local')", [malformedId]);
    const malformedBefore = await snapshot();
    await assert.rejects(upgrade(), /unexpected legacy account format/);
    assert.deepEqual(await snapshot(), malformedBefore);
    await db.query("delete from auth.users where id=$1", [malformedId]);

    // A missing/broken sync trigger must fail, rather than leave account tables
    // disagreeing and make management search diverge from authentication.
    await db.query("alter table auth.users disable trigger on_auth_user_email_changed");
    await assert.rejects(upgrade(), /did not synchronize/);
    await db.query("alter table auth.users enable trigger on_auth_user_email_changed");
    assert.deepEqual(await snapshot(), before);
    await db.query("begin");
    await db.query(migration);
    await db.query("rollback");
    assert.deepEqual(await snapshot(), before, "Migration and challenge expiry must roll back together");
    await upgrade();
    const after = await snapshot();
    assert.deepEqual(after.accounts, before.accounts, "Credential hashes and account IDs stay usable");
    assert.deepEqual(after.sessions, before.sessions, "Existing session tokens and user IDs survive");
    assert.deepEqual(after.users.find((user) => user.id === otherId), before.users.find((user) => user.id === otherId));
    assert.equal(after.users.find((user) => user.id === phoneId)?.email, "13800138000@phone.spatialmemory.local");
    assert.equal(after.users.find((user) => user.id === uppercaseId)?.email, "13700137000@phone.spatialmemory.local");
    for (const user of after.users) {
      assert.equal(after.publicUsers.find((publicUser) => publicUser.user_id === user.id)?.email, user.email);
    }
    assert.deepEqual(after.verifications, before.verifications.filter((entry) => entry.identifier === "unrelated-oauth-state"));
    await upgrade();
    assert.deepEqual(await snapshot(), after, "A replay must not touch already migrated accounts");
    console.log("PASS phone identity migration: case-insensitive collisions, malformed account rejection, trigger enforcement, rollback, stable passwords/sessions, challenge expiry, unrelated account/OAuth preservation and replay");
  } finally {
    await db?.end();
    if (created) await admin.query(`drop database ${name}`);
    await admin.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Identity migration test failed"); process.exitCode = 1; });
