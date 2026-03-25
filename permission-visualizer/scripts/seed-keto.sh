#!/usr/bin/env bash
# Applies OPL and creates relation tuples for a given Keto permission example.
# Usage: bash scripts/seed-keto.sh <example-name>
# Example: bash scripts/seed-keto.sh content-publishing-workflow

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source environment variables (supports both plain KEY=VALUE and export KEY=VALUE)
set -a
source "$PROJECT_ROOT/.env"
set +a

EXAMPLE="${1:-}"

if [ -z "$EXAMPLE" ]; then
  echo "Usage: $0 <example-name>"
  echo ""
  echo "Available examples:"
  for d in "$PROJECT_ROOT/examples/"/*/; do
    basename "$d"
  done
  exit 1
fi

EXAMPLE_DIR="$PROJECT_ROOT/examples/$EXAMPLE"
OPL_FILE="$EXAMPLE_DIR/namespace.ts"
REL_FILE="$EXAMPLE_DIR/relationships.json"

if [ ! -f "$OPL_FILE" ]; then
  echo "Error: OPL file not found: $OPL_FILE"
  exit 1
fi

if [ ! -f "$REL_FILE" ]; then
  echo "Error: Relationships file not found: $REL_FILE"
  exit 1
fi

# Step 1: Apply OPL
echo "=== Applying OPL for $EXAMPLE ==="
ory update opl --file "$OPL_FILE" \
  --project "$ORY_PROJECT" \
  --workspace "$ORY_WORKSPACE"

# Step 2: Wait for propagation
echo ""
echo "Waiting 3 seconds for OPL propagation..."
sleep 3

# Step 3: Create relation tuples
echo ""
echo "=== Creating relation tuples for $EXAMPLE ==="

TOTAL=0
SUCCESS=0
FAIL=0

while IFS= read -r line; do
  # Skip empty lines
  [ -z "$line" ] && continue

  TOTAL=$((TOTAL + 1))
  if echo "$line" | ory create relationship \
    --project "$ORY_PROJECT" \
    --workspace "$ORY_WORKSPACE" -; then
    SUCCESS=$((SUCCESS + 1))
  else
    echo "FAILED to create tuple: $line"
    FAIL=$((FAIL + 1))
  fi
done < "$REL_FILE"

echo ""
echo "=== Done seeding Keto for $EXAMPLE ==="
echo "Total: $TOTAL | Success: $SUCCESS | Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
