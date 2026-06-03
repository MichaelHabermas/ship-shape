# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work. Prune ruthlessly.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat.

## Week 5 Demarcation

As of 2026-06-02, active memory should bias toward durable invariants, current rails, and traps likely to affect new work.

## Plugforge Anchors

Current placed anchors:

- `pnpm drill ttfe` root script and `scripts/drill.mjs`, now a packed-artifact drill that starts API, approves Device Grant through local test DB state, creates a document, and verifies a signed webhook through `ship webhooks tail`.
- `scripts/drill.mjs` builds and packs `@ship/shared`, `@ship/sdk`, and `@ship/cli`, installs the tarballs into a fresh temp project, and then runs the real CLI against the local API. That packed-install path is the proof; workspace symlinks are not.
- `api/src/platform/scopes/registry.ts` with exact initial public scopes.
- `api/src/platform/webhooks/events.ts` with exact initial event names.
- `api/src/platform/webhooks/retry-schedule.ts` with exact retry delays and max attempts.
- `api/src/platform/webhooks/signature.ts` with `Ship-Signature`, `v1`, and default tolerance `300`.
- `api/src/platform/webhooks/headers.ts` with `Idempotency-Key`.
- `api/src/platform/webhooks/event-bus.ts` with in-process public webhook publication.
- `api/src/platform/webhooks/deliverer.ts` with inert `IWebhookDeliverer`.
- `api/src/platform/webhooks/delivery-log.ts` with canon-named delivery attempt fields only.
- `api/src/platform/apps/routes.ts` and `service.ts` with the session-auth developer ops control plane: app list/create, secret rotate/revoke, app webhooks, delivery log, replay, and public audit rows.
- `api/src/db/migrations/056_oauth_app_secrets.sql` with per-secret IDs, `active | grace | revoked` status, 24h grace rotation, immediate revoke, and shown-once raw secret behavior.
- `api/src/platform/api/v1/router.ts` mounted at `/api/v1` with public rate-limit/audit middleware, unauthenticated public OpenAPI, `/me`, documents, issues, sprints, and webhooks.
- `api/src/platform/api/v1/paths.ts` with canon-named public paths only.
- `api/src/platform/api/v1/pagination.ts` with public cursor/list envelope types.
- `api/src/platform/api/v1/errors.ts` with exact public `ApiError` contract.
- `api/src/platform/api/v1/route-metadata.ts` with the typed public route registry for public OpenAPI, `/me`, documents, issues, sprints, and webhooks; `requiredScopes` is a list because `/api/v1/sprints/:id/issues` requires both `sprints:read` and `issues:read`; `GET | POST | PATCH` is an edge-piece set, not the whole future HTTP contract.
- `api/src/platform/api/v1/issues.ts`, `sprints.ts`, and `issue-read-model.ts` with the public document-backed work API: issue list/get/create/narrow patch, sprint list/get, and nested sprint issues.
- `api/src/services/issue-mutations/webhook-events.ts` with issue webhook payload/idempotency helpers called from issue mutation services.
- `api/src/platform/oauth/routes.ts` with exact OAuth route paths.
- `api/src/platform/oauth/errors.ts` with exact `invalid_grant` anchor.
- `api/src/platform/oauth/provider.ts` with real Authorization Code + PKCE, consent grants, one-time codes, access token issuance, refresh rotation, and refresh-family reuse invalidation.
- `api/src/platform/oauth/http-routes.ts` mounted at `/oauth` for `/authorize`, `/consent/request/:requestId`, `/consent/approve`, and `/token`.
- `web/src/pages/OAuthConsent.tsx` and React route `/oauth/consent` as the authenticated consent UI; Vite proxies only protocol/helper routes so the consent page stays client-side.
- `api/src/db/migrations/052_oauth_authorization_code_pkce.sql` and `api/src/db/schema.sql` include pending auth requests, grants, one-time auth codes, refresh-token families/tokens, and nullable access-token links.
- `api/src/platform/ratelimit/headers.ts` with exact rate-limit header names.
- `sdk/` workspace package `@ship/sdk` with fetch-based `ShipClient`, token stores, documents/issues/sprints/webhooks clients, `deviceLogin()`, `authorizationCodeFlow()`, refresh locking, typed `ShipError`, async iterators, and `verifyWebhook(...)`.
- `sdk/src/index.ts` is dependency-light but exports Node `FileTokenStore`; browser builds may warn about optional `node:*` dynamic imports if they import the root SDK bundle.
- `sdk/src/errors.ts` with typed SDK error class/kinds.
- `docs/architecture.md` is intentionally deferred for this group; do not spend agent-cycle on it until the final architecture/docs pass.
- `integrations/README.md` with the external integration import boundary.
- `integrations/cli` workspace package `@ship/cli` with bin `ship`; it imports only `@ship/sdk`, keeps SDK as a peer dependency for packed installs, and implements login/docs/webhooks tail.
- `web/src/pages/DeveloperSettingsTab.tsx` under workspace settings with the minimum ops UI: app selector, shown-once secret panel, rotation/revoke, subscriptions, delivery log with DLQ filter/replay, and public audit table.
- `web/src/pages/SdkDemo.tsx` at `/sdk-demo` with browser Authorization Code + PKCE through `ShipClient.authorizationCodeFlow()`, `BrowserTokenStore`, document+issue lists, and explicit `documents:write` for the demo create button.
- `e2e/developer-ops.spec.ts` is the targeted Playwright drill for portal create -> webhook DLQ -> replay with preserved `Idempotency-Key`.

