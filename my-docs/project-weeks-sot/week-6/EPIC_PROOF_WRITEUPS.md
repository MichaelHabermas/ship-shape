# Week 6 Per-Epic Proof Writeups

Each writeup uses the submission-required shape: before -> fix -> after -> proof. The strongest executable gates are listed first; reviewer-facing docs point back here rather than restating proof claims in multiple places.

## Epic 1 - OAuth Apps And Token Front Door

**Before:** `/api/v1/me` could validate seeded OAuth access tokens, but seeded tokens proved token lookup rather than a real user/client entrance.

**Fix:** Ship added first-party OAuth app records, shown-once hashed secrets, Authorization Code + PKCE, Device Authorization Grant, refresh-token rotation, refresh-token theft invalidation, and browser/device consent surfaces.

**After:** Browser, CLI, and test clients start at OAuth protocol endpoints, receive real grants/tokens, and call `/api/v1` with app/user/workspace/scopes attached.

**Proof:** `./scripts/run-api-tests.sh -- src/platform/oauth/provider.test.ts src/platform/oauth/tokens.test.ts src/platform/oauth/refresh-theft-drill.test.ts`, `pnpm plugforge:oauth-e2e`, and `e2e/oauth-auth-code.spec.ts`.

## Epic 2 - Public API And Generated OpenAPI

**Before:** Internal `/api/*` routes and internal DTOs were useful for the app but were not a stable external contract.

**Fix:** Ship added `/api/v1` route metadata, shared Zod contract maps, public errors, cursor envelopes, public audit rows, route metadata parity tests, and generated OpenAPI at both the live route and `docs/openapi.json`.

**After:** External clients use `/api/v1` with OAuth scopes and rate-limit headers; the static OpenAPI artifact is generated from the same route registry used by runtime handlers.

**Proof:** `pnpm openapi:check:strict`, `bash scripts/ci/check-public-openapi-drift.sh`, and `./scripts/run-api-tests.sh -- src/platform/api/v1/route-metadata.test.ts src/platform/api/v1/public-api-fitness.test.ts src/platform/api/v1/documents.test.ts src/platform/api/v1/issues.test.ts src/platform/api/v1/sprints.test.ts`.

## Epic 3 - Webhook Delivery, Retry, Idempotency, And DLQ

**Before:** Domain mutations had no public developer delivery contract, replay path, or deterministic retry proof.

**Fix:** Ship added event registry schemas, transactional event publication, subscription matching, HMAC signatures, idempotency keys, retry/DLQ state, replay, in-process due-delivery worker wiring, and deterministic fake-time tests.

**After:** Document/issue/sprint events persist before dispatch, retries preserve delivery identity, replay preserves `Idempotency-Key`, and developer portal/API views expose delivery status.

**Proof:** `./scripts/run-api-tests.sh -- src/platform/webhooks/service.test.ts src/platform/webhooks/worker.test.ts src/platform/webhooks/bootstrap.test.ts src/platform/webhooks/event-bus.test.ts src/services/document-mutations/webhook-events.test.ts src/services/issue-mutations/webhook-events.test.ts`, plus `my-docs/evidence/plugforge-integrations/matrix.json`.

## Epic 4 - TypeScript SDK And CLI TTFE

**Before:** Workspace-linked package imports could pass locally while missing the release artifact shape a reviewer installs.

**Fix:** `@ship/sdk` gained hand-authored resource clients, auth helpers, token stores, error union, webhook verifier, and OpenAPI parity checks. The CLI uses Device Grant, packed SDK/CLI artifacts, document create, and webhook tail signature verification.

**After:** `pnpm drill ttfe` installs packed packages into a fresh temp project, logs in, creates a document, tails a real signed webhook, and emits stage timing.

**Proof:** `pnpm --filter @ship/sdk test`, `pnpm --filter @ship/cli check`, `pnpm --filter @ship/cli test`, `pnpm drill ttfe`, and `my-docs/evidence/plugforge-metrics/ttfe-timing.json`.

## Epic 5 - Reference Integrations

**Before:** Integrations could have cheated by importing internal app modules or touching internal data shapes.

**Fix:** Slack and GitLab reference integrations live under `integrations/`, depend on `@ship/sdk`, and are checked by a boundary scanner with negative fixtures. The browser SDK demo runs through a real page, redirect, callback, token exchange, and authenticated SDK calls.

**After:** Slack proves OAuth install plus signed Ship webhook receipt/posting; GitLab proves public issue link upsert/readback; browser proves PKCE in a real runtime; boundary checks block internal imports.

**Proof:** `pnpm plugforge:integrations`, `node --test ./scripts/ci/check-integration-boundary.test.mjs`, and evidence JSON under `my-docs/evidence/plugforge-integrations/`.

## Epic 6 - CLI Time To First Event

**Before:** The submission story could have degraded into a transcript or a seeded-token shortcut.

**Fix:** The TTFE drill became executable: packed install, Device Grant login, SDK document create, `ship webhooks tail`, HMAC verification, and stage-level timing.

**After:** The proof is a repeatable command with measured install/login/subscription/create/receipt/verification/total stages and a 60 second runtime gate.

**Proof:** `pnpm drill ttfe`, `pnpm plugforge:metrics:ttfe -- --no-write`, and `my-docs/evidence/plugforge-metrics/ttfe-timing.json` showing total runtime 11,226 ms with all required stages present.

## Epic 7 - Developer Portal And Agent-As-Citizen

**Before:** FleetGraph could read Ship state as an internal/system path, which did not prove the agent was subject to the same OAuth app, scopes, rate limits, SDK, public API, and audit trail as external clients.

**Fix:** Ship added a first-party `ship-agent` OAuth app, delegated user-bound agent token broker, public FleetGraph attention-context read route, SDK client path, and public audit assertions. Portal routes expose OAuth apps, secrets, webhooks, delivery logs, replay, and audit rows for reviewer inspection.

**After:** With `FLEETGRAPH_USE_PUBLIC_API=true`, user-initiated FleetGraph source reads go through `@ship/sdk` and `/api/v1`; audit rows record `client_id`, user, route, scopes, status, request id, and latency. Scheduled no-user workers remain internal until they have a separate user/audit model.

**Proof:** `./scripts/run-api-tests.sh -- src/fleetgraph/public-api-client.audit.test.ts src/platform/oauth/agent-token-broker.test.ts src/platform/apps/routes.test.ts`, `docs/architecture.md` Agent-as-Citizen section, and `my-docs/AI_COST_ANALYSIS.md` Week 6 addendum.
