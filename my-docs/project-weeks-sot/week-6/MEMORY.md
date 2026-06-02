# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work. Prune ruthlessly.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat.

## Week 5 Demarcation

As of 2026-06-02, active memory should bias toward durable invariants, current rails, and traps likely to affect new work.

## Plugforge Anchors

Current placed anchors:

- `pnpm drill ttfe` root script and `scripts/drill.mjs`, now a packed-artifact drill that starts API, approves Device Grant through local test DB state, creates a document, and verifies a signed webhook through `ship webhooks tail`.
- `api/src/platform/scopes/registry.ts` with exact initial public scopes.
- `api/src/platform/webhooks/events.ts` with exact initial event names.
- `api/src/platform/webhooks/retry-schedule.ts` with exact retry delays and max attempts.
- `api/src/platform/webhooks/signature.ts` with `Ship-Signature`, `v1`, and default tolerance `300`.
- `api/src/platform/webhooks/headers.ts` with `Idempotency-Key`.
- `api/src/platform/webhooks/event-bus.ts` with in-process public webhook publication.
- `api/src/platform/webhooks/deliverer.ts` with inert `IWebhookDeliverer`.
- `api/src/platform/webhooks/delivery-log.ts` with canon-named delivery attempt fields only.
- `api/src/platform/api/v1/router.ts` mounted at `/api/v1` with public rate-limit/audit middleware, unauthenticated public OpenAPI, `/me`, documents, and webhooks.
- `api/src/platform/api/v1/paths.ts` with canon-named public paths only.
- `api/src/platform/api/v1/pagination.ts` with public cursor/list envelope types.
- `api/src/platform/api/v1/errors.ts` with exact public `ApiError` contract.
- `api/src/platform/api/v1/route-metadata.ts` with the typed public route registry for public OpenAPI, `/me`, documents, and webhooks; `GET | POST` is an edge-piece set, not the whole future HTTP contract.
- `api/src/platform/oauth/routes.ts` with exact OAuth route paths.
- `api/src/platform/oauth/errors.ts` with exact `invalid_grant` anchor.
- `api/src/platform/oauth/provider.ts` with real Authorization Code + PKCE, consent grants, one-time codes, access token issuance, refresh rotation, and refresh-family reuse invalidation.
- `api/src/platform/oauth/http-routes.ts` mounted at `/oauth` for `/authorize`, `/consent/request/:requestId`, `/consent/approve`, and `/token`.
- `web/src/pages/OAuthConsent.tsx` and React route `/oauth/consent` as the authenticated consent UI; Vite proxies only protocol/helper routes so the consent page stays client-side.
- `api/src/db/migrations/052_oauth_authorization_code_pkce.sql` and `api/src/db/schema.sql` include pending auth requests, grants, one-time auth codes, refresh-token families/tokens, and nullable access-token links.
- `api/src/platform/ratelimit/headers.ts` with exact rate-limit header names.
- `sdk/` workspace package `@ship/sdk` with fetch-based `ShipClient`, token stores, documents/webhooks clients, `deviceLogin()`, refresh locking, typed `ShipError`, and `verifyWebhook(...)`.
- `sdk/src/index.ts` is dependency-light but exports Node `FileTokenStore`; browser builds may warn about optional `node:*` dynamic imports if they import the root SDK bundle.
- `sdk/src/errors.ts` with typed SDK error class/kinds.
- `docs/architecture.md` is now an honest current-state PlugForge architecture artifact: implemented spine, pre-1.0 gaps, and failure modes are labeled instead of left as placeholders.
- `integrations/README.md` with the external integration import boundary.
- `integrations/cli` workspace package `@ship/cli` with bin `ship`; it imports only `@ship/sdk`, keeps SDK as a peer dependency for packed installs, and implements login/docs/webhooks tail.

## Product And System Invariants

OAuth platform access is separate from legacy `api_tokens`. `/api/v1/*` validates OAuth access tokens from `oauth_access_tokens`; do not green-light public API behavior through legacy API-token auth.

OAuth app registration lives at session-authenticated `POST /api/platform/apps`. It is an internal/session app-management route, not a public `/api/v1` route and not an OAuth protocol endpoint.

`/api/v1/me` is auth-only route metadata with `requiredScope: null`. Do not invent `me:read`; the canonical scope list remains exact until a real public resource needs another scope.

Device Grant is the CLI login path. `/oauth/device/code` issues hashed device/user codes, `/oauth/device` is the authenticated browser verification page, `/oauth/device/verify` approves with session+CSRF, and `/oauth/token` polls `urn:ietf:params:oauth:grant-type:device_code` with `authorization_pending` and `slow_down`.

Public `/api/v1` routes must be registered in `publicApiV1RouteRegistry` before they count as real platform contract. The registry owns method, public path, operation id, auth mode, required scope, handler mount path, list/pagination status, and SDK metadata for future OpenAPI/SDK/docs parity.

