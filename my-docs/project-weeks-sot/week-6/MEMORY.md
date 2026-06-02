# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work. Prune ruthlessly.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat.

## Week 5 Demarcation

As of 2026-06-02, active memory should bias toward durable invariants, current rails, and traps likely to affect new work.

## Plugforge Anchors

Current placed anchors:

- `pnpm drill ttfe` root script and `scripts/drill.mjs`, intentionally failing as not wired.
- `api/src/platform/scopes/registry.ts` with exact initial public scopes.
- `api/src/platform/webhooks/events.ts` with exact initial event names.
- `api/src/platform/webhooks/retry-schedule.ts` with exact retry delays and max attempts.
- `api/src/platform/webhooks/signature.ts` with `Ship-Signature`, `v1`, and default tolerance `300`.
- `api/src/platform/webhooks/headers.ts` with `Idempotency-Key`.
- `api/src/platform/webhooks/event-bus.ts` with inert `IEventBus`.
- `api/src/platform/webhooks/deliverer.ts` with inert `IWebhookDeliverer`.
- `api/src/platform/webhooks/delivery-log.ts` with canon-named delivery attempt fields only.
- `api/src/platform/api/v1/router.ts` mounted at `/api/v1` with public audit middleware and `/me`.
- `api/src/platform/api/v1/paths.ts` with canon-named public paths only.
- `api/src/platform/api/v1/pagination.ts` with public cursor/list envelope types.
- `api/src/platform/api/v1/errors.ts` with exact public `ApiError` contract.
- `api/src/platform/api/v1/route-metadata.ts` with minimal route metadata; `GET | POST` is an edge-piece set, not the whole future HTTP contract.
- `api/src/platform/oauth/routes.ts` with exact OAuth route paths.
- `api/src/platform/oauth/errors.ts` with exact `invalid_grant` anchor.
- `api/src/platform/ratelimit/headers.ts` with exact rate-limit header names.
- `sdk/` workspace package `@ship/sdk`, empty/minimal package shell.
- `sdk/src/index.ts` with inert `ShipClient`, `me()`, `authorizationCodeFlow()`, `deviceLogin()`, and `verifyWebhook(...)`.
- `sdk/src/errors.ts` with SDK error-kind anchor.
- `docs/architecture.md` path anchor only, because contents are not true until implementation exists.
- `integrations/README.md` with the external integration import boundary.
- `integrations/cli/README.md` with exact required CLI commands, not a complete future command inventory.

## Product And System Invariants

OAuth platform access is separate from legacy `api_tokens`. `/api/v1/*` validates OAuth access tokens from `oauth_access_tokens`; do not green-light public API behavior through legacy API-token auth.

OAuth app registration lives at session-authenticated `POST /api/platform/apps`. It is an internal/session app-management route, not a public `/api/v1` route and not an OAuth protocol endpoint.

`/api/v1/me` is auth-only route metadata with `requiredScope: null`. Do not invent `me:read`; the canonical scope list remains exact until a real public resource needs another scope.

Mounted PlugForge HTTP routes must be visible to OpenAPI route parity checks even while public OpenAPI product work is deferred. `scripts/check-openapi-routes.mjs` scans both `api/src/routes` and `api/src/platform`; do not let platform routes bypass the contract gate.

Public `/api/v1` rate limiting runs before public audit inserts. Do not re-order that middleware casually; unauthenticated 429 traffic must not force durable audit-log writes. Public request IDs are accepted from `x-request-id` only up to 128 chars.

OAuth access-token creation requires the user to be a current member of the app workspace. Do not add a cascading membership FK to `oauth_access_tokens`; validation must preserve the explicit `membership_revoked` denial reason after membership removal.

## Counterfeit Progress

Plugforge anchor files must say whether they are exact canon, intentionally partial, or an inert boundary. A narrow type such as `GET | POST` is acceptable only if the comment prevents future agents from treating it as a closed-world contract. No more fake-green placeholders: inert SDK/API methods throw or remain type-only until wired.

## Local Reality Checks

After anchor placement on 2026-06-02, targeted verification passed with `pnpm --filter @ship/api type-check` and `pnpm --filter @ship/sdk type-check`. Broad verification is not useful until the first real vertical slice exists.

After the first vertical slice on 2026-06-02, targeted PlugForge tests should run through `scripts/run-api-tests.sh -- src/platform/apps/routes.test.ts src/platform/api/v1/me.test.ts src/platform/api/v1/middleware.test.ts src/platform/oauth/tokens.test.ts`. Direct Vitest defaults to `ship_dev` unless `DATABASE_URL` is set and should refuse to truncate it.

## Leverage Points

The puzzle-frame phase is nearly done. Remaining high-confidence anchors should be rare; the next valuable work is a real vertical slice, not more shells. Best next slice: OAuth app registration plus a minimal authenticated `/api/v1/me` path behind real bearer validation.

## Sharp Edges

Do not add `docs/openapi.json` by hand; canon requires generated OpenAPI. Do not add `slow_down` as a canon literal from the main spec body alone; the body says slow-down responses, while exact wire spelling currently comes from appendix/supporting context.

`client_secret` hashes use Argon2id via `argon2`; OAuth access tokens are high-entropy random bearer tokens stored by SHA-256 hash for lookup. Keep that split unless a later threat model changes it deliberately.

## User And Team Preferences

## External Constraints

## Retired Beliefs
