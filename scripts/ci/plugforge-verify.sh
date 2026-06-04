#!/usr/bin/env bash
# Plugforge MVP gate: lint, types, OpenAPI parity, API proofs, SDK/CLI, and integration boundary checks.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

pnpm lint
pnpm type-check
pnpm plugforge:ledger
pnpm openapi:check:strict
bash ./scripts/ci/check-public-openapi-drift.sh
pnpm plugforge:integrations:check
pnpm plugforge:llm-boundary
node --test ./scripts/ci/check-integration-boundary.test.mjs

./scripts/run-api-tests.sh -- \
  src/platform/oauth/provider.test.ts \
  src/platform/oauth/tokens.test.ts \
  src/platform/oauth/refresh-theft-drill.test.ts \
  src/platform/api/v1/route-metadata.test.ts \
  src/platform/api/v1/public-api-fitness.test.ts \
  src/platform/api/v1/middleware.test.ts \
  src/platform/api/v1/me.test.ts \
  src/platform/api/v1/documents.test.ts \
  src/platform/api/v1/issues.test.ts \
  src/platform/api/v1/sprints.test.ts \
  src/platform/api/v1/fleetgraph.test.ts \
  src/fleetgraph/public-api-client.audit.test.ts \
  src/platform/api/v1/webhooks.test.ts \
  src/platform/webhooks/deliverer.test.ts \
  src/platform/webhooks/worker.test.ts \
  src/platform/webhooks/bootstrap.test.ts \
  src/platform/webhooks/event-bus.test.ts \
  src/platform/webhooks/service.test.ts \
  src/services/issue-mutations/webhook-events.test.ts \
  src/services/document-mutations/webhook-events.test.ts \
  src/platform/apps/routes.test.ts \
  src/platform/oauth/agent-token-broker.test.ts \
  src/platform/plugforge-acceptance.todo.test.ts

pnpm --filter @ship/sdk test
pnpm --filter @ship/cli check
pnpm --filter @ship/cli test
