#!/usr/bin/env bash
# Nightly database backup, installed on the server by scripts/deploy.sh as
# /opt/spatial-memory/backup.sh and run from /etc/cron.d/spatial-memory-backup.
#
# pg_dump (compressed custom format, inside the db container) → private OSS bucket
# spatial-memory-backups/db/<timestamp>.dump, which expires objects after 30 days
# (bucket lifecycle rule). Local copies are kept for 3 days in /opt/spatial-memory/backups.
#
# Restore: ossutil cp oss://spatial-memory-backups/db/<file> . &&
#   docker compose exec -T db pg_restore -U spatial_memory -d spatial_memory --clean --if-exists < <file>
set -euo pipefail
DIR=/opt/spatial-memory
cd "$DIR"
set -a; . ./.env; set +a

BACKUP_BUCKET=${BACKUP_BUCKET:-spatial-memory-backups}
ENDPOINT=${OSS_BACKUP_ENDPOINT:-oss-cn-shanghai-internal.aliyuncs.com}
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="backups/spatial-memory-$STAMP.dump"

docker compose exec -T db pg_dump -U spatial_memory -d spatial_memory --format=custom --compress=6 > "$FILE"
SIZE=$(stat -c %s "$FILE")
[ "$SIZE" -gt 1024 ] || { echo "backup too small ($SIZE bytes)"; exit 1; }

ossutil cp -f "$FILE" "oss://$BACKUP_BUCKET/db/spatial-memory-$STAMP.dump" \
  -e "$ENDPOINT" -i "$ALIBABA_CLOUD_ACCESS_KEY_ID" -k "$ALIBABA_CLOUD_ACCESS_KEY_SECRET" >/dev/null

find backups -name 'spatial-memory-*.dump' -mtime +3 -delete
echo "backup ok: $FILE ($SIZE bytes) → oss://$BACKUP_BUCKET/db/"
