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

## 2026-06-03 — Plugforge Architecture Deepening

- OAuth provider logic is split into flow modules with a stable `provider.ts` re-export facade; HTTP routes and tests keep importing from `provider.ts`.
- Webhook retry due-processing runs via an in-process 5s interval worker at API startup, not a queue-backed worker.
- Webhook domain mutations use `publishWebhookEventInTransaction` + `commitAndDispatchWebhooks`; bootstrap lives in `webhooks/bootstrap.ts`.
- Public OpenAPI is metadata-driven through `route-openapi-contracts.ts` keyed by registry `operationId`.
- FleetGraph attention contexts use an `AttentionContextReader` port; public routes use in-process reads, agent chat keeps HTTP loopback for audit proof.
- Issue public/webhook wire shapes share `issue-core.ts` core field extraction.

## 2026-06-03 — Public API Follow-Up Hardening

- Public `PATCH /api/v1/issues/:id` keeps HTTP `409` for parent close attempts with incomplete children, but canon wins: the public `ApiError.code` is `validation_failed` and the machine conflict reason lives in `details.reason: "incomplete_children"`.
- `conflict` is not a public `PUBLIC_API_ERROR_CODES` value; the exact public union is `unauthorized | expired_token | forbidden | not_found | validation_failed | rate_limited | server_error`.
- `pnpm drill ttfe` always resolves `ship_test_audit` via `resolve-database-url.sh`; only `TTFE_DATABASE_URL` overrides. Shell `DATABASE_URL` is ignored so fixtures and API cannot diverge.
- Plugforge CI regenerates `docs/openapi.json` and fails on drift; registry `operationId`s must match `route-openapi-contracts.ts` keys and the committed spec operation set.
- `exchangeAuthorizationCode` is exported from `provider.ts` via `refresh-rotation.ts` (not re-exported through `authorization-code.ts`).
- `resetWebhookBootstrapForTests()` clears event-bus subscribers and the dispatch handler before resetting the bootstrap flag.

## 2026-06-03 — Plugforge Architecture Deepening (execution)

- Public API route tests use `api/src/test/public-api-fixtures.ts` for OAuth workspace setup and cleanup.
- Ship Agent read scopes SSOT: `api/src/platform/oauth/ship-agent-scopes.ts` (`SHIP_AGENT_READ_SCOPES`); `tokens.ts` uses `isPublicApiScope` from `scopes/registry.ts`.
- Public read models: `document-read-model.ts`, `sprint-read-model.ts`; shared SQL helpers in `public-sql-helpers.ts` (renamed from `route-handlers.ts`).
- Wire-shape SSOT: `document-core.ts` for webhooks; `issue-core.ts` drives public issue core fields; `issue-wire-parity.test.ts` guards public vs webhook shapes.
- Public request parsing: `route-request.ts` keyed by registry `operationId`; path suffixes in `@ship/shared` `public-api-paths.ts`.
- Webhooks split: `webhook-subscriptions.ts`, `webhook-fanout.ts`, `webhook-delivery.ts`, `webhook-target-url.ts`, `webhook-replay.ts`, `webhook-service-deps.ts`, `mutation-publisher.ts`; `service.ts` remains the import facade.
- FleetGraph: `attention-context-factory.ts` chooses in-process vs HTTP loopback readers.
- SDK uses `@ship/shared` `PUBLIC_API_RELATIVE_PATHS`; CLI exposes full registry parity (`ship me`, documents, issues, sprints, fleetgraph, webhooks subscriptions/deliveries).

## 2026-06-03 — External Client Proof Pack

- The final bar is `pnpm plugforge:final`: MVP verify, TTFE, refresh-token theft drill, webhook replay/idempotency drill, SDK/OpenAPI parity, integration boundary proof, FleetGraph public audit proof, Slack/GitLab checks, and docs drift checks.

## 2026-06-04 — Reviewer API contract closure

- Expired OAuth bearer tokens on `/api/v1/*` return HTTP `401` with top-level `ApiError.code: "expired_token"` (not `unauthorized` + `details.reason`).
- `docs/openapi.json` is validated against the OpenAPI 3.1 JSON Schema via `@seriousme/openapi-schema-validator` in `api/src/platform/api/v1/public-openapi-schema.test.ts` and `scripts/lib/validate-public-openapi-document.mjs`.

## 2026-06-04 — External Developer Trust Boundary Closure

- Closed the scoped `OAUTH,API,PORTAL,SDK,CLI,AGENT` proof boundary by retiring the remaining missing/partial atoms, including discovered `W6-API-020`.
- Canon is explicit: public error codes exclude `conflict`; incomplete-child issue close keeps HTTP `409` with `code: validation_failed` and `details.reason: "incomplete_children"`.
- `pnpm plugforge:ledger:enforce -- --area OAUTH,API,PORTAL,SDK,CLI,AGENT --status missing,partial` is now the boundary definition-of-done gate and passes.
- Are-you-sure follow-up kept global `pnpm plugforge:ledger:enforce` failing as expected for unrelated Week 6 gaps, but fixed scoped proof hygiene: stale pending IDs removed, orphaned third-party OAuth apps backfilled/revoked in migration 059, force-rotation now invalidates unconsumed auth codes and device grants, pre-auth 429 audit uses production router order, portal secret storage is checked, consent CSRF failure is tested, and SDK/OpenAPI parity has a compile-time sentinel.
- Reference integrations are SDK-only packages under `integrations/slack` and `integrations/gitlab`; the boundary checker blocks `api/src`, `web/src`, `shared`, `@ship/shared`, aliases, `require()`, and dynamic internal imports.
- Public GitLab linking uses the smallest public issue seam: `POST /api/v1/issues/:id/external-links` and `client.issues.upsertExternalLink()`. Links live in issue document `properties.external_links`; no schema migration.
- External links are idempotent by `provider + external_id` and expose only public issue metadata: provider, external id, kind, URL, title, optional status, and server timestamps.
- Refresh-token theft proof now exercises `/oauth/token`: rotate once, reuse the stolen old token, invalidate the family, revoke issued access tokens, and assert `/api/v1/me` rejects them.
- Replay proof now includes a signed SDK-verifying subscriber that processes the first delivery, dedupes replay, and observes the same `Idempotency-Key`.
- FleetGraph public-source read proof now mints a delegated `ship-agent` OAuth token, calls through `@ship/sdk` and `/api/v1`, and asserts `public_api_audit_logs` rows.

