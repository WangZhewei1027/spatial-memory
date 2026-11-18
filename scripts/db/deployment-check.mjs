#!/usr/bin/env node
// Emit read-only SQL for psql -v ON_ERROR_STOP=1. No credentials or DB client needed
// on the build host; run this against the target database before shipping an image.
import { readdirSync } from "node:fs";

const migrations = readdirSync(new URL("../../db/migrations/", import.meta.url))
  .filter((name) => name.endsWith(".sql")).sort();
if (!migrations.length) throw new Error("No database migrations found");
const literals = migrations.map((name) => `'${name.replaceAll("'", "''")}'`).join(",");
process.stdout.write(`BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
DO $check$
DECLARE missing text[];
BEGIN
  IF to_regclass('public.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Deployment blocked: database has no migration ledger. Run db:migrate before deploying.';
  END IF;
  SELECT array_agg(name ORDER BY name) INTO missing
  FROM unnest(ARRAY[${literals}]) AS required(name)
  WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations m WHERE m.name=required.name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment blocked: pending database migrations: %', array_to_string(missing, ', ');
  END IF;
  SELECT array_agg(r.table_name || '.' || r.column_name) INTO missing
  FROM (VALUES ('asset','payload'), ('asset_resource','asset_id'),
    ('scene','document'), ('placement','scene_id'), ('placement','asset_id'),
    ('activity','type'), ('activity','location'), ('activity','radius_meters'),
    ('activity_point','reward_asset_id'), ('activity_point','location'),
    ('activity_placement','activity_id'),
    ('activity_record','placement_id'), ('activity_record','kind'),
    ('workspace','archived_at'), ('organization','archived_at'),
    ('organization','is_official_template_library'), ('template_preview','storage_key')) AS r(table_name,column_name)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment blocked: migration ledger disagrees with schema; missing %', array_to_string(missing, ', ');
  END IF;
  IF to_regclass('public.asset_version') IS NOT NULL OR to_regclass('public.scene_revision') IS NOT NULL
    OR to_regclass('public.activity_point_placement') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND (table_name='asset' AND column_name IN ('workspace_id','current_version_id')
        OR table_name='scene' AND column_name='draft_document'
        OR table_name='placement' AND column_name IN ('asset_version_id','scene_revision_id')
        OR table_name='activity_placement' AND column_name IN ('location','radius_meters','config'))) THEN
    RAISE EXCEPTION 'Deployment blocked: obsolete runtime content structures still exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.asset WHERE file_type='shop' OR (file_type='text' AND origin='public_submission')) THEN
    RAISE EXCEPTION 'Deployment blocked: unmigrated shop or public-submission assets remain';
  END IF;
END
$check$;
COMMIT;
`);
