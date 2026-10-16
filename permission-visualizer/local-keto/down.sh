#!/usr/bin/env bash
# Stop the local Keto stack.
set -euo pipefail
cd "$(dirname "$0")"
docker compose down -v
