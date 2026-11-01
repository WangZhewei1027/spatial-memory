/**
 * One-time media origin cutover. Defaults to a read-only data audit; temporary
 * SQL functions exist only for this connection. No environment file is loaded.
 *
 * DATABASE_URL=... npx tsx scripts/migrate/spatial-memory-media.ts \
 *   --source-origin https://sanlinlaojie-media.oss-cn-shanghai.aliyuncs.com \
 *   --source-origin http://sanlinlaojie-media.oss-cn-shanghai.aliyuncs.com \
 *   --target-origin https://spatial-memory-media.oss-cn-shanghai.aliyuncs.com
 * Add --execute only after copying/verifying objects and stopping all writers.
 * Redirect stdout to a private JSON evidence file. No rows or secrets are logged.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

const mutableColumns = new Set([
  "public.activity.name", "public.activity.description", "public.activity.config",
  "public.activity_point.name", "public.activity_point.description",
  "public.activity_record.content", "public.activity_record.metadata", "public.activity_record.render_config",
  "public.anchor_embedding.image_url", "public.app_config.value",
  "public.asset.name", "public.asset.payload", "public.asset_resource.external_url",
  "public.organization.name", "public.organization.description", "public.organization.config",
  "public.placement.name", "public.placement.render_config",
  "public.scene.name", "public.scene.document", "public.tag.name",
  "public.users.name", "public.workspace.name", "public.workspace.description",
  "auth.users.name", "auth.users.image",
]);
// These records describe what happened at the time, not the current content.
const historicalTables = new Set(["public.content_audit_log", "public.error_log", "public.schema_migrations"]);
type Column = { schema: string; table: string; column: string; type: string };
type Table = { schema: string; table: string };
export type MediaMigrationOptions = { sources: string[]; target: string; execute: boolean };
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const qualified = (table: Table) => `${identifier(table.schema)}.${identifier(table.table)}`;
const tableName = (table: Table) => `${table.schema}.${table.table}`;
const columnName = (column: Column) => `${tableName(column)}.${column.column}`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function origin(value: string): URL {
  const parsed = new URL(value);
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Expected an HTTP(S) origin without credentials, path, query or fragment");
  }
  return parsed;
}

function sourcePattern(value: string): string {
  const parsed = origin(value);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const port = parsed.port ? `:${escape(parsed.port)}` : `(?::${parsed.protocol === "https:" ? "443" : "80"})?`;
  // Boundary prevents rewriting another hostname, a URL user-info prefix, or
  // a different port. Paths, query strings and fragments remain byte-identical.
  return `${escape(parsed.protocol)}//${escape(parsed.hostname)}${port}(?=[/?#[:space:]"'<>()\\[\\]{},;!]|$)`;
}

const helpers = `
CREATE OR REPLACE FUNCTION pg_temp.spatial_memory_rewrite_text(input text, patterns text[], target_origin text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
DECLARE result text := input; pattern text;
BEGIN
  FOREACH pattern IN ARRAY patterns LOOP
    result := regexp_replace(result, pattern, target_origin, 'gi');
  END LOOP;
  RETURN result;
END
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.spatial_memory_rewrite_json(input jsonb, patterns text[], target_origin text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
DECLARE result jsonb;
BEGIN
  CASE jsonb_typeof(input)
  WHEN 'string' THEN RETURN to_jsonb(pg_temp.spatial_memory_rewrite_text(input #>> '{}', patterns, target_origin));
  WHEN 'object' THEN
    SELECT coalesce(jsonb_object_agg(entry.key, pg_temp.spatial_memory_rewrite_json(entry.value, patterns, target_origin)), '{}'::jsonb)
    INTO result FROM jsonb_each(input) entry;
    RETURN result;
  WHEN 'array' THEN
    SELECT coalesce(jsonb_agg(pg_temp.spatial_memory_rewrite_json(entry.value, patterns, target_origin) ORDER BY entry.ordinality), '[]'::jsonb)
    INTO result FROM jsonb_array_elements(input) WITH ORDINALITY entry(value, ordinality);
    RETURN result;
  ELSE RETURN input;
  END CASE;
END
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.spatial_memory_origin_count(input text, patterns text[])
RETURNS bigint LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
DECLARE result bigint := 0; pattern text;
BEGIN
  FOREACH pattern IN ARRAY patterns LOOP result := result + regexp_count(input, pattern, 1, 'i'); END LOOP;
  RETURN result;
END
$fn$;`;

function replacement(column: Column, prefix = ""): string {
  const name = `${prefix}${identifier(column.column)}`;
  return column.type === "jsonb" || column.type === "json"
    ? `pg_temp.spatial_memory_rewrite_json(${name}::jsonb, $1, $2)`
    : `pg_temp.spatial_memory_rewrite_text(${name}, $1, $2)`;
}

export async function migrateMediaOrigins(db: Client, options: MediaMigrationOptions) {
  if (!options.sources.length) throw new Error("At least one explicit source origin is required");
  const sources = [...new Set(options.sources.map((value) => origin(value).origin))];
  const target = origin(options.target).origin;
  if (sources.includes(target)) throw new Error("Source and target origins must differ");
  const patterns = sources.map(sourcePattern);
  await db.query("begin isolation level repeatable read");
  try {
    await db.query("set local lock_timeout = '15s'");
    await db.query("set local statement_timeout = '120s'");
    await db.query(helpers);
    const tables = (await db.query<Table>(`select n.nspname as schema, c.relname as table
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth') and c.relkind in ('r','p')
      order by n.nspname,c.relname`)).rows;
    if (options.execute && tables.length) {
      // Stabilize accounts, content and references together. An ordinary Web
      // writer cannot interleave with the hash comparison or retain an old URL.
      await db.query(`lock table ${tables.map(qualified).join(",")} in share row exclusive mode`);
    }
    const columns = (await db.query<Column>(`select c.table_schema as schema,c.table_name as table,c.column_name as column,c.data_type as type
      from information_schema.columns c join pg_namespace n on n.nspname=c.table_schema
      join pg_class t on t.relnamespace=n.oid and t.relname=c.table_name and t.relkind in ('r','p')
      where c.table_schema in ('public','auth') and (c.data_type in ('text','character varying','character','json','jsonb')
        or (c.data_type='ARRAY' and c.udt_name in ('_text','_varchar','_bpchar')))
      order by c.table_schema,c.table_name,c.ordinal_position`)).rows;
    const findings: { column: string; rows: number; occurrences: number; remainingAfterRewrite: number; disposition: string }[] = [];
    const observedLegacyOrigins = new Set<string>();
    for (const column of columns) {
      const value = identifier(column.column);
      const allowed = mutableColumns.has(columnName(column));
      const normalized = allowed ? replacement(column) : value;
      const result = await db.query<{ rows: string; occurrences: string | null; remaining: string | null }>(`
        select count(*) filter(where hits > 0) as rows, coalesce(sum(hits),0) as occurrences,
          coalesce(sum(remaining),0) as remaining
        from (select pg_temp.spatial_memory_origin_count(${value}::text,$1) as hits,
          pg_temp.spatial_memory_origin_count((${normalized})::text,$1) as remaining
          from ${qualified(column)}) counts`, allowed ? [patterns, target] : [patterns]);
      const counts = result.rows[0];
      if (Number(counts.occurrences)) {
        findings.push({ column: columnName(column), rows: Number(counts.rows), occurrences: Number(counts.occurrences),
          remainingAfterRewrite: Number(counts.remaining),
          disposition: historicalTables.has(tableName(column)) ? "historical-preserved"
            : allowed && Number(counts.remaining) === 0 ? "rewrite" : "blocked-unreviewed-location" });
      }
      const observed = await db.query<{ origin: string }>(`select distinct lower(m[1]) as origin
        from ${qualified(column)} cross join lateral
        regexp_matches(${value}::text,'(https?://[a-z0-9][a-z0-9.-]*(:[0-9]+)?)','gi') as m
        where m[1] ~* 'sanlin'`);
      for (const row of observed.rows) observedLegacyOrigins.add(row.origin);
    }
    const blockers = findings.filter((finding) => finding.disposition === "blocked-unreviewed-location");
    const changedColumns = new Set(findings.filter((finding) => finding.disposition === "rewrite").map((finding) => finding.column));
    const inventory = columns.map((column) => ({ column: columnName(column), type: column.type,
      disposition: historicalTables.has(tableName(column)) ? "historical-preserved" : mutableColumns.has(columnName(column)) ? "mutable-url-values" : "audit-only" }));
    const evidence: { table: string; rows: number; beforeSha256: string; expectedSha256: string; afterSha256?: string; verified?: boolean }[] = [];
    const tableSnapshot = async (table: Table, normalize: boolean) => {
      const fields = normalize ? columns.filter((column) => tableName(column) === tableName(table) && changedColumns.has(columnName(column))) : [];
      const expected = fields.length ? `to_jsonb(t) || jsonb_build_object(${fields.map((column) => `${literal(column.column)},${replacement(column, "t.")}`).join(",")})` : "to_jsonb(t)";
      const rows = (await db.query<{ before: string; expected: string }>(
        `select to_jsonb(t)::text as before, (${expected})::text as expected from ${qualified(table)} t`, fields.length ? [patterns, target] : [],
      )).rows;
      const hashRows = (field: "before" | "expected") => digest(rows.map((row) => digest(row[field])).sort().join("\n"));
      return { rows: rows.length, before: hashRows("before"), expected: hashRows("expected") };
    };
    for (const table of tables) {
      const snapshot = await tableSnapshot(table, true);
      evidence.push({ table: tableName(table), rows: snapshot.rows, beforeSha256: snapshot.before, expectedSha256: snapshot.expected });
    }
    if (options.execute) {
      if (blockers.length) throw new Error(`Unreviewed runtime URL locations: ${blockers.map((entry) => entry.column).join(", ")}`);
      const assetTrigger = (await db.query<{ tgenabled: string }>(`select tgenabled from pg_trigger
        where tgrelid=to_regclass('public.asset') and tgname='trg_asset_set_updated_at' and not tgisinternal`)).rows[0];
      const changesAsset = columns.some((column) => column.schema === "public" && column.table === "asset" && changedColumns.has(columnName(column)));
      if (changesAsset && assetTrigger && assetTrigger.tgenabled !== "D") {
        await db.query("alter table public.asset disable trigger trg_asset_set_updated_at");
      }
      await db.query("select set_config('content_model.writer','migration',true)");
      for (const table of tables) {
        const fields = columns.filter((column) => tableName(column) === tableName(table) && changedColumns.has(columnName(column)));
        if (!fields.length) continue;
        await db.query(`update ${qualified(table)} set ${fields.map((column) => `${identifier(column.column)}=${replacement(column)}`).join(",")}
          where ${fields.map((column) => `pg_temp.spatial_memory_origin_count(${identifier(column.column)}::text,$1)>0`).join(" or ")}`, [patterns, target]);
      }
      if (changesAsset && assetTrigger && assetTrigger.tgenabled !== "D") {
        const mode = assetTrigger.tgenabled === "A" ? "enable always" : assetTrigger.tgenabled === "R" ? "enable replica" : "enable";
        await db.query(`alter table public.asset ${mode} trigger trg_asset_set_updated_at`);
      }
      for (let index = 0; index < tables.length; index++) {
        const after = await tableSnapshot(tables[index], false);
        const record = evidence[index];
        record.afterSha256 = after.before;
        record.verified = record.rows === after.rows && record.expectedSha256 === after.before;
        if (!record.verified) throw new Error(`Preservation check failed for ${record.table}; transaction rolled back`);
      }
    }
    const report = { mode: options.execute ? "executed" : "dry-run", sources, target, findings,
      observedLegacyOrigins: [...observedLegacyOrigins].sort(), blocked: blockers.length > 0,
      columnInventory: inventory, tableEvidence: evidence, excludedSchemas: ["migration_archive"] };
    await db.query(options.execute ? "commit" : "rollback");
    return report;
  } catch (error) { await db.query("rollback"); throw error; }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("An explicit DATABASE_URL is required");
  const options: MediaMigrationOptions = { sources: [], target: "", execute: false };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--execute") options.execute = true;
    else if ((argument === "--source-origin" || argument === "--target-origin") && args[index + 1]) {
      const value = args[++index];
      if (argument === "--source-origin") options.sources.push(value); else options.target = value;
    } else throw new Error("Usage: --source-origin ORIGIN [--source-origin ORIGIN] --target-origin ORIGIN [--execute]");
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { console.log(JSON.stringify(await migrateMediaOrigins(db, options), null, 2)); }
  finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Database error details can contain row values or credentials. Emit only
    // the error code; our own operational assertions contain no row content.
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    console.error(JSON.stringify({ failed: true, error: code ? "Database migration failed" : error instanceof Error ? error.message : "Migration failed", code }));
    process.exitCode = 1;
  });
}
