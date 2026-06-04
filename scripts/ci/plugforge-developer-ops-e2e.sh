#!/usr/bin/env bash
# PlugForge developer-ops E2E proof runs the portal DLQ and replay drill as a named final-gate target.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

export CI=true
export PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-1}"

pnpm exec playwright install chromium --with-deps
pnpm test:e2e:run e2e/developer-ops.spec.ts
