#!/usr/bin/env bash
# Delegates to @ship/shipshape-security CI script.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "${ROOT_DIR}/packages/shipshape-security/scripts/run-ci.sh"
