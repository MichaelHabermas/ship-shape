#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to preflight API tests." >&2
  exit 1
fi

if ! psql "${DATABASE_URL}" -c "select 1" >/dev/null 2>&1; then
  echo "Cannot connect to API test database:" >&2
  echo "  ${DATABASE_URL}" >&2
  echo "Start local PostgreSQL and create/seed ship_test_audit, then rerun." >&2
  exit 1
fi

cd "${ROOT_DIR}"
if [ "${1:-}" = "--" ]; then
  shift
fi
pnpm --filter @ship/api test "$@"