## Product And System Invariants

OAuth platform access is separate from legacy `api_tokens`. `/api/v1/*` validates OAuth access tokens from `oauth_access_tokens`; do not green-light public API behavior through legacy API-token auth.

OAuth app registration lives at session-authenticated `POST /api/platform/apps`. It is an internal/session app-management route, not a public `/api/v1` route and not an OAuth protocol endpoint.

`/api/v1/me` is auth-only route metadata with `requiredScopes: []`. Do not invent `me:read`; the canonical scope list remains exact until a real public resource needs another scope.

Device Grant is the CLI login path. `/oauth/device/code` issues hashed device/user codes, `/oauth/device` is the authenticated browser verification page, `/oauth/device/verify` approves with session+CSRF, and `/oauth/token` polls `urn:ietf:params:oauth:grant-type:device_code` with `authorization_pending` and `slow_down`.

Public `/api/v1` routes must be registered in `publicApiV1RouteRegistry` before they count as real platform contract. The registry owns method, public path, operation id, auth mode, required scopes, handler mount path, list/pagination status, and SDK metadata for future OpenAPI/SDK/docs parity.

Public OpenAPI is separate from internal OpenAPI. `api/openapi.json` is the internal `/api` spec; `docs/openapi.json` is generated from `api/src/platform/api/v1/openapi.ts`. `pnpm openapi:check:strict` compares both specs separately.

Platform OpenAPI schemas must mirror runtime validation closely enough for generated clients. If a route rejects URL shape, credential, fragment, scope, or validation-error `details` fields, the internal spec must advertise that behavior before regenerating client types.

Public document creates may honor explicit titles only for OAuth/public principals. Existing internal create flows must keep defaulting new document titles to exactly `"Untitled"`.

Public issues and sprints are document-backed resources, not new tables. `issues:*` and `sprints:*` scopes map through capability authorization for expected document types `issue` and `sprint`; do not grant broad `documents:*` just to support work APIs.

`GET /api/v1/sprints/:id/issues` exposes issue data and therefore requires both `sprints:read` and `issues:read`. Keep that dual-scope requirement if nested sprint issue reads move or get refactored. Its public query schema intentionally omits `sprint_id`; the path parameter is the only source of sprint filtering.

Public issue/sprint read models must apply visibility checks to related documents, not just the primary row. Associated programs, weekly plans, retros, and accountability targets need same-workspace, non-archived/non-deleted, visibility, and accountability predicates before they appear in public payloads or relationship filters.

Public issue patch is intentionally narrow: `state`, `assignee_id`, and `confirm_orphan_children`. Do not expose title, priority, associations, estimate, metadata, or broad internal issue fields without a new canonical workflow.

Webhook `document.created` is enqueued inside the `createDocumentMutation` transaction and dispatched after commit. Payloads include IDs/title/type/API+UI URLs and actor ID, not full document content. Replays preserve the original `Idempotency-Key`.

Webhook `issue.created`, `issue.assigned`, and `issue.status_changed` are enqueued inside issue mutation services, not public route handlers. Future Slack/GitLab integrations should consume these domain events or public SDK/API methods, not duplicate issue mutation logic.

Webhook subscriptions carry read context: `read_subject_user_id`, `read_subject_scopes`, `read_context_source`, and resource metadata on `webhook_events`. Private issue/document events may enqueue; only subscriptions whose stored subject can currently read the resource get delivery rows.

