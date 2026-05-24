#!/usr/bin/env bash
# Safe security probe against the public Render deployment (remote/safe mode).
# Full local gate: pnpm security:probe:ci
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

API_URL="${SECURITY_PROBE_DEPLOYED_API_URL:-${SECURITY_PROBE_API_URL:-https://ship-shape-api.onrender.com}}"
WEB_URL="${SECURITY_PROBE_DEPLOYED_WEB_URL:-${SECURITY_PROBE_WEB_URL:-https://ship-shape-web.onrender.com}}"
RUN_ID="${SECURITY_PROBE_RUN_ID:-deployed-probe-$(date +%Y%m%d-%H%M%S)}"

usage() {
  cat <<EOF
Usage: pnpm security:probe:deployed [-- extra shipshape-security run args]

Run the Category 8 probe against the deployed Render site (safe/remote mode).
Write and stress probes are skipped unless you pass --allow-write / --allow-stress.

Defaults:
  API  ${API_URL}
  Web  ${WEB_URL}

Override targets:
  SECURITY_PROBE_DEPLOYED_API_URL   (or SECURITY_PROBE_API_URL)
  SECURITY_PROBE_DEPLOYED_WEB_URL   (or SECURITY_PROBE_WEB_URL)

Override credentials (same seeded accounts as local dev by default):
  SECURITY_PROBE_ADMIN_EMAIL / SECURITY_PROBE_ADMIN_PASSWORD
  SECURITY_PROBE_MEMBER_EMAIL / SECURITY_PROBE_MEMBER_PASSWORD

Examples:
  pnpm security:probe:deployed
  pnpm security:probe:deployed -- --probe auth-session-unauthenticated-api
  pnpm security:probe:deployed -- --allow-write --fail-on=high

Local full gate (not deployed): pnpm security:probe:ci
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "Security probe — deployed (safe mode)"
echo "  API:  ${API_URL}"
echo "  Web:  ${WEB_URL}"
echo "  Tip:  pass --run-id, --allow-write, or --allow-stress via extra args as needed"
echo ""

exec pnpm exec shipshape-security run \
  --run-id "${RUN_ID}" \
  --api-url "${API_URL}" \
  --web-url "${WEB_URL}" \
  --fail-on none \
  "$@"
