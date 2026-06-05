#!/usr/bin/env bash
# PlugForge final proof pack proves external clients can live on Ship's public platform boundary.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

METRICS_OUTPUT_DIR="${PLUGFORGE_METRICS_OUTPUT_DIR:-my-docs/evidence/plugforge-metrics-ci}"

pnpm plugforge:verify
rm -rf "${METRICS_OUTPUT_DIR}"
pnpm plugforge:metrics -- --output-dir "${METRICS_OUTPUT_DIR}"

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
