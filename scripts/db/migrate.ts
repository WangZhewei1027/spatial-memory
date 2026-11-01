import { migrateTransformScenes } from "../migrate/transform-scenes";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { loadEnvFile, requireEnv } from "../lib/env";
import { migrateUnversionedContent } from "../migrate/content-model/unify";
import { migrateTheatreScenes } from "../migrate/theatre-scenes";
import { parseArchiveReview } from "../migrate/content-model/archive-review";
import { ACTIVITY_MIGRATION, parseActivityReview, prepareActivityMigration } from "./activity-migration";
import { ACTIVITY_LOCATION_MIGRATION, prepareActivityOwnedLocationsMigration } from "./activity-owned-locations";

/**
 * Apply the database schema.
 *
 *   npx tsx scripts/db/migrate.ts            # uses DATABASE_URL from .env.local
 *   DATABASE_URL=postgres://… npx tsx scripts/db/migrate.ts
 *
 * A fresh database gets db/schema.sql (the baseline). Then every file in
 * db/migrations/ is applied in name order unless schema_migrations already
 * lists it. Each file runs in its own transaction.
 */
async function main() {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--archive-review", "--activity-review"].includes(args[index]) || !args[index + 1] || options.has(args[index]))
      throw new Error("Usage: db:migrate [--archive-review path/to/review.json] [--activity-review path/to/review.json]");
    options.set(args[index], args[index + 1]);
  }
  const readReview = (flag: string): unknown => JSON.parse(readFileSync(resolve(options.get(flag)!), "utf8"));
  const archiveReview = options.has("--archive-review") ? parseArchiveReview(readReview("--archive-review")) : [];
  const activityReview = options.has("--activity-review") ? parseActivityReview(readReview("--activity-review")) : [];
  loadEnvFile();
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();

  try {
    // A single migration owner per database also protects the fresh-baseline
    // decision. App instances must not race while both see an empty ledger.
    // Production identity cutover stops every old migration runner before
    // switching this lock; do not run pre-cutover runners on the renamed DB.
    await client.query("select pg_advisory_lock(hashtext('spatial-memory.schema-migrations'))");
    const { rows } = await client.query<{ exists: boolean }>(
      "select to_regclass('public.schema_migrations') is not null as exists",
    );
    if (!rows[0].exists) {
      const existing = await client.query<{ relation: string | null }>(
        "select to_regclass(name)::text as relation from unnest(array['public.organization','public.workspace','public.asset','auth.users']) as name",
      );
      if (existing.rows.some((row) => row.relation !== null)) {
        throw new Error("Existing application tables have no migration ledger; inspect and restore the ledger before applying a baseline");
      }
      console.log("fresh database: applying db/schema.sql");
      await client.query("begin");
      try {
        await client.query(readFileSync(resolve("db/schema.sql"), "utf8"));
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    const applied = new Set(
      (await client.query<{ name: string }>("select name from schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );

    let files: string[] = [];
    try {
      files = readdirSync(resolve("db/migrations"))
        .filter((f) => f.endsWith(".sql"))
        .sort();
    } catch {
      // no migrations directory yet
    }

    for (const file of files) {
      if (applied.has(file)) continue;
      console.log(`applying ${file}`);
      await client.query("begin");
      try {
        if (file === "20261017180000_single_content_model.sql") await migrateUnversionedContent(client, process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "", archiveReview);
        if (file === "20261019000000_native_theatre_scenes.sql") await migrateTheatreScenes(client);
        if (file === "20261020000000_transform_scenes.sql") await migrateTransformScenes(client);
        if (file === ACTIVITY_MIGRATION) await prepareActivityMigration(client, activityReview);
        if (file === ACTIVITY_LOCATION_MIGRATION) await prepareActivityOwnedLocationsMigration(client);
        await client.query(readFileSync(resolve("db/migrations", file), "utf8"));
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
    console.log("database is up to date");
  } finally {
    try { await client.query("select pg_advisory_unlock(hashtext('spatial-memory.schema-migrations'))"); }
    finally { await client.end(); }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
