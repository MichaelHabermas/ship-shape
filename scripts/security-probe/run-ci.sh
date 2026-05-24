#!/usr/bin/env bash
# CI/local gate: migrate + seed, start API, run probe unit tests + full probe with --fail-on=new.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

export CI="${CI:-true}"
API_PORT="${SECURITY_PROBE_API_PORT:-3099}"
WEB_PORT="${SECURITY_PROBE_WEB_PORT:-5199}"
RUN_ID="${SECURITY_PROBE_RUN_ID:-security-probe-ci-$(date +%Y%m%d-%H%M%S)}"
DATABASE_URL="${DATABASE_URL:-postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit}"
export DATABASE_URL
export PORT="${API_PORT}"
export CORS_ORIGIN="http://localhost:${WEB_PORT}"
export SESSION_SECRET="${SESSION_SECRET:-security-probe-ci-secret}"

LOG_DIR="${ROOT_DIR}/test-results/security-probe-ci"
mkdir -p "${LOG_DIR}"
API_LOG="${LOG_DIR}/api.log"

echo "Security probe CI: DATABASE_URL=${DATABASE_URL}"
echo "API http://localhost:${API_PORT}  run-id=${RUN_ID}"

pnpm build:shared
pnpm --filter @ship/api db:migrate
pnpm --filter @ship/api db:seed

pnpm --filter @ship/api exec tsx src/index.ts >"${API_LOG}" 2>&1 &
API_PID=$!

cleanup() {
  if kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Waiting for API /health..."
for _ in $(seq 1 90); do
  if curl -sf "http://localhost:${API_PORT}/health" >/dev/null; then
    echo "API ready."
    break
  fi
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    echo "API process exited early. Log:"
    cat "${API_LOG}"
    exit 1
  fi
  sleep 1
done

if ! curl -sf "http://localhost:${API_PORT}/health" >/dev/null; then
  echo "API did not become healthy in time. Log:"
  cat "${API_LOG}"
  exit 1
fi

pnpm security:probe:test

node ./scripts/security-probe/run.mjs \
  --run-id "${RUN_ID}" \
  --api-url "http://localhost:${API_PORT}" \
  --web-url "http://localhost:${WEB_PORT}" \
  --fail-on=new \
  --record-verifications

pnpm security:findings:check

echo "Security probe CI passed (fail-on=new). Report: my-docs/evidence/security-audit/runs/${RUN_ID}/"
