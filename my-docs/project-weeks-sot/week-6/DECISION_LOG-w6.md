# Week 6 Decision Log

This document records Week 6 decisions that are not directly dictated by the PlugForge specs, so they can be referenced separately from canonical assignment requirements.

## 2026-06-02 — First Public API Vertical Slice

- OAuth app registration is a session-authenticated management route at `POST /api/platform/apps`, not a public `/api/v1` route and not an OAuth protocol endpoint.
- The first `/api/v1/me` slice validates real OAuth access tokens, but tests seed access tokens directly. The OAuth front-door slice must replace that fake issuance proof before public document APIs.
- `/api/v1/me` is explicitly auth-only in public route metadata with `requiredScope: null`. Do not add `me:read` unless the canonical scope registry changes deliberately.
- Legacy `api_tokens` are not accepted for `/api/v1/*`; public API auth uses `oauth_access_tokens` tied to an OAuth app, user, workspace, granted scopes, and public audit row.
- OAuth `client_secret` values are stored with Argon2id hashes. OAuth access tokens are random high-entropy bearer tokens stored as SHA-256 hashes for lookup.
- Mounted platform/public routes are registered in existing OpenAPI artifacts and checked by route parity, even though standalone public OpenAPI generation is deferred.
- Public API rate limiting precedes audit inserts to avoid unauthenticated durable-write amplification. Public request IDs are capped at 128 characters before storage.
- Access-token creation requires current workspace membership; later membership removal remains a validation-time `membership_revoked` denial rather than cascading token deletion.

## 2026-06-02 — OAuth Authorization Code + PKCE Front Door

- `/oauth/authorize` -> React consent -> `/oauth/token` is the first real PlugForge auth front door; public documents and SDK `authorizationCodeFlow()` remain deferred.
- OAuth provider state is service-owned in `api/src/platform/oauth/provider.ts`: authorize validation, grants, one-time code issuance/exchange, access tokens, refresh rotation, and refresh reuse invalidation. HTTP routes stay thin adapters.
- Authorization Code + PKCE requires `response_type=code`, exact `redirect_uri`, registered scopes, `code_challenge`, and `code_challenge_method=S256`; invalid verifier/reuse/expiry/mismatch returns `invalid_grant`.
- Refresh tokens ship from day one as one-time-use 30-day families. Reuse invalidates the whole family and revokes linked access tokens before returning `invalid_grant`.
- Consent UI lives at web `/oauth/consent`, while Vite proxies only `/oauth/authorize`, `/oauth/token`, and consent helper API routes. This keeps the browser consent surface in React without swallowing the protocol endpoints.
- Consent surfaces get clickjacking protection with `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` in API, Vite dev/preview, and Render static headers.

## 2026-06-02 — TTFE Developer Spine

- Device Grant is the CLI auth path. The drill may approve device codes through disposable local DB state, but the CLI still obtains tokens by polling the real `/oauth/token` Device Grant endpoint.
- Public OpenAPI is generated separately at `docs/openapi.json`; internal `api/openapi.json` must not carry `/api/v1` public paths.
- Public document create honors explicit titles only for OAuth public principals. Internal document create keeps `"Untitled"` semantics.
- `@ship/cli` keeps `@ship/sdk` as a peer dependency plus workspace devDependency so packed fresh installs use local SDK+CLI tarballs instead of resolving `@ship/sdk` from npm.
- `ship webhooks tail --once` is the actual receiver used by `pnpm drill ttfe`; it returns 200 only for verified signed events once a subscription secret is present.

## 2026-06-02 — Developer Ops Control Plane + Webhook Reliability

- Build operability before new integrations: Slack/GitLab/plugin runtime stay deferred until OAuth apps, webhook delivery, DLQ, replay, and public audit rows are inspectable and recoverable from workspace settings.
- Webhook delivery logic uses injected clock, deliverer, timeout, validation, and DB runner dependencies so retry/DLQ tests advance fake time over canon delays instead of polling with `setTimeout`.
- Retry semantics are fixed as: 2xx succeeds, 429/5xx/transport errors retry, non-429 4xx goes terminal DLQ, and the sixth failed attempt goes DLQ.
- OAuth app rotation uses `oauth_app_secrets` rows with per-secret IDs and statuses. The default rotation gives the previous active secret 24h grace; immediate revoke flips active/grace secrets to revoked before inserting the new active secret.
- Portal routes live under session-auth `/api/platform/apps`; public `/api/v1/webhooks` remains the external client contract. Portal subscription, delivery, and replay paths call the same webhook services instead of duplicating transport/replay logic.
- The Developer settings tab is intentionally dense ops UI, not a marketing developer portal: app selector/create, one-time secret panel, secret rotation/revoke, subscriptions, delivery log with DLQ filter/replay, and public audit rows.
- Fresh E2E databases use `api/src/db/schema.sql` and then mark migrations applied, so migration 056 also updates the schema snapshot.

