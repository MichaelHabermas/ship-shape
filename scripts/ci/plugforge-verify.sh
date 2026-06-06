#!/usr/bin/env bash
# PlugForge contract proof pack: lint, types, OpenAPI parity, API proofs, SDK/CLI, integration boundary.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

pnpm lint
pnpm type-check
pnpm plugforge:ledger
pnpm plugforge:render-reviewer:check
pnpm openapi:check:strict
bash ./scripts/ci/check-public-openapi-drift.sh
pnpm plugforge:integrations:check
pnpm plugforge:llm-boundary
node --test ./scripts/ci/check-plugforge-proof-ledger.test.mjs
node --test ./scripts/ci/check-integration-boundary.test.mjs

node ./scripts/ci/run-plugforge-api-tests.mjs

pnpm --filter @ship/sdk test
pnpm --filter @ship/cli check
pnpm --filter @ship/cli test
