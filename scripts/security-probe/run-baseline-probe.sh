#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLONE="${BASELINE_CLONE:-$(dirname "$ROOT")/ship-shape-baseline-measurement}"
OUT="$ROOT/my-docs/evidence/security-audit/runs/baseline-before-probe"
PARTIAL="$OUT/partials"
RUN_ID="baseline-before-probe"
export PATH="/opt/homebrew/Cellar/libpq/18.4/bin:${PATH:-}"
export PGPASSWORD="${PGPASSWORD:-ship_dev_password}"

DEV_PID=""

stop_dev() {
  if [ -n "$DEV_PID" ]; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
    DEV_PID=""
  fi
  pkill -f "$CLONE/scripts/dev.sh" 2>/dev/null || true
  pkill -f "$CLONE/api" 2>/dev/null || true
  sleep 2
}

cleanup() {
  stop_dev
  if [ -d "$CLONE" ]; then
    git -C "$ROOT" worktree remove --force "$CLONE" 2>/dev/null || rm -rf "$CLONE"
  fi
}
trap cleanup EXIT INT TERM

rm -rf "$OUT"
mkdir -p "$OUT" "$PARTIAL"

if [ -d "$CLONE" ]; then
  git -C "$ROOT" worktree remove --force "$CLONE" 2>/dev/null || rm -rf "$CLONE"
fi

git -C "$ROOT" worktree add "$CLONE" BASELINE
rm -rf "$CLONE/scripts/security-probe"
cp -R "$ROOT/scripts/security-probe" "$CLONE/scripts/"
mkdir -p "$CLONE/my-docs/evidence/security-audit/runs"

cd "$CLONE"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build:shared

DB_NAME="ship_baseline_probe"
dropdb -h localhost -U ship --if-exists "$DB_NAME" 2>/dev/null || dropdb -h localhost --if-exists "$DB_NAME" 2>/dev/null || true
createdb -h localhost -U ship "$DB_NAME" 2>/dev/null || createdb -h localhost "$DB_NAME"

cat > api/.env.local <<EOF
NODE_ENV=development
DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/$DB_NAME
LOG_LEVEL=debug
SESSION_SECRET=dev-secret-change-in-production
EOF

pnpm db:migrate
pnpm db:seed

start_dev() {
  stop_dev
  pnpm dev > "$OUT/dev.log" 2>&1 &
  DEV_PID=$!

  API_PORT=""
  WEB_PORT=""
  for _ in $(seq 1 120); do
    if [ -f "$CLONE/.ports" ]; then
      API_PORT=$(grep '^API=' "$CLONE/.ports" | cut -d= -f2)
      WEB_PORT=$(grep '^WEB=' "$CLONE/.ports" | cut -d= -f2)
      break
    fi
    sleep 1
  done

  if [ -z "$API_PORT" ] || [ -z "$WEB_PORT" ]; then
    echo "ERROR: dev server did not write .ports" >&2
    tail -40 "$OUT/dev.log" >&2 || true
    exit 1
  fi

  API_URL="http://localhost:$API_PORT"
  WEB_URL="http://localhost:$WEB_PORT"

  for _ in $(seq 1 60); do
    curl -sf "$API_URL/health" >/dev/null 2>&1 && break
    sleep 2
  done
  curl -sf "$API_URL/health" >/dev/null
}

run_phase() {
  local phase_id="$1"
  shift
  local out_subdir="$PARTIAL/$phase_id"
  mkdir -p "$out_subdir"
  node ./scripts/security-probe/run.mjs \
    --run-id "$phase_id" \
    --out-dir "$out_subdir" \
    --api-url "$API_URL" \
    --web-url "$WEB_URL" \
    --fail-on none \
    "$@" || true
  echo "$out_subdir/runs/$phase_id/report.json"
}

start_dev

PARTIAL_REPORTS=()
PARTIAL_REPORTS+=("$(run_phase baseline-auth --probe auth-session)")
PARTIAL_REPORTS+=("$(run_phase baseline-input --probe input)")
PARTIAL_REPORTS+=("$(run_phase baseline-dependency --probe dependency)")
PARTIAL_REPORTS+=("$(run_phase baseline-manual --probe manual)")
PARTIAL_REPORTS+=("$(run_phase baseline-ws-safe --probe websocket-no-cookie-denied)")
PARTIAL_REPORTS+=("$(run_phase baseline-ws-safe2 --probe websocket-nonexistent-doc-denied)")
PARTIAL_REPORTS+=("$(run_phase baseline-ws-events --probe websocket-events-malformed-message)")
PARTIAL_REPORTS+=("$(run_phase baseline-ws-events2 --probe websocket-events-unknown-message-type)")

# Destructive WS probes can crash BASELINE API — restart between each.
start_dev
PARTIAL_REPORTS+=("$(run_phase baseline-ws-malformed --probe websocket-malformed-frame)")
start_dev
PARTIAL_REPORTS+=("$(run_phase baseline-ws-unknown --probe websocket-unknown-message-type)")
start_dev
PARTIAL_REPORTS+=("$(run_phase baseline-ws-oversized --probe websocket-oversized-frame)")

node "$ROOT/scripts/security-probe/merge-reports.mjs" "$RUN_ID" "${PARTIAL_REPORTS[@]}"
cp -f "$ROOT/my-docs/evidence/security-audit/runs/$RUN_ID/report.json" "$OUT/report.json"
cp -f "$ROOT/my-docs/evidence/security-audit/runs/$RUN_ID/report.md" "$OUT/report.md" 2>/dev/null || true

echo "Baseline probe saved to $OUT/report.json"
