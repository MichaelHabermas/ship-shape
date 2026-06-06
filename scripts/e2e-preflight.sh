#!/usr/bin/env bash
# Preflight checks before Playwright E2E. Source from run-e2e.sh or run directly.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

e2e_require_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is required for Playwright E2E tests because Testcontainers starts PostgreSQL per worker."
    echo "Start Docker, then run this again."
    return 1
  fi
}

e2e_require_browsers() {
  if ! (
    cd "${ROOT_DIR}"
    node ./scripts/lib/e2e-preflight.mjs >/dev/null 2>&1
  ); then
    echo "Playwright could not launch Chromium (browser binaries missing or sandbox blocked)."
    echo "Run: pnpm test:e2e:setup"
    echo "Then re-run E2E with full permissions if you are in an agent sandbox."
    return 1
  fi
}

e2e_preflight() {
  e2e_require_docker
  e2e_require_browsers
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  e2e_preflight
  echo "E2E preflight OK"
fi
