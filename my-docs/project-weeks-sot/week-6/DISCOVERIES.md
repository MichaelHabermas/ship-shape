# Week 6 Discoveries

These are the submission discoveries worth carrying forward. They focus on gaps, tradeoffs, and decisions found while building PlugForge rather than restating the final feature list.

## 1. Seeded Tokens Can Hide A Missing OAuth Front Door

The first `/api/v1/me` slice accepted OAuth access tokens, but early tests inserted tokens directly. That proved bearer-token validation, not Authorization Code + PKCE, Device Grant, consent, one-time code exchange, refresh rotation, or a real protected call from a client.

**Decision:** Keep seeded-token tests only as low-level token validation. Final acceptance must start where users and clients start: authorize/device request, consent or device approval, token exchange, then a public API call.

**Proof path:** `api/src/platform/oauth/provider.test.ts`, `api/src/platform/oauth/refresh-theft-drill.test.ts`, and `e2e/oauth-auth-code.spec.ts`.

## 2. Generated OpenAPI Needs Registry Parity, Not A Static File Ritual

The spec requires `docs/openapi.json`, but a committed JSON file alone can drift from route metadata, shared Zod schemas, SDK methods, and frontend DTO assumptions. The useful discovery was that every tier needs the same operation-id set.

**Decision:** Public OpenAPI is generated from route metadata and contract maps; CI regenerates and diffs `docs/openapi.json`. Frontend/web references should use generated OpenAPI aliases when they cross the wire.

**Proof path:** `api/src/platform/api/v1/route-metadata.test.ts`, `scripts/ci/check-public-openapi-drift.sh`, `scripts/check-openapi-routes.mjs`, and `docs/openapi.json`.

## 3. Retry Logic Needs Injectable Time And Transport

Webhook reliability cannot be proven with `setTimeout` polling. It must prove the state machine: success, retryable status, retryable transport error, terminal DLQ, max-attempt DLQ, replay, and idempotency-key preservation.

**Decision:** Webhook delivery accepts injected clock, deliverer, timeout, URL validation, and database runner dependencies. Production uses fetch and an in-process due-delivery worker; tests advance fake time and assert persisted state transitions.

**Proof path:** `api/src/platform/webhooks/service.test.ts`, `api/src/platform/webhooks/worker.test.ts`, `api/src/platform/webhooks/bootstrap.test.ts`, and `my-docs/evidence/plugforge-integrations/matrix.json`.

## 4. Reference Integrations Need A Mechanical Boundary

An integration that imports `api/src`, `web/src`, `shared`, or `@ship/shared` is not an external integration. It is a colocated feature bypassing the platform contract.

**Decision:** Slack and GitLab integrations depend on `@ship/sdk`; the boundary checker blocks package-manifest leaks, static imports, `require()`, dynamic imports, app aliases, and shared/internal package imports. A negative fixture verifies the checker fails for bad imports.

**Proof path:** `scripts/ci/check-integration-boundary.mjs`, `scripts/ci/check-integration-boundary.test.mjs`, `integrations/slack`, `integrations/gitlab`, and `pnpm plugforge:integrations`.

## 5. Agent-As-Citizen Should Be Delegated, Not Client-Credentials By Default

The first-party agent needs auditability tied to the initiating user. Client Credentials would be simpler, but it would lose the user-bound read context and make public audit rows less useful.

**Decision:** The `ship-agent` app is first-party and read-only. The broker mints delegated user-bound OAuth access tokens for user-initiated FleetGraph source reads; scheduled no-user worker paths stay internal until a separate identity/audit model is designed.

**Proof path:** `api/src/platform/oauth/agent-token-broker.test.ts`, `api/src/fleetgraph/public-api-client.audit.test.ts`, `api/src/platform/oauth/ship-agent-scopes.ts`, and `docs/architecture.md`.

## 6. Submission Ledgers Must Stay Honest About Manual Evidence

Global enforcement can be green while manual submission artifacts are still outside the repository. That is useful only if the ledger distinguishes executable proof, documentation proof, external attachments, open decisions, and the final global gate.

**Decision:** Close documentation and decision atoms with durable evidence files. `W6-GLOBAL-001` is proven only after `pnpm plugforge:submission` passes without `--allow-manual-pending`; demo video, presearch upload, and social screenshot are intentionally `non_scope` and never block the gate.

**Proof path:** `my-docs/project-weeks-sot/week-6/proof-ledger.yaml`, `scripts/ci/check-plugforge-proof-ledger.mjs`, and `scripts/ci/plugforge-submission.mjs`.