Public OpenAPI is separate from internal OpenAPI. `api/openapi.json` is the internal `/api` spec; `docs/openapi.json` is generated from `api/src/platform/api/v1/openapi.ts`. `pnpm openapi:check:strict` compares both specs separately.

Public document creates may honor explicit titles only for OAuth/public principals. Existing internal create flows must keep defaulting new document titles to exactly `"Untitled"`.

Webhook `document.created` is enqueued inside the `createDocumentMutation` transaction and dispatched after commit. Payloads include IDs/title/type/API+UI URLs and actor ID, not full document content. Replays preserve the original `Idempotency-Key`.

Mounted PlugForge HTTP routes must be visible to OpenAPI route parity checks even while public OpenAPI product work is deferred. `scripts/check-openapi-routes.mjs` scans both `api/src/routes` and `api/src/platform`; do not let platform routes bypass the contract gate.

Boundary lint is part of the PlugForge contract: `api/src/platform/api/v1/**` must not import internal `api/src/routes/**`, and `integrations/**` must not import `api/src/**`, `web/src/**`, or `@/*`; external Ship access goes through `@ship/sdk`.

Public `/api/v1` rate limiting runs before public audit inserts. Do not re-order that middleware casually; unauthenticated 429 traffic must not force durable audit-log writes. Public request IDs are accepted from `x-request-id` only up to 128 chars.

OAuth access-token creation requires the user to be a current member of the app workspace. Do not add a cascading membership FK to `oauth_access_tokens`; validation must preserve the explicit `membership_revoked` denial reason after membership removal.

OAuth Authorization Code + PKCE is now the real PlugForge front door: `/oauth/authorize` requires `response_type=code`, exact registered `redirect_uri`, registered public scopes, and `code_challenge_method=S256`; approval redirects with a one-time `ship_oac_*` code; `/oauth/token` returns 15-minute `ship_oat_*` access tokens and one-time `ship_ort_*` refresh tokens. Wrong verifier, reused/expired code, client mismatch, redirect mismatch, and refresh reuse return `invalid_grant`.

OAuth grants/tokens are service-owned. Keep app/user/workspace consent, code exchange, access issuance, refresh rotation, and reuse invalidation in `api/src/platform/oauth/provider.ts`; routes should remain HTTP parsing/session/CSRF adapters.

Refresh-token reuse must durably invalidate the whole family and revoke linked access tokens before returning `invalid_grant`. Do not throw inside a transaction before committing the invalidation.

## Counterfeit Progress

Plugforge anchor files must say whether they are exact canon, intentionally partial, or an inert boundary. A narrow type such as `GET | POST` is acceptable only if the comment prevents future agents from treating it as a closed-world contract. No more fake-green placeholders: inert SDK/API methods throw or remain type-only until wired.

## Local Reality Checks

After anchor placement on 2026-06-02, targeted verification passed with `pnpm --filter @ship/api type-check` and `pnpm --filter @ship/sdk type-check`. Broad verification is not useful until the first real vertical slice exists.

After the OAuth front door slice on 2026-06-02, targeted PlugForge tests should run through `scripts/run-api-tests.sh -- src/platform/apps/routes.test.ts src/platform/api/v1/me.test.ts src/platform/api/v1/middleware.test.ts src/platform/oauth/tokens.test.ts src/platform/oauth/provider.test.ts`. Direct Vitest defaults to `ship_dev` unless `DATABASE_URL` is set and should refuse to truncate it. If `ship_test_audit` is stale, run `DATABASE_URL="$(./scripts/resolve-database-url.sh ship_test_audit)" pnpm db:migrate` before blaming OAuth tests.

## Leverage Points

The TTFE developer spine is now real enough to compose: Device Grant login -> OAuth token -> public documents -> generated public OpenAPI -> SDK/CLI -> signed `document.created` webhook -> `pnpm drill ttfe`. Next leverage is hardening delivery operations/portal read models, not adding Slack/GitLab/plugin runtime.

## Sharp Edges

Do not add `docs/openapi.json` by hand; canon requires generated OpenAPI. Do not add `slow_down` as a canon literal from the main spec body alone; the body says slow-down responses, while exact wire spelling currently comes from appendix/supporting context.

`client_secret` hashes use Argon2id via `argon2`; OAuth access tokens are high-entropy random bearer tokens stored by SHA-256 hash for lookup. Keep that split unless a later threat model changes it deliberately.

Seeded OAuth access-token tests are not sufficient proof of a platform front door. Keep at least one proof that obtains a code through browser consent, exchanges it with PKCE, then uses the minted access token against `/api/v1/me`.

## User And Team Preferences

## External Constraints

## Retired Beliefs
