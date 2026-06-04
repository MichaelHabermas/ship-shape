#!/usr/bin/env bash
# PlugForge final proof pack proves external clients can live on Ship's public platform boundary.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

pnpm plugforge:verify
pnpm plugforge:metrics:ttfe
pnpm plugforge:metrics:oauth-p95
pnpm plugforge:metrics:webhook-p95
pnpm plugforge:metrics:sdk-size

pnpm --filter @ship/shared build
pnpm --filter @ship/sdk build
pnpm --filter @ship/slack-integration check
pnpm --filter @ship/gitlab-integration check
pnpm plugforge:integrations:check
node --test ./scripts/ci/check-integration-boundary.test.mjs

./scripts/run-api-tests.sh -- \
  src/platform/api/v1/issues.test.ts \
  src/platform/oauth/refresh-theft-drill.test.ts \
  src/platform/webhooks/service.test.ts \
  src/fleetgraph/public-api-client.audit.test.ts

pnpm --filter @ship/sdk test
pnpm plugforge:developer-ops-e2e
bash ./scripts/ci/check-public-openapi-drift.sh
pnpm docs:check:strict
