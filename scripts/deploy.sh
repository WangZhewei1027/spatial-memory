#!/usr/bin/env bash
# Build the production image locally and roll it out to the Aliyun server.
#
#   scripts/deploy.sh                      # uses deploy/.env.production
#   scripts/deploy.sh deploy/.env.staging
#   SKIP_BUILD=1 scripts/deploy.sh         # re-ship the last built image
#
# Steps: buildx (linux/amd64) → docker save | ssh docker load → copy compose +
# Caddyfile + env → docker compose up -d. Base images (postgis, caddy) are
# shipped the same way the first time, since the server cannot reach Docker Hub.
# Database migrations are NOT run here — see scripts/db/migrate.ts (run it
# through an SSH tunnel: scripts/db-tunnel.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=${1:-deploy/.env.production}
HOST=${DEPLOY_HOST:-root@139.196.189.102}
# Production resource identity; provision/migrate it before deploying.
DIR=${DEPLOY_DIR:-/opt/spatial-memory}
TAG=$(git rev-parse --short HEAD)$( [ -n "$(git status --porcelain)" ] && echo "-dirty" || true )
IMAGE=spatial-memory

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (see deploy/env.example)"; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- ; }

echo "▶ checking target database migrations (read-only)"
node scripts/db/deployment-check.mjs | ssh "$HOST" \
  "cd $DIR && docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U spatial_memory -d spatial_memory"

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "▶ building $IMAGE:$TAG (linux/amd64)"
  docker buildx build --platform linux/amd64 --load \
    --build-arg NEXT_PUBLIC_SITE_URL="$(env_value NEXT_PUBLIC_SITE_URL)" \
    --build-arg NEXT_PUBLIC_MEDIA_BASE_URL="$(env_value NEXT_PUBLIC_MEDIA_BASE_URL)" \
    --build-arg NEXT_PUBLIC_TIANDITU_KEY="$(env_value NEXT_PUBLIC_TIANDITU_KEY)" \
    -t "$IMAGE:$TAG" -t "$IMAGE:latest" .
else
  docker tag "$IMAGE:latest" "$IMAGE:$TAG"
fi

ship_image() {
  local image=$1
  if ssh "$HOST" "docker image inspect $image >/dev/null 2>&1"; then
    echo "▶ $image already on server"
  else
    echo "▶ shipping $image"
    docker save "$image" | gzip -1 | ssh "$HOST" "gunzip | docker load"
  fi
}

ship_image postgis/postgis:17-3.5
ship_image caddy:2-alpine
PGADMIN_IMAGE=$(awk '/^  pgadmin:$/ {found=1; next} found && $1=="image:" {print $2; exit}' deploy/docker-compose.yml)
if ! ssh "$HOST" "docker image inspect '$PGADMIN_IMAGE' >/dev/null 2>&1"; then
  docker image inspect "$PGADMIN_IMAGE" >/dev/null 2>&1 || docker pull --platform linux/amd64 "$PGADMIN_IMAGE"
  ship_image "$PGADMIN_IMAGE"
fi
echo "▶ shipping $IMAGE:$TAG"
docker save "$IMAGE:$TAG" | gzip -1 | ssh "$HOST" "gunzip | docker load"

echo "▶ copying compose files"
ssh "$HOST" "mkdir -p $DIR"
ssh "$HOST" "test -s $DIR/pgadmin/private/login-password || { echo 'Provision pgAdmin first (docs/pgadmin.md)'; exit 1; }"
CADDYFILE=$(env_value CADDYFILE); CADDYFILE=${CADDYFILE:-Caddyfile}
scp -q deploy/docker-compose.yml deploy/backup.sh "$HOST:$DIR/"
scp -q deploy/pgadmin/servers.json deploy/pgadmin/provision.py "$HOST:$DIR/pgadmin/"
scp -q "deploy/$CADDYFILE" "$HOST:$DIR/Caddyfile"
scp -q "$ENV_FILE" "$HOST:$DIR/.env"
ssh "$HOST" "chmod 600 $DIR/.env; chmod +x $DIR/backup.sh"

echo "▶ nightly backup cron (03:30 server time) + ossutil"
ssh "$HOST" 'command -v ossutil >/dev/null || (curl -fsSL https://gosspublic.alicdn.com/ossutil/install.sh | bash >/dev/null 2>&1) || echo "ossutil install failed — backups will not upload"
printf "30 3 * * * root /opt/spatial-memory/backup.sh >> /var/log/spatial-memory-backup.log 2>&1\n" > /etc/cron.d/spatial-memory-backup && chmod 644 /etc/cron.d/spatial-memory-backup'

echo "▶ starting"
ssh "$HOST" "cd $DIR && docker tag $IMAGE:$TAG $IMAGE:latest && docker compose up -d --wait --wait-timeout 180 --remove-orphans && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile && docker image prune -f >/dev/null && docker compose ps"
