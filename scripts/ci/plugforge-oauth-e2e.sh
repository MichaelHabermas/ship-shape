#!/usr/bin/env bash
# OAuth Authorization Code + PKCE Playwright proof (part of plugforge:submission).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

export CI=true
export PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-1}"

pnpm exec playwright install chromium --with-deps
pnpm test:e2e:raw e2e/oauth-auth-code.spec.ts
