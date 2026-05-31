#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SHIP_ROOT_DIR="$ROOT_DIR"
# shellcheck source=lib/database-url.sh
source "$ROOT_DIR/scripts/lib/database-url.sh"

DATABASE_NAME="${1:-ship_dev}"
database_url_resolve "$DATABASE_NAME"
