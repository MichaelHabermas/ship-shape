# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work. Prune ruthlessly.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat.

## Week 5 Demarcation

As of 2026-06-02, active memory should bias toward durable invariants, current rails, and traps likely to affect new work.

## Plugforge Anchors

Current placed anchors:

- `pnpm drill ttfe` and `scripts/drill.mjs` are the developer-spine proof: pack `@ship/shared`, `@ship/sdk`, and `@ship/cli`; install into a fresh temp project; run real CLI login/docs/webhook tail against the local API. Workspace symlinks are not proof.
- Public API canon lives in `api/src/platform/api/v1/`: router, route registry, generated OpenAPI contracts, request parsing by `operationId`, cursor envelopes, public errors, SQL/read-model helpers, and public path composition from `shared/src/public-api-paths.ts`.
- Public work resources are document-backed: documents, issues, sprints, nested sprint issues, and FleetGraph attention contexts. Read models own visibility-aware SQL/mappers; mutation payloads reuse `document-core.ts` and `issue-core.ts`.
- OAuth canon lives under `api/src/platform/oauth/`: Device Grant, Authorization Code + PKCE, refresh rotation, grants, secrets, scopes, `invalid_grant`, and consent/browser routes. App registration remains session-authenticated under `/api/platform/apps`.
- Webhook canon is the events/signature/headers/retry/outbox pipeline under `api/src/platform/webhooks/` plus public payload schemas in `shared/src/public-api-webhooks.ts`. Domain mutations publish durable rows in transaction and dispatch after commit.
- Developer ops routes/UI are the session-auth workspace-admin control plane for app creation, shown-once secrets, rotation/revoke, subscriptions, delivery logs, DLQ replay, and public audit rows.
- `@ship/sdk` is the external client surface: fetch-based `ShipClient`, token stores, documents/issues/sprints/webhooks clients, OAuth flows, refresh locking, typed errors, async iterators, and webhook verification. Browser imports from the root SDK may warn on optional `node:*` exports.
- `integrations/cli` ships `@ship/cli`; it imports Ship only through `@ship/sdk`, keeps SDK as a peer dependency for packed installs, and implements login/docs/issues/sprints/fleetgraph/webhooks commands.
- `integrations/README.md` and `scripts/ci/check-integration-boundary.mjs` enforce external integration boundaries. Slack/GitLab/browser SDK references should use public API/SDK, not internal app modules.
- `my-docs/project-weeks-sot/week-6/proof-ledger.yaml` is the Week 6 atom ledger (SSOT for PlugForge closure). `scripts/ci/check-plugforge-proof-ledger.mjs` validates IDs, proof paths, covered-by targets, and pending TODO/fixme traceability. Week 4 `submission-ledger.json` is historical Cat 1–8 only — see `my-docs/scripts-traceability.md`.
- `api/src/platform/plugforge-acceptance.todo.test.ts` is the remaining PlugForge pending inventory for global closure. The browser SDK fixme was retired into `e2e/plugforge-acceptance.spec.ts` after W6-INT-008/009 were proven. Do not delete a TODO/fixme until the matching ledger atom is proven by an executable command.
- Metric probes live under `scripts/plugforge-metrics/` and must fail closed when they cannot measure. `pnpm plugforge:metrics` covers TTFE stages/flake, OAuth P95, webhook P95, SDK size, verifier speed, and baseline drift.
- `docs/architecture.md` is intentionally deferred for this group; do not spend agent-cycle on it until the final architecture/docs pass.

## Product And System Invariants

OAuth platform access is separate from legacy `api_tokens`. `/api/v1/*` validates OAuth access tokens from `oauth_access_tokens`; do not green-light public API behavior through legacy API-token auth.

App registration and developer portal operations are session-auth workspace-admin routes under `/api/platform/apps`. They are not public `/api/v1` routes and not OAuth protocol endpoints.

`/api/v1/me` is auth-only route metadata with `requiredScopes: []`. Do not invent `me:read`; keep the canonical public scope list exact until a real public resource needs another scope.