Webhook retry semantics are deterministic-testable: delivery uses injected clock, deliverer, timeout, validation, and DB runner dependencies. Do not reintroduce real sleeps in webhook tests; prove retry/DLQ by advancing fake time over the canon schedule.

Webhook delivery attempts must be atomically claimed before outbound POST. Due processing delivers pending rows plus stale `sending` rows; retry transitions update the failed attempt and insert the next pending attempt inside one transaction so crashes do not strand deliveries or double-send.

OAuth app secrets are rows, not mutable columns. Rotation inserts a new active secret, moves the previous active secret to 24h grace unless immediate revoke is requested, and never returns raw secrets from list/audit/log read models.

OAuth app secret rows carry status/timestamp invariants at the DB boundary: active has no expiry/revocation timestamp, grace has a non-null expiry and no revocation timestamp, and revoked has a revocation timestamp.

Developer portal routes are session-auth workspace-admin routes under `/api/platform/apps`; public `/api/v1/webhooks` remains the external contract. Portal delivery/replay must call the same webhook services, not duplicate delivery logic.

Mounted PlugForge HTTP routes must be visible to OpenAPI route parity checks even while public OpenAPI product work is deferred. `scripts/check-openapi-routes.mjs` scans both `api/src/routes` and `api/src/platform`; do not let platform routes bypass the contract gate.

Boundary lint is part of the PlugForge contract: `api/src/platform/api/v1/**` must not import internal `api/src/routes/**`, and `integrations/**` must not import `api/src/**`, `web/src/**`, or `@/*`; external Ship access goes through `@ship/sdk`.

Public `/api/v1` rate limiting runs before public audit inserts. Do not re-order that middleware casually; unauthenticated 429 traffic must not force durable audit-log writes. Public request IDs are accepted from `x-request-id` only up to 128 chars.

OAuth access-token creation requires the user to be a current member of the app workspace. Do not add a cascading membership FK to `oauth_access_tokens`; validation must preserve the explicit `membership_revoked` denial reason after membership removal.

OAuth Authorization Code + PKCE is now the real PlugForge front door: `/oauth/authorize` requires `response_type=code`, exact registered `redirect_uri`, registered public scopes, and `code_challenge_method=S256`; approval redirects with a one-time `ship_oac_*` code; `/oauth/token` returns 15-minute `ship_oat_*` access tokens and one-time `ship_ort_*` refresh tokens. Wrong verifier, reused/expired code, client mismatch, redirect mismatch, and refresh reuse return `invalid_grant`.

OAuth grants/tokens are service-owned. Keep app/user/workspace consent, code exchange, access issuance, refresh rotation, and reuse invalidation in `api/src/platform/oauth/provider.ts`; routes should remain HTTP parsing/session/CSRF adapters.

Refresh-token reuse must durably invalidate the whole family and revoke linked access tokens before returning `invalid_grant`. Do not throw inside a transaction before committing the invalidation.

Ship Agent public access is delegated, not Client Credentials. `api/src/platform/oauth/agent-token-broker.ts` mints short-lived real OAuth access tokens for the first-party `ship-agent` app, tied to the initiating user/session, so public audit rows retain both app and user identity.

The Ship Agent token broker must fail closed on scopes: caller-requested scopes are allowed only when they are both in the canonical Ship Agent read set and the app's requested scopes. Do not let a convenience caller mint write scopes through the broker.

`FLEETGRAPH_USE_PUBLIC_API` is user-initiated only. FleetGraph chat/source reads can receive a `ShipClient` and call public documents/attention-context APIs; scheduled workers and FleetGraph-owned finding/run persistence stay internal.

`GET /api/v1/fleetgraph/attention-contexts` is the narrow public read model for detector-critical issue/sprint context. It requires `documents:read`, `issues:read`, and `sprints:read`; do not add FleetGraph write scopes or public finding/run mutation endpoints for convenience.

Type-contract audit for the Agent-as-Citizen slice found the new public FleetGraph route/SDK path correctly derives from shared Zod types. Keep it that way: no hand-rolled attention-context response types in SDK/API tests, and no ghost aliases for shared enums.

## Counterfeit Progress

Plugforge anchor files must say whether they are exact canon, intentionally partial, or an inert boundary. A narrow type such as `GET | POST` is acceptable only if the comment prevents future agents from treating it as a closed-world contract. No more fake-green placeholders: inert SDK/API methods throw or remain type-only until wired.

## Local Reality Checks

