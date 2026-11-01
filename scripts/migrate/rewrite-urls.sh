#!/usr/bin/env bash
# One-shot migration, step 3: point stored media URLs at the new host.
#
#   DATABASE_URL=postgres://… scripts/migrate/rewrite-urls.sh \
#       https://<ref>.supabase.co/storage/v1/object/public \
#       https://your-media-bucket.oss-cn-shanghai.aliyuncs.com
#
# Rewrites the three columns that hold storage URLs with one rule, in one
# transaction, with triggers off: invalidate_anchor_embedding would otherwise
# wipe every anchor's reference features because file_url "changed".
# Object paths are unchanged (assets/… and wechat-qrcodes/… keep their names),
# so only the prefix differs. Safe to re-run (no-op once nothing matches).
set -euo pipefail
cd "$(dirname "$0")/../.."
OLD=${1:?old URL prefix, e.g. https://xxx.supabase.co/storage/v1/object/public}
NEW=${2:?new URL prefix, e.g. https://media.example.com}
: "${DATABASE_URL:?set DATABASE_URL to the target database}"
OLD=${OLD%/}; NEW=${NEW%/}

PGBIN=$( [ -x "$(brew --prefix libpq 2>/dev/null)/bin/psql" ] && echo "$(brew --prefix libpq)/bin" || dirname "$(command -v psql)" )

"$PGBIN/psql" "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -v old="$OLD/" -v new="$NEW/" <<'SQL'
set session_replication_role = replica;

select 'before: asset.file_url' as what, count(*) from public.asset where file_url like :'old' || '%'
union all select 'before: asset.metadata.checkin_url', count(*) from public.asset where metadata->>'checkin_url' like :'old' || '%'
union all select 'before: anchor_embedding.image_url', count(*) from public.anchor_embedding where image_url like :'old' || '%';

update public.asset
  set file_url = replace(file_url, :'old', :'new')
  where file_url like :'old' || '%';

update public.asset
  set metadata = jsonb_set(metadata, '{checkin_url}', to_jsonb(replace(metadata->>'checkin_url', :'old', :'new')))
  where metadata->>'checkin_url' like :'old' || '%';

update public.anchor_embedding
  set image_url = replace(image_url, :'old', :'new')
  where image_url like :'old' || '%';

select 'after: still old' as what,
  (select count(*) from public.asset where file_url like :'old' || '%')
  + (select count(*) from public.asset where metadata->>'checkin_url' like :'old' || '%')
  + (select count(*) from public.anchor_embedding where image_url like :'old' || '%') as count
union all select 'after: on new host', (select count(*) from public.asset where file_url like :'new' || '%');

set session_replication_role = default;
SQL