Device Grant is the CLI login path. Authorization Code + PKCE is the browser/client front door: exact registered `redirect_uri`, registered public scopes, S256 challenge, 15-minute `ship_oat_*` access tokens, one-time `ship_oac_*` codes, one-time `ship_ort_*` refresh tokens, and `invalid_grant` for verifier/reuse/expiry/client/redirect mismatches.

OAuth grants/tokens are service-owned. Access-token creation requires current workspace membership; preserve the explicit `membership_revoked` denial reason. Refresh-token reuse must durably invalidate the whole family and revoke linked access tokens before returning `invalid_grant`.

OAuth app secrets are rows, not mutable columns. Rotation inserts a new active secret, moves the previous active secret to 24h grace unless immediate revoke is requested, and never returns raw secrets from list/audit/log read models.

Public `/api/v1` routes count only when registered in `publicApiV1RouteRegistry`. The registry owns method, public path, operation id, auth mode, required scopes, handler mount path, list/pagination status, and SDK metadata. `GET | POST | PATCH` is an edge-piece set, not a closed-world future HTTP contract.

Public OpenAPI is separate from internal OpenAPI. `api/openapi.json` is internal; `docs/openapi.json` is generated from public route contracts. Runtime validation and OpenAPI schemas must stay close enough for generated clients, including URL shape, credentials, fragments, scopes, and validation `details`.

Public document creates may honor explicit titles only for OAuth/public principals. Existing internal create flows must keep defaulting new document titles to exactly `"Untitled"`.

Public issues and sprints are document-backed resources, not new tables. `issues:*` and `sprints:*` scopes map through capability authorization for document types `issue` and `sprint`; do not grant broad `documents:*` just to support work APIs.

`GET /api/v1/sprints/:id/issues` exposes issue data and requires both `sprints:read` and `issues:read`. Its public query schema intentionally omits `sprint_id`; the path parameter is the only sprint filter.

Public issue patch is intentionally narrow: `state`, `assignee_id`, and `confirm_orphan_children`. Public close conflicts return HTTP `409` with `ApiError.code: "validation_failed"` and typed `details.reason: "incomplete_children"`; do not add `conflict` to the public error-code union without a canon change.

Public issue/sprint read models must authorize related data, not just primary rows. Associated programs, weekly plans, retros, accountability targets, labels, counts, filters, and webhook payload fields need same-workspace, non-archived/non-deleted, visibility, and subject-specific predicates.

Webhook document/issue/sprint events are enqueued inside domain mutation transactions and dispatched after commit. Payloads expose IDs/title/type/API+UI URLs and actor ID, not full document content. Replays preserve the original `Idempotency-Key`.

Webhook subscriptions carry read context: `read_subject_user_id`, `read_subject_scopes`, `read_context_source`, and resource metadata. Private events may enqueue; only subscriptions whose stored subject can currently read the resource get delivery rows.

Webhook retry semantics are deterministic-testable: injected clock, deliverer, timeout, validation, and DB runner; no real sleeps in tests. Delivery attempts must be atomically claimed before outbound POST and retry transitions must update/insert in one transaction.

Mounted PlugForge HTTP routes must be visible to OpenAPI route parity checks. Boundary lint is part of the contract: `api/src/platform/api/v1/**` must not import internal `api/src/routes/**`, and `integrations/**` must not import app internals; external Ship access goes through `@ship/sdk`.

Public `/api/v1` rate limiting runs before public audit inserts. Do not re-order casually; unauthenticated 429 traffic must not force durable audit-log writes. Public request IDs are accepted from `x-request-id` only up to 128 chars.

Ship Agent public access is delegated, not Client Credentials. `agent-token-broker.ts` mints short-lived real OAuth access tokens for the first-party `ship-agent` app, tied to the initiating user/session. Caller-requested scopes must be both in `SHIP_AGENT_READ_SCOPES` and the app's requested scopes.

`FLEETGRAPH_USE_PUBLIC_API` is user-initiated only. FleetGraph chat/source reads may receive a `ShipClient` and call public documents/attention-context APIs; scheduled workers and FleetGraph-owned finding/run persistence stay internal.

