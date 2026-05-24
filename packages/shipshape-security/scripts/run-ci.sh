#!/usr/bin/env bash
# CI/local gate: migrate + seed, start API, run probe unit tests + full probe with --fail-on=new.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
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
PID_FILE="${LOG_DIR}/api.pid"

port_pids() {
  lsof -ti "tcp:${API_PORT}" -sTCP:LISTEN 2>/dev/null || true
}

free_probe_port() {
  local pids
  pids="$(port_pids)"
  if [ -z "${pids}" ]; then
    return 0
  fi
  echo "Port ${API_PORT} is in use (PID(s): ${pids}). Stopping stale listeners before security probe CI…"
  # shellcheck disable=SC2086
  kill ${pids} 2>/dev/null || true
  sleep 1
  pids="$(port_pids)"
  if [ -n "${pids}" ]; then
    echo "ERROR: Port ${API_PORT} is still in use. Stop the process manually or set SECURITY_PROBE_API_PORT."
    exit 1
  fi
}

verify_admin_login() {
  local jar status body
  jar="$(mktemp)"
  body="$(mktemp)"
  if ! curl -sf -c "${jar}" "http://127.0.0.1:${API_PORT}/api/csrf-token" -o "${body}"; then
    echo "ERROR: Could not fetch CSRF token from API on port ${API_PORT}."
    rm -f "${jar}" "${body}"
    return 1
  fi
  local token
  token="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.token||'');" "${body}")"
  if [ -z "${token}" ]; then
    echo "ERROR: CSRF token missing from API response."
    rm -f "${jar}" "${body}"
    return 1
  fi
  status="$(curl -s -o "${body}" -w "%{http_code}" -b "${jar}" -c "${jar}" \
    -X POST "http://127.0.0.1:${API_PORT}/api/auth/login" \
    -H "Content-Type: application/json" \
    -H "x-csrf-token: ${token}" \
    -d '{"email":"dev@ship.local","password":"admin123"}')"
  rm -f "${jar}"
  if [ "${status}" != "200" ]; then
    echo "ERROR: Preflight admin login failed (HTTP ${status}). Response:"
    cat "${body}"
    echo ""
    echo "API log (tail):"
    tail -n 40 "${API_LOG}" || true
    rm -f "${body}"
    return 1
  fi
  rm -f "${body}"
  return 0
}

echo "Security probe CI: DATABASE_URL=${DATABASE_URL}"
echo "API http://127.0.0.1:${API_PORT}  run-id=${RUN_ID}"

free_probe_port

pnpm build:shared
DATABASE_URL="${DATABASE_URL}" pnpm --filter @ship/api db:migrate
DATABASE_URL="${DATABASE_URL}" pnpm --filter @ship/api db:seed

: >"${API_LOG}"
env DATABASE_URL="${DATABASE_URL}" PORT="${API_PORT}" CORS_ORIGIN="${CORS_ORIGIN}" SESSION_SECRET="${SESSION_SECRET}" \
  pnpm --filter @ship/api exec tsx src/index.ts >>"${API_LOG}" 2>&1 &
API_PID=$!
echo "${API_PID}" >"${PID_FILE}"

cleanup() {
  if [ -f "${PID_FILE}" ]; then
    rm -f "${PID_FILE}"
  fi
  if kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
    wait "${API_PID}" 2>/dev/null || true
  fi
  # If our child died but something else grabbed the port, leave it alone.
}
trap cleanup EXIT INT TERM

echo "Waiting for API /health (pid ${API_PID})..."
ready=0
for _ in $(seq 1 90); do
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    echo "API process exited early. Log:"
    cat "${API_LOG}"
    exit 1
  fi
  if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [ "${ready}" -ne 1 ]; then
  echo "API did not become healthy in time. Log:"
  cat "${API_LOG}"
  exit 1
fi

if ! verify_admin_login; then
  exit 1
fi
echo "API ready (health + admin login verified)."

pnpm --filter @ship/shipshape-security test

pnpm exec shipshape-security run \
  --run-id "${RUN_ID}" \
  --api-url "http://127.0.0.1:${API_PORT}" \
  --web-url "http://localhost:${WEB_PORT}" \
  --fail-on=new \
  --record-verifications

# --record-verifications updates security-findings.json; sync generated ledger before check.
pnpm exec shipshape-security findings render

pnpm exec shipshape-security findings check

echo "Security probe CI passed (fail-on=new). Report: my-docs/evidence/security-audit/runs/${RUN_ID}/"
