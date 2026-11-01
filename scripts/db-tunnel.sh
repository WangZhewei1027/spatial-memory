#!/usr/bin/env bash
# Open an SSH tunnel to the production database (bound to 127.0.0.1 on the
# server) on local port 15432, then e.g.:
#   DATABASE_URL=postgres://spatial_memory:<pw>@127.0.0.1:15432/spatial_memory npx tsx scripts/db/migrate.ts
set -euo pipefail
HOST=${DEPLOY_HOST:-root@139.196.189.102}
PORT=${1:-15432}
echo "tunnel: 127.0.0.1:$PORT → $HOST:5432 (Ctrl-C to close)"
exec ssh -N -L "$PORT:127.0.0.1:5432" "$HOST"
