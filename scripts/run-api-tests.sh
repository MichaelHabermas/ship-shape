#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SHIP_ROOT_DIR="$ROOT_DIR"
# shellcheck source=lib/database-url.sh
source "$ROOT_DIR/scripts/lib/database-url.sh"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to preflight API tests." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="$(database_url_resolve ship_test_audit)"
else
  if ! database_url_is_ready "$DATABASE_URL"; then
    echo "DATABASE_URL is set but not reachable:" >&2
    echo "  ${DATABASE_URL}" >&2
    echo "Unset it or fix the URL; ./scripts/resolve-database-url.sh ship_test_audit prints a working one." >&2
    exit 1
  fi
fi

cd "${ROOT_DIR}"
if [ "${1:-}" = "--" ]; then
  shift
fi
pnpm --filter @ship/api test "$@"