`GET /api/v1/fleetgraph/attention-contexts` is the narrow public read model for detector-critical issue/sprint context. It requires `documents:read`, `issues:read`, and `sprints:read`; do not add FleetGraph write scopes or public finding/run mutation endpoints for convenience. Keep the route/SDK path derived from shared Zod types.

## Counterfeit Progress

Plugforge anchor files must say whether they are exact canon, intentionally partial, or an inert boundary. A narrow type such as `GET | POST` is acceptable only if the comment prevents future agents from treating it as a closed-world contract. No more fake-green placeholders: inert SDK/API methods throw or remain type-only until wired.

## Local Reality Checks

- Use `pnpm plugforge:ledger` for structural ledger validation. Global `pnpm plugforge:ledger:enforce` is expected to fail while unrelated P0/P1 atoms remain missing/partial.
- Use scoped ledger enforcement as closure signal: `pnpm plugforge:ledger:enforce -- --area OAUTH,API,PORTAL,SDK,CLI,AGENT --status missing,partial` and `pnpm plugforge:ledger:enforce -- --area WEBHOOK,METRIC --status missing,partial`.
- Current closure proof pack is targeted API coverage for apps/OAuth/public-api fitness/route metadata/middleware/webhooks, SDK+CLI tests/checks, `pnpm plugforge:oauth-e2e`, `pnpm plugforge:developer-ops-e2e`, `pnpm plugforge:llm-boundary`, `pnpm plugforge:verify`, `pnpm plugforge:metrics`, `pnpm plugforge:integrations`, and `pnpm test:e2e:smoke`.
- Direct Vitest defaults can target `ship_dev`; prefer `scripts/run-api-tests.sh -- ...` or resolve `ship_test_audit` explicitly. If `ship_test_audit` is stale, migrate it before blaming OAuth/public API tests.
- `pnpm plugforge:metrics` writes local JSON under `my-docs/evidence/plugforge-metrics/`; CI uploads clean per-run artifacts from `my-docs/evidence/plugforge-metrics-ci/**`.
- INT closure is `pnpm plugforge:integrations` plus scoped enforcement: `pnpm plugforge:ledger:enforce -- --area INT --status missing,partial`. The harness writes current-run Slack/GitLab/browser/matrix JSON under `my-docs/evidence/plugforge-integrations/`.

## Leverage Points

- `@ship/cli` public commands: `ship me`, `ship documents|docs`, `ship issues`, `ship sprints`, `ship fleetgraph attention-contexts`, `ship webhooks subscriptions|deliveries|tail` (all via `@ship/sdk` only). Default `ship login` scopes include `issues:read` and `sprints:read` so FleetGraph CLI matches `SHIP_AGENT_READ_SCOPES` + write/manage flags.

The TTFE developer spine is now real enough to compose: Device Grant login -> OAuth token -> public documents -> generated public OpenAPI -> SDK/CLI -> signed `document.created` webhook -> `pnpm drill ttfe`. Public work APIs add issues/sprints and issue webhooks, and FleetGraph now has delegated public source-read access. The next leverage is Slack/GitLab through the public API and SDK, not new internal integration shortcuts.

## Sharp Edges

Do not add `docs/openapi.json` by hand; canon requires generated OpenAPI. `plugforge-verify.sh` now runs `public-openapi:generate` and fails if `docs/openapi.json` drifts. Do not rely on shell `DATABASE_URL` for `pnpm drill ttfe`; the drill resolves `ship_test_audit` unless `TTFE_DATABASE_URL` is set.

Do not add `slow_down` as a canon literal from the main spec body alone; the body says slow-down responses, while exact wire spelling currently comes from appendix/supporting context.

`client_secret` hashes use Argon2id via `argon2`; OAuth access tokens are high-entropy random bearer tokens stored by SHA-256 hash for lookup. Keep that split unless a later threat model changes it deliberately.

Seeded OAuth access-token tests are not sufficient proof of a platform front door. Keep at least one proof that obtains a code through browser consent, exchanges it with PKCE, then uses the minted access token against `/api/v1/me`.

Fresh E2E databases bootstrap from `api/src/db/schema.sql` and mark migrations applied. Any migration that adds PlugForge tables needed by E2E must update the schema snapshot too, or Playwright will fail inside a missing-table/column trap instead of the feature under test.
