#!/usr/bin/env bash
# Start the local Keto + router, wait for it, and seed the generated graph.
# Then run the app against it (Live mode -> "Local deep graph (local-keto)" or "Explore Live Data"):
#   ORY_SDK_URL=http://localhost:4455 ORY_ACCESS_TOKEN=local ALLOW_TUPLE_DELETE=1 make dev
set -euo pipefail
cd "$(dirname "$0")"
# Start from an empty database, then load the generated graph.
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
docker compose up -d --quiet-pull
for i in $(seq 1 60); do
  if curl -fsS http://localhost:4455/health/ready >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 60 ]; then docker compose logs --tail=40 keto; echo "Keto did not become ready" >&2; exit 1; fi
  sleep 1
done
node seed.mjs