After anchor placement on 2026-06-02, targeted verification passed with `pnpm --filter @ship/api type-check` and `pnpm --filter @ship/sdk type-check`. Broad verification is not useful until the first real vertical slice exists.

After the OAuth front door slice on 2026-06-02, targeted PlugForge tests should run through `scripts/run-api-tests.sh -- src/platform/apps/routes.test.ts src/platform/api/v1/me.test.ts src/platform/api/v1/middleware.test.ts src/platform/oauth/tokens.test.ts src/platform/oauth/provider.test.ts`. Direct Vitest defaults to `ship_dev` unless `DATABASE_URL` is set and should refuse to truncate it. If `ship_test_audit` is stale, run `DATABASE_URL="$(./scripts/resolve-database-url.sh ship_test_audit)" pnpm db:migrate` before blaming OAuth tests.

After the developer ops slice on 2026-06-02, targeted reliability/control-plane proof is `scripts/run-api-tests.sh -- src/platform/apps/routes.test.ts src/platform/webhooks/service.test.ts src/platform/api/v1/webhooks.test.ts src/platform/oauth/provider.test.ts src/platform/api/v1/middleware.test.ts`, plus `pnpm --filter @ship/web exec vitest run src/pages/DeveloperSettingsTab.test.tsx` and `PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/developer-ops.spec.ts`.

After the public work API + browser SDK demo slice on 2026-06-02, targeted proof is `scripts/run-api-tests.sh -- src/platform/api/v1/route-metadata.test.ts src/platform/api/v1/issues.test.ts src/platform/api/v1/sprints.test.ts src/services/issue-mutations/webhook-events.test.ts src/platform/webhooks/service.test.ts src/platform/api/v1/webhooks.test.ts`, `pnpm --filter @ship/sdk test`, `pnpm --filter @ship/web exec vitest run src/pages/SdkDemo.test.tsx`, `pnpm openapi:check:strict`, and then full local gates.

The final correctness pass for that earlier public work API slice proved visibility-aware related-document reads, the then-temporary private issue webhook suppression, dual-scope route metadata, SDK/OpenAPI parity, `pnpm type-check`, `pnpm lint`, and `pnpm build`. The suppression is superseded by webhook read-context filtering in the Agent-as-Citizen slice.

After the Agent-as-Citizen read-context foundation slice on 2026-06-02, targeted proof is `scripts/run-api-tests.sh -- src/platform/webhooks/service.test.ts src/services/issue-mutations/webhook-events.test.ts src/platform/api/v1/webhooks.test.ts src/platform/apps/routes.test.ts src/platform/oauth/agent-token-broker.test.ts src/platform/api/v1/route-metadata.test.ts src/platform/api/v1/fleetgraph.test.ts src/config/fleetgraph.test.ts src/routes/fleetgraph.test.ts src/fleetgraph/core.test.ts`, plus `pnpm --filter @ship/sdk test`, `pnpm --filter @ship/cli check`, `pnpm openapi:check:strict`, `pnpm drill ttfe`, `pnpm type-check`, `pnpm lint`, `pnpm test:api`, and `pnpm build`.

## Leverage Points

The TTFE developer spine is now real enough to compose: Device Grant login -> OAuth token -> public documents -> generated public OpenAPI -> SDK/CLI -> signed `document.created` webhook -> `pnpm drill ttfe`. Public work APIs add issues/sprints and issue webhooks, and FleetGraph now has delegated public source-read access. The next leverage is Slack/GitLab through the public API and SDK, not new internal integration shortcuts.

## Sharp Edges

Do not add `docs/openapi.json` by hand; canon requires generated OpenAPI. Do not add `slow_down` as a canon literal from the main spec body alone; the body says slow-down responses, while exact wire spelling currently comes from appendix/supporting context.

`client_secret` hashes use Argon2id via `argon2`; OAuth access tokens are high-entropy random bearer tokens stored by SHA-256 hash for lookup. Keep that split unless a later threat model changes it deliberately.

Seeded OAuth access-token tests are not sufficient proof of a platform front door. Keep at least one proof that obtains a code through browser consent, exchanges it with PKCE, then uses the minted access token against `/api/v1/me`.

Fresh E2E databases bootstrap from `api/src/db/schema.sql` and mark migrations applied. Any migration that adds PlugForge tables needed by E2E must update the schema snapshot too, or Playwright will fail inside a missing-table/column trap instead of the feature under test.

## User And Team Preferences

## External Constraints

## Retired Beliefs