## 2026-06-04 — Webhook + Metrics Proof Closure

- Metrics closure means platform-path metrics over OAuth, CLI, SDK, public API, and webhooks; it does not claim final Slack/GitLab/reference-integration acceptance.
- Webhook event contracts are specific Zod schemas for all eight event types; `document.updated`, `document.deleted`, `sprint.started`, and `sprint.completed` are no longer generic payload records.
- Sprint lifecycle events publish from document mutation services when sprint status moves to `active` or `completed`; no public sprint write route was added for this proof.
- Metric probes now fail closed: TTFE canonical stages, TTFE flake/P95, OAuth P95, webhook P95, SDK size, verifier speed, and baseline comparator all emit gated JSON.
- `pnpm plugforge:metrics` is the aggregate metric gate. Local runs refresh checked-in evidence under `my-docs/evidence/plugforge-metrics/`; CI writes and uploads a clean per-run `my-docs/evidence/plugforge-metrics-ci/**` directory so stale committed JSON cannot masquerade as current proof.
- The scoped closure signal is `pnpm plugforge:ledger:enforce -- --area WEBHOOK,METRIC --status missing,partial`; `W6-INT-*` remains pending for Reference Integration Acceptance Closure.

## 2026-06-04 — Reference Integration Acceptance Closure

- `pnpm plugforge:integrations` is the INT acceptance harness. It proves Slack, GitLab, Browser SDK demo, existing integration boundary checks, and the final six-flow matrix with current-run JSON under `my-docs/evidence/plugforge-integrations/`.
- Slack acceptance now proves Slack OAuth callback, two SDK-created Ship webhook subscriptions targeting one local receiver with separate secrets, signed `document.created` and `issue.assigned` delivery, two deterministic Slack posts, and replay dedupe.
- GitLab acceptance stays on the public issue seam: deterministic MR webhook -> `client.issues.upsertExternalLink()` -> public `/api/v1/issues/:id` readback. No API internals and no schema change.
- Browser SDK acceptance is a real Playwright flow through `/sdk-demo`: Authorization Code + PKCE, consent, callback, token exchange, and authenticated document listing through `@ship/sdk`.
- The final INT closure signal is `pnpm plugforge:ledger:enforce -- --area INT --status missing,partial`; global enforcement remains intentionally out of scope until unrelated gaps close.

## 2026-06-06 — Reviewer Integrations Proof Surface

- Week 6 reviewer materials use one generated HTML packet (`pnpm plugforge:render-reviewer`) dual-written to `web/public/` and `my-docs/project-weeks-sot/week-6/`. Evidence JSON under `my-docs/evidence/plugforge-integrations/live/` and `ttfe-timing.json` is the source of truth for the integrations section; hand-editing generated HTML is forbidden.
- Path A in the packet covers MVP gates 1–8 on the deployed site. Path B covers the six integration flows, TTFE timing, Slack/GitLab deep links, grader curl for `external_links`, and a static event-boundary diagram.
- GitLab proof is surfaced via live MR on `labs.gauntletai.com`, public API readback, and `external_links` chips in the issue properties sidebar.
- Always-on reference integrations deploy as separate Render web services (`ship-shape-slack-integration`, `ship-shape-gitlab-integration`) with secrets documented in `INTEGRATION_HOSTING_RUNBOOK.md`. Reviewer integration proof lives only in `plugforge-reviewer-packet.html` and `web/public/plugforge-evidence/` — not on the Developer tab.

## 2026-06-04 — Final Submission Evidence Decisions

- Final deployment host is Render for this submission. Public URL names are `https://ship-shape-web.onrender.com/` for web and `https://ship-shape-api.onrender.com/` for API; live OpenAPI is `https://ship-shape-api.onrender.com/api/v1/openapi.json`.
- Grader credential delivery uses public README credentials for the Ship demo session and private submission-channel delivery or portal regeneration for any raw OAuth `client_secret`. The public repository can safely include `client_id`, redirect URI, and scopes, but not a reusable raw secret.
- Reviewer read-only OAuth app shape is `documents:read`, `issues:read`, and `sprints:read`. Reviewers can create/regenerate it from Workspace Settings -> Developer; confidential one-time secrets are not durable public evidence.
- API versioning beyond `/api/v1` remains explicitly deferred. The Week 6 contract is additive within `/api/v1`; breaking changes require a future `/api/v2` decision, not final-submission work.
- Webhook delivery-log retention for final evidence is 30 days with a target cap of 10,000 delivery rows per app. A production archival/pruning policy can be decided after the submission.
- `pnpm plugforge:submission` is the final submission evidence gate. `--allow-manual-pending` is only for pre-handoff checks while the grader OAuth private secret delivery note is still pending.
- `W6-GLOBAL-001` is proven only when strict `pnpm plugforge:submission` passes without `--allow-manual-pending` and global `pnpm plugforge:ledger:enforce` passes. Demo video, presearch upload, saved AI conversation, and social screenshot atoms remain `non_scope` when owner-excluded.
