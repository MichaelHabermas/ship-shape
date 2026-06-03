#!/usr/bin/env bash
# Plugforge MVP gate 9: lint, types, OpenAPI parity, platform API tests, SDK/CLI, optional TTFE.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

pnpm lint
pnpm type-check
pnpm openapi:check:strict
node ./scripts/ci/validate-public-openapi.mjs

./scripts/run-api-tests.sh -- \
  src/platform/oauth/provider.test.ts \
  src/platform/oauth/tokens.test.ts \
  src/platform/api/v1/route-metadata.test.ts \
  src/platform/api/v1/middleware.test.ts \
  src/platform/api/v1/me.test.ts \
  src/platform/api/v1/documents.test.ts \
  src/platform/api/v1/issues.test.ts \
  src/platform/api/v1/sprints.test.ts \
  src/platform/api/v1/fleetgraph.test.ts \
  src/platform/api/v1/webhooks.test.ts \
  src/platform/webhooks/deliverer.test.ts \
  src/platform/webhooks/worker.test.ts \
  src/platform/webhooks/event-bus.test.ts \
  src/platform/webhooks/service.test.ts \
  src/services/issue-mutations/webhook-events.test.ts \
  src/platform/apps/routes.test.ts \
  src/platform/oauth/agent-token-broker.test.ts

pnpm --filter @ship/sdk test
pnpm --filter @ship/cli check
