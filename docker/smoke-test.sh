#!/usr/bin/env bash
# Smoke test for a running CPN IDE backend.
# Usage: docker/smoke-test.sh <base-url> [model.cpn]   (e.g. http://localhost:8080)
set -euo pipefail

BASE="${1:?usage: $0 <base-url> [model.cpn]}"
BASE="${BASE%/}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="${2:-$ROOT/test/fixtures/fuelstation-no-mon.cpn}"
SID="smoke-$$"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Wait for the backend to come up (Spring Boot start-up takes a few seconds).
for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 3 "$BASE/"; then break; fi
  sleep 2
done

node -e '
const fs = require("fs");
process.stdout.write(JSON.stringify({xml: fs.readFileSync(process.argv[1], "utf8"), complex_verify: true, need_sim_restart: true}));
' "$MODEL" > "$TMP/init.json"

echo "smoke: POST /api/v2/cpn/init"
curl -sf --max-time 120 -H "X-SessionId: $SID" -H 'Content-Type: application/json' \
  --data-binary @"$TMP/init.json" "$BASE/api/v2/cpn/init" > "$TMP/init.out"
cat "$TMP/init.out"; echo
grep -q '"success":true' "$TMP/init.out" || { echo "smoke: FAIL init" >&2; exit 1; }

echo "smoke: POST /api/v2/cpn/sim/init"
curl -sf --max-time 120 -H "X-SessionId: $SID" -H 'Content-Type: application/json' \
  -d '{}' "$BASE/api/v2/cpn/sim/init" > "$TMP/sim.out"
head -c 400 "$TMP/sim.out"; echo
grep -q 'enableTrans' "$TMP/sim.out" || { echo "smoke: FAIL sim/init (no enableTrans)" >&2; exit 1; }

echo "smoke: OK"