## 2026-06-02 — Public Work API + Browser SDK Demo Foundation

- Public work APIs ship before Slack/GitLab/plugin runtime. `/api/v1/issues` and `/api/v1/sprints` now expose the document-backed issue/sprint model that later integrations must use instead of reaching around the platform.
- Public issue write scope is narrow: create is supported, and patch accepts only `state`, `assignee_id`, and `confirm_orphan_children`. No new issue data model or broad internal rewrite was introduced.
- Public sprint writes remain deferred. The shipped surface is sprint list/get plus `/api/v1/sprints/:id/issues`, which requires both `sprints:read` and `issues:read`.
- Public route metadata now stores `requiredScopes` as a list. `/me` and unauthenticated public OpenAPI use `[]`; `/api/v1/sprints/:id/issues` is the first route requiring multiple scopes.
- Nested sprint issues use a dedicated public query schema that omits `sprint_id`; the sprint comes only from the path parameter so OpenAPI, runtime validation, and SDK params cannot disagree.
- OAuth `issues:*` and `sprints:*` authorize document-backed `issue` and `sprint` resources through capability mapping, while existing broad `documents:*` behavior remains valid for legacy document-backed paths.
- Public issue and sprint read models must filter associated documents through the same workspace, archive/delete, visibility, and accountability predicates as primary public document reads. Private programs, weekly plans, retros, and accountability targets must not leak through relationship metadata or filters.
- Issue webhook events are emitted from `createIssueMutation` and `updateIssueMutation`, not from `/api/v1` handlers. This makes `issue.created`, `issue.assigned`, and `issue.status_changed` real domain events for future Slack/GitLab consumers.
- Issue webhook payloads stay intentionally small: IDs, title/display ID, state, assignee/actor IDs, and API/UI URLs. They do not include document body/content.
- Private issue rows now use selective webhook fanout. Subscriptions store creator/subject and granted-scope snapshots, and enqueue-time authorization creates delivery rows only for subjects that can currently read the event resource.
- `@ship/sdk` now has real `issues` and `sprints` clients with list/get/create/update/listIssues/iterate methods, backed by shared public types rather than generated runtime code.
- Web `/sdk-demo` stays the canonical browser demo route. It uses `ShipClient.authorizationCodeFlow()` plus `BrowserTokenStore`, lists documents and issues, and keeps document create only with explicit `documents:write` in the requested scope.
- `docs/architecture.md` stays out of this slice; the final architecture pass is deferred until after the platform/agent proof is complete.

## 2026-06-02 — Packed TTFE Install Boundary

- `pnpm drill ttfe` must prove the release artifact shape, not the workspace shape. The drill packs `@ship/shared`, `@ship/sdk`, and `@ship/cli` into tarballs, installs them into a fresh temp project, and then runs the CLI against the local API.
- `@ship/cli` keeps `@ship/sdk` as a peer dependency plus workspace devDependency so packed installs resolve the local SDK tarball instead of trying to fetch a private workspace dependency from npm.
- `ship webhooks tail --once` is the TTFE verification receiver. The drill succeeds only when it sees a verified `document.created` delivery from the real webhook path, not a mocked terminal transcript.

## 2026-06-02 — Agent-as-Citizen Read Context Foundation

- Webhook subscriptions are no longer workspace-level export controls. `document.*`, `issue.*`, and `sprint.*` events carry resource metadata and require matching read scopes at subscription creation; delivery fanout rechecks the stored subject's current resource readability at enqueue time.
- Replay and retry preserve the original delivery authorization decision by replaying existing delivery rows and their original `Idempotency-Key`, rather than rematching all subscribers.
- The first-party Ship Agent app is a per-workspace OAuth app with `system_key='ship-agent'`, `is_first_party=true`, and read-only scopes `documents:read`, `issues:read`, and `sprints:read`.
- Ship Agent tokens are delegated real `oauth_access_tokens` tied to the initiating user/session. Do not add Client Credentials unless explicitly re-decided; losing user-bound audit is the wrong default for this slice.
- `FLEETGRAPH_USE_PUBLIC_API=true` affects user-initiated FleetGraph chat/source reads only. Scheduled/no-user worker paths stay internal, and FleetGraph-owned findings/runs remain internal persistence.
- `/api/v1/fleetgraph/attention-contexts` is a narrow public source-read API for detector-critical issue/sprint context. It is read-only, requires `documents:read`, `issues:read`, and `sprints:read`, appears in OpenAPI/SDK parity, and intentionally exposes no FleetGraph finding/run write surface.
