#!/usr/bin/env bash
# Plugforge MVP gates 2 and 8: Authorization Code + PKCE Playwright proof.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

export CI=true
export PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-1}"

pnpm exec playwright install chromium --with-deps
pnpm test:e2e:raw e2e/oauth-auth-code.spec.ts
