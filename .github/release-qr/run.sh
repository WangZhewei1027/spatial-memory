#!/usr/bin/env bash
set -euo pipefail
umask 077
files=$(realpath "$1")
cd /opt/spatial-memory
dbrole=spatial_memory
replica="sm_release_20261125_$$"
migration=20261125000000_wechat_qr_center_image.sql
db() { docker compose exec -T db psql -XAtq -v ON_ERROR_STOP=1 -U "$dbrole" -d "$1" "${@:2}"; }
check_ledger() {
  db "$1" -c "select name from public.schema_migrations order by name" > "$files/installed.txt"
  find "$files/migrate/db/migrations" -name '*.sql' -printf '%f\n' | LC_ALL=C sort > "$files/required.txt"
  local pending
  pending=$(LC_ALL=C comm -23 "$files/required.txt" "$files/installed.txt")
  [[ -z "$pending" || "$pending" == "$migration" ]] || { echo "Unexpected pending migration: $pending"; return 1; }
}
migrate_and_verify() {
  check_ledger "$1"
  docker compose run --rm --no-deps -T -e PGOPTIONS='-c lock_timeout=5s' -v "$files/migrate:/release:ro" -w /release --entrypoint node app /release/migrate-target.cjs "$1" </dev/null
  db "$1" < "$files/gate.sql"
  local shape
  shape=$(db "$1" -c "select (select count(*) from information_schema.columns where table_schema='public' and table_name='organization' and column_name='wechat_qr_center_image_key' and data_type='text' and is_nullable='YES'), (select count(*) from pg_index where indexrelid=to_regclass('public.organization_wechat_qr_center_image_key') and indisvalid), (select count(*) from public.schema_migrations where name='$migration')")
  [[ "$shape" == '1|1|1' ]]
}
team_fingerprint() {
  db "$1" -c "select count(*), md5(coalesce(string_agg(md5((to_jsonb(o) - 'wechat_qr_center_image_key')::text),'' order by id),'')) from public.organization o"
}
check_ledger spatial_memory
bash ./backup.sh </dev/null > "$files/backup.log"
backup=$(sed -n 's/^backup ok: \([^ ]*\) .*/\1/p' "$files/backup.log" | tail -1)
[[ "$backup" =~ ^backups/spatial-memory-[0-9]{8}-[0-9]{6}\.dump$ && -s "$backup" ]]
docker compose exec -T db pg_restore --list < "$backup" > "$files/backup.toc"
echo "Verified private production backup $backup"
docker compose exec -T db createdb -U "$dbrole" --template=template0 "$replica"
trap 'docker compose exec -T db dropdb -U "$dbrole" --if-exists "$replica"' EXIT
docker compose exec -T db pg_restore --no-owner --no-acl --exit-on-error -U "$dbrole" -d "$replica" < "$backup"
before=$(team_fingerprint "$replica")
migrate_and_verify "$replica"
[[ "$before" == "$(team_fingerprint "$replica")" ]]
echo 'PASS restored production copy, schema gate and team data preservation'
migrate_and_verify spatial_memory
echo 'PASS production database ledger, nullable team field and valid index'
