# Plugforge — Pre-Search

Complete this before writing code. Save your AI conversation as a reference document and attach it to your final submission.

**Reference artifact (AI conversation):** _not attached yet_

---

## Phase 1: Define Your Constraints

### 1.1 — Scale & Load Expectations

- What is the realistic API request rate against your deployed instance during the demo window, and how does that map to webhook fanout (one `document.created` can produce N deliveries given N matching subscriptions)?

  **Spec basis:** PRESEARCH asks for realistic demo traffic and webhook fanout. Performance target says webhook first-attempt P95 must stay under 2s.

  **Answer:** Assume normal demo load of 5 concurrent users, 2 requests/sec sustained, and 10 requests/sec short bursts. Run a load probe above that: 10 concurrent API clients, 5 concurrent device-flow polling sessions, 25 document creates, and 10 matching subscriptions per `document.created` event. That creates 250 webhook deliveries in a short window. Passing target: first-attempt webhook delivery P95 under 2s and no dropped deliveries.

- How many OAuth apps and subscriptions will you seed for the grader? At what fanout does your in-memory deliverer start dropping below the < 2 s P95 target?

  **Spec basis:** PRESEARCH asks how many grader apps/subscriptions we seed and what fanout keeps the in-memory deliverer under 2s P95.

  **Answer:** Seed three grader OAuth apps: CLI/TTFE, browser demo, and integrations. Seed normal demo subscriptions for Slack notification flows: `document.created` and `issue.assigned`. The GitLab integration is seeded through its GitLab app/webhook setup, not by pretending it is a Slack-style notification subscriber. Do not pre-seed the TTFE subscription; the TTFE drill must create its own `document.created` subscription through the SDK. Capacity target: the in-memory deliverer must handle 10 matching subscriptions for one event with first-attempt delivery P95 under 2s and no dropped deliveries. Actual break point is unknown until measured; measure it with a fanout probe at 10, 25, and 50 subscriptions/event and record the result in the final write-up.

- How many concurrent CLI sessions will run device flow during a demo, and does your polling-rate response (`slow_down` semantics) handle them correctly?

  **Spec basis:** Device Authorization Grant requires the client to poll `/oauth/token` until authorized and honor `slow_down` responses.

  **Answer:** Support 5 concurrent CLI device-flow sessions during the demo. Each session gets its own `device_code`/`user_code` pair and polling interval. If a client polls faster than allowed, `/oauth/token` returns `slow_down` and increases that session's polling interval without affecting other sessions. Test coverage runs 5 concurrent polling sessions and verifies each can complete independently.

- What is your delivery-log row growth rate at the demo's expected event rate, and how long is the log retained?

  **Spec basis:** Delivery log records every webhook attempt and is queryable per app. PRESEARCH asks for row growth and retention.

  **Answer:** Expected demo growth is small: the load probe creates 250 delivery rows for first attempts, plus retry rows when failure tests run. Normal demo traffic should stay under a few thousand rows. Retain delivery logs for 30 days, capped per app by a configurable maximum. For Week 6, default cap is 10,000 delivery rows per app; older rows are pruned after the retention window or when the cap is exceeded.

### 1.2 — Budget & Cost Ceilings

- What is your weekly LLM budget for the Epic 7 agent rewire? The rewire shouldn't change token volume — how do you verify that with a before/after measurement?

  **Spec basis:** AI Cost Analysis says the platform itself does zero AI work; LLM is invoked only on user-initiated agent turns. Epic 7 rewire should not change token volume, and spend must be tracked.

  **Answer:** Set a $25 Week 6 LLM runtime/eval budget for the agent rewire, excluding development-assistant usage. Measure before/after using the same FleetGraph scenario set with the feature flag off and on. Compare prompt tokens, completion tokens, model name, request count, and total cost. Passing condition: public-API rewire does not add extra LLM calls and token volume stays within measurement noise for the same agent turns.

- What is your daily ceiling on CI minutes given that every PR runs the TTFE drill plus the OAuth Playwright flow plus the full regression suite?

  **Spec basis:** Every PR runs TTFE drill, OAuth Playwright flow, and the full regression suite. PRESEARCH asks for a daily CI-minute ceiling.

  **Answer:** Set the normal CI ceiling at 60 minutes/day during active build work, with a 90-minute emergency ceiling for Saturday/Sunday final verification. Keep PR lanes targeted: unit/contract tests on every slice, full regression before merge, TTFE after SDK/webhook path exists, and `pnpm test:all` before MVP/final gates. If two runs fail with the same infrastructure error, stop rerunning and fix the root cause.

- What is the SDK install footprint budget you're committing to — production deps only, gzipped — and how will you enforce it (bundle analyzer, CI size check)?

  **Spec basis:** Signature Challenge performance targets set SDK install size at <250 KB minified + gzipped for production deps only.

  **Answer:** Commit to <250 KB minified + gzipped for SDK production dependencies. Keep the SDK dependency-light: use platform `fetch` and Web Crypto where possible, avoid heavy OAuth/OpenAPI runtime clients, and keep CLI-only dependencies out of the SDK package. Enforce with a CI size check that packs the SDK, installs production dependencies only, bundles the public entrypoint, gzips it, and fails over 250 KB.

- If your webhook deliverer's queue runs away (a subscriber that 5xx's forever multiplied by every event), what is your runaway-cost ceiling and what mechanism enforces it?

  **Spec basis:** Webhook retry schedule retries transient failures and sends deliveries to DLQ after 6 failed attempts. PRESEARCH asks what prevents runaway queue cost.

  **Answer:** Runaway ceiling: one event can produce at most 6 attempts per matching subscription before DLQ. Per subscription, cap active retry backlog at 100 pending deliveries; per app, cap active retry backlog at 1,000 pending deliveries. When a subscription exceeds the cap or repeatedly sends deliveries to DLQ, pause it and require manual replay/reactivation from the portal. This bounds storage, outbound requests, and retry work even if a subscriber 5xxs forever.

### 1.3 — Timeline & Scope Reality

- Which of E1–E7 are must-ship for you given your OAuth experience? Which reference integration is your must-ship — CLI (recommended), Slack (more visual), or something else?

  **Answer:** Final submission target: complete the required platform surfaces and selected integration flows. The Tuesday MVP card remains the first gate:

  - OAuth app registration endpoint working: admin can create an app, receive a `client_id`, and a `client_secret` hashed in the database; raw secret shown exactly once on creation.
  - Authorization Code + PKCE flow completes end-to-end via a Playwright test: `/oauth/authorize` → consent → `/oauth/token` → usable access token.
  - Bearer token middleware validates tokens on every `/api/v1/*` route; invalid, missing, and expired tokens return 401, with expired tokens using a distinct error code.
  - At least one resource, documents, implements GET list, GET by id, and POST. Each route declares its required scope via a `require(scope)` middleware factory.
  - Consistent `ApiError` shape, `{code, message, details?, request_id}`, is returned on every public failure and asserted by a fitness test over all `/api/v1` routes.
  - `ScopeRegistry` has scopes-as-data; insufficient scope returns 403 with the missing scope named explicitly in the error body.
  - OpenAPI 3.1 spec is served at `/api/v1/openapi.json`, generated from route metadata, never hand-written, and validates against the OpenAPI schema in a unit test.
  - SDK skeleton exists in a pnpm workspace package; `new ShipClient({ token }).me()` against a running server returns the typed authenticated user.
  - Existing Playwright regression suite passes on main; P95 latency, bundle size, and per-route query counts stay within +10% of the Part 1 baseline.
  - Deployed and publicly accessible: deployed Ship, published OpenAPI spec URL, and at least one OAuth app pre-registered with read-only scopes for graders.

  Final submission adds the TTFE drill, signed webhooks with retry/DLQ/replay, minimal developer portal, SDK/CLI proof, and Agent-as-Citizen proof through public API audit rows. For the spec's "Implement at Least 5 of the Following Integrations / Flows" menu, target the first six: CLI device-flow tool, Slack integration, Browser SDK demo, GitLab integration, refresh-token rotation drill, and Idempotency-Key end-to-end. The in-process plugin runtime is stretch only.

  Must-ship reference integration: CLI. The CLI is the headline demo because it proves Device Grant, SDK ergonomics, document creation, webhook subscription, signature verification, and TTFE in one loop.

- How many hours per day will you actually spend on this — be honest. What does your day-by-day plan look like against that number?

  **Answer:** Work mode: continuous agent-assisted development from now through final submission. Treat Tuesday, June 2, 2026 as the MVP gate; target a finished product by Saturday, June 6, 2026 at noon CT; reserve Saturday afternoon through Sunday, June 7, 2026 at noon CT for hardening, documentation, demo capture, deployment verification, and final packaging.

- What is your kill criterion for the developer portal? If E5 is taking too long, is read-only delivery-log-viewer the minimum viable portal?

  **Answer:** Minimum final portal: OAuth app list/create, shown-once `client_secret`, webhook subscription list/create, delivery log, DLQ visibility, and replay for failed deliveries. Cut charts, advanced filters, payload viewers, integration-specific setup screens, and polished secret-rotation UX before cutting replay or delivery-log visibility.

### 1.4 — Security & Data Sensitivity

- Where do `client_secret` values live at rest — hashed with what algorithm, salted how, recoverable via what process if a user loses theirs?

  **Answer:** Deliberate decision: `client_secret` values are generated once, displayed once, and stored only as salted Argon2id hashes. They are not recoverable. If a user loses a secret, they rotate it; rotation displays the new raw secret once and stores only the new hash. Secret verification uses constant-time comparison against the stored hash.

- How long are access tokens valid, and what is your refresh-token rotation policy? Will you implement stolen-refresh-token detection (reuse invalidates the family)?

  **Spec basis:** `Refresh Tokens` requirement: "One-time-use refresh tokens with rotation. Stolen-refresh-token detection: reuse invalidates the family." Integration/flow menu also includes: "Refresh-token rotation drill — proves a stolen refresh token, when reused, invalidates the entire family."

  **Answer:** Deliberate decision: access tokens are valid for 15 minutes. Refresh tokens are one-time-use and rotated on every refresh. Each refresh token belongs to a token family with a 30-day absolute expiration from authorization. Reuse of an already-used refresh token invalidates the entire family and requires reauthorization. Refresh tokens are stored hashed at rest, never raw.

- What goes in webhook payloads vs. what gets fetched on demand — do you ship document content in `document.created`, or just the ID? Defend the tradeoff between subscriber convenience and exposure surface.

  **Spec basis:** Webhook events include `document.created` and `issue.assigned`; webhook subscriptions are per-app/per-event-type with signed delivery; the Slack integration option says it receives signed webhooks and posts `document.created` and `issue.assigned` to channels via Slack OAuth. The spec does not require slash commands, two-way sync, full document bodies in webhooks, or Slack-side document editing.

  **Answer:** Webhook payloads include event metadata, resource identifiers, small display fields, and fetch URLs; they do not include full document content. For `document.created`, include event id/type, timestamp, actor id/name when available, document id, document title, document type, and API/UI URLs. For `issue.assigned`, include event id/type, timestamp, actor id/name, issue id/title, assignee id/name, and API/UI URLs. Subscribers that need full content fetch it through the public API using their granted scopes. This keeps Slack and other notification integrations useful while limiting document-content exposure in queues, logs, retries, DLQs, and third-party receivers.

  Slack interpretation: Slack is a channel notification integration. A user connects Slack, chooses a channel, subscribes to `document.created` and `issue.assigned`, and receives readable messages with title, actor/assignee, and an "Open in Ship" link. Slack is not a Ship control surface for final submission.

- How do you protect the developer portal's secret display (shown-once UX) from accidental leakage via screenshot, log line, or browser back-button?

  **Spec basis:** OAuth app model requires raw secrets shown once on creation and rotation, never recoverable thereafter.

  **Answer:** Show raw `client_secret` only in the create/rotate success response and only in immediate in-memory UI state for that action. Do not persist it in localStorage, sessionStorage, URL params, logs, analytics, route state, server-rendered HTML, or error payloads. The UI shows a one-time panel with a manual copy button, requires explicit dismissal, and replaces the value with an unrecoverable placeholder after navigation, refresh, or back-button restore. Server logs redact fields named `client_secret`, `raw_secret`, `signing_secret`, `access_token`, and `refresh_token`.

### 1.5 — Team Skill Inventory

- Have you implemented OAuth 2.0 end-to-end before, or only consumed it? If only consumed, which morning do you spend on RFC 6749 + 7636 + 8628 before starting E1?

  **Spec basis:** PRESEARCH asks whether OAuth has been implemented end-to-end before and when to review RFC 6749, 7636, and 8628 if not.

  **Answer:** Treat OAuth implementation experience as limited. Before building E1, spend a focused 60-90 minute review on RFC 6749 Authorization Code, RFC 7636 PKCE, and RFC 8628 Device Authorization Grant. Output is a checklist for required parameters, error codes, token exchange rules, polling interval/`slow_down` behavior, and security checks used by the implementation and tests.

- How comfortable are you with Zod and zod-to-openapi (or equivalent)? Where does your fallback live if generation breaks late in the week?

  **Spec basis:** OpenAPI must be generated from route metadata, never hand-written. Stack guidance suggests Zod schemas to OpenAPI 3.1 via `zod-to-openapi` or `@asteasolutions/zod-to-openapi`.

  **Answer:** Use Zod for request/response schemas and `@asteasolutions/zod-to-openapi` for generation. Comfort level: enough to use it, but generation risk is real. Fallback is not a hand-written OpenAPI spec. Fallback is a minimal local route-metadata registry that maps method/path/scope/request schema/response schema to OpenAPI output for the required `/api/v1` routes. The source of truth remains route-adjacent schemas and metadata.

- Have you designed an SDK before? Have you been on the consuming side of a bad one? Which of those experiences guides your API choices more this week?

  **Spec basis:** SDK requirements include typed resource clients, auth helpers, async-iterator pagination, webhook verifier, and typed errors.

  **Answer:** No prior SDK design experience. Treat SDK design as a risk area. Keep the SDK surface small, typed, and driven by the required flows. The CLI is the SDK's first real consumer; if CLI usage feels awkward or repetitive, fix the SDK rather than hiding the problem in CLI glue code. Primary design checks: one clear auth setup path, predictable resource clients, structured errors, simple pagination, and examples that compile.

---

## Phase 2: Architecture Discovery

### 2.1 — OAuth Flow Choices

- Will you support refresh tokens from day one, or start with long-lived access tokens and add refresh later? What is the migration cost if you wait?

  **Spec basis:** Core requirements call for one-time-use refresh tokens with rotation and stolen-refresh-token detection. The selected final flows include the refresh-token rotation drill.

  **Answer:** Support refresh tokens from day one. Do not use long-lived access tokens as a placeholder. Waiting would require changing token persistence, SDK auth helpers, CLI token storage, browser demo behavior, and tests after consumers already depend on the first shape. MVP can use the smallest implementation that supports the Auth Code + PKCE path, but final must include one-time-use refresh tokens, hashed-at-rest storage, token-family tracking, and a reuse-detection drill that invalidates the family.

- How will you handle scope upgrades — does a user who originally granted `documents:read` need to re-consent to grant `documents:write`, or do you support incremental consent?

  **Spec basis:** OAuth uses granular scopes, consent, and `ScopeRegistry`; insufficient scope errors must name the missing scope.

  **Answer:** Deliberate decision: scope upgrades require re-consent. If an app originally has `documents:read` and later requests `documents:write`, the user goes through authorization again with the full requested scope set. The consent screen highlights newly requested scopes and shows previously granted scopes as already granted. Granted scopes are stored per authorization grant. No silent upgrades.

- Where does the consent screen live — a route inside Ship's UI, a dedicated endpoint with its own minimal layout, or something else? What protects it from clickjacking?

  **Spec basis:** Authorization Code + PKCE flow is `/oauth/authorize` → consent → `/oauth/token`. Developer portal lives inside the existing Ship UI.

  **Answer:** Deliberate decision: the consent screen lives in Ship's web UI on a dedicated OAuth consent route, reached only from `/oauth/authorize` after validating `client_id`, `redirect_uri`, `response_type`, `scope`, `state`, and PKCE challenge. It uses the existing authenticated Ship session for the resource owner and a minimal OAuth-specific layout. Clickjacking protection: `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` on authorize/consent routes. Consent POSTs validate CSRF through the existing session CSRF mechanism.

- For the Device Authorization Grant: what is your verification URL UX — do users paste a code into a form, or do you embed the code in a URL they click? RFC 8628 allows both.

  **Spec basis:** Device Authorization Grant requires `/oauth/device/code`, `/oauth/device/verify`, client polling at `/oauth/token`, and honored `slow_down` responses.

  **Answer:** Deliberate decision: support both. The CLI prints a short verification URL plus `user_code`, and also prints a complete URL containing the code for convenience: "Visit `/oauth/device` and enter `ABCD-EFGH`" plus "Or open `/oauth/device?user_code=ABCD-EFGH`." The verification page pre-fills the code when present but still requires the logged-in user to confirm. Polling clients must honor the server-provided interval and `slow_down` responses.

### 2.2 — Public API Shape

- Will your error shape match exactly across all routes (one fitness test asserts it), or will some routes carry richer `details`? If both, where is the line and is it documented?

  **Spec basis:** MVP hard gate requires consistent `ApiError` shape `{code, message, details?, request_id}` on every public failure, asserted by a fitness test over all `/api/v1` routes.

  **Answer:** All public API failures use the same top-level envelope: `{ code, message, details?, request_id }`. Routes may include richer machine-readable data only inside `details`; the top-level shape never changes. Validation errors put field errors in `details.fields`; auth/scope errors put `missing_scope` or token failure context in `details`; rate-limit errors put retry and limit metadata in `details`. The fitness test asserts the envelope on every `/api/v1` failure path.

- How will you handle field-level filtering or sparse fieldsets — query parameters (`?fields=...`), header (`Prefer:`), or skip it for the week? Defend the call.

  **Spec basis:** PRESEARCH requires choosing a sparse-fieldset strategy: query parameters, `Prefer` header, or skipping it for the week.

  **Answer:** Skip sparse fieldsets for Week 6. Public responses use stable, documented resource shapes. This keeps OpenAPI generation, SDK typing, parity tests, and docs simple while the contract is young. If response size becomes a real problem later, add `?fields=...` as an additive `/api/v1` feature. Do not use the `Prefer` header for this because field selection should be visible in URLs, examples, logs, and SDK method options.

- What is your versioning policy past `/api/v1/` — additive only, breaking changes via `/v2/`, or deprecation headers with sunset dates? Which is in the docs by Sunday?

  **Spec basis:** The platform requires a versioned public REST API at `/api/v1/`.

  **Answer:** `/api/v1` is additive-only after publication. Add fields, endpoints, scopes, and enum values only when they do not break existing clients. Breaking changes require `/api/v2`. Deprecations in v1 use documentation plus `Deprecation` and `Sunset` headers, but deprecated v1 behavior stays available through the final submission/demo window. Docs by Sunday state: no breaking changes inside v1.

- Will every list endpoint return cursor pagination, or will small static lists (like `/api/v1/scopes`) skip it? Where do you draw the line and how does the fitness test know?

  **Spec basis:** Public API requirements say list responses always return `{ data, next_cursor }`, and the route fitness test checks list endpoints for cursor pagination.

  **Answer:** Every `/api/v1` endpoint that returns a collection uses the same pagination envelope: `{ data, next_cursor }`. Dynamic collections use opaque base64 cursors. Small registry data, such as scopes, should either use the same envelope or be exposed as a non-collection metadata object. Rule: if it is documented as a list endpoint, it paginates.

### 2.3 — Webhook Reliability

- What exactly is signed — the raw request body, the body plus the timestamp, the body plus a versioned scheme tag? Why?

  **Spec basis:** Webhook signing uses `Ship-Signature: t=<unix-seconds>,v1=<hex-hmac>`. Timestamp prevents replay; the SDK rejects signatures older than 5 minutes by default.

  **Answer:** Sign what was actually sent plus the timestamp. Concretely: `v1 = HMAC_SHA256(secret, "${timestamp}.${rawBody}")`, where `rawBody` is the exact raw request body before JSON parsing. The header is `Ship-Signature: t=<unix-seconds>,v1=<hex-hmac>`. Verifiers reject missing `t`/`v1`, malformed timestamps, signatures older than 5 minutes, and HMAC mismatches using constant-time comparison.

- What is your retry schedule (the brief suggests 1s, 4s, 16s, 1m, 5m, 30m) and how is it tested without sleeping in test code? Deterministic clock injection — where does it live?

  **Spec basis:** Webhook retry schedule is `1s, 4s, 16s, 1m, 5m, 30m`; critical guidance says retry tests use deterministic clock injection, never real `setTimeout` waits.

  **Answer:** Use the spec retry schedule: 1s, 4s, 16s, 1m, 5m, 30m, with small jitter in production and deterministic jitter disabled in tests. The deliverer depends on an injected clock/scheduler interface. Production uses real scheduling. Tests advance fake time and assert the next attempt time after each failure.

- How does your deliverer know a subscriber is permanently broken vs transiently? Is 4xx always permanent, 5xx always transient, or is the answer more nuanced (e.g., 410 Gone permanent, 429 transient)?

  **Spec basis:** Webhook requirements say subscribers returning 5xx or timing out are retried; user decision makes `429 Too Many Requests` the deliberate, only retryable 4xx because it is a backpressure signal.

  **Answer:** Default rule: 2xx succeeds; 5xx and network timeouts are transient and retry; non-429 4xx is permanent and goes to DLQ without retry. Deliberate exception: 429 is transient because it means retry later, and `Retry-After` is honored when present. 410 Gone is permanent and deactivates the subscription. After six failed transient attempts, delivery goes to DLQ.

- How does `Idempotency-Key` flow from your replay endpoint through to subscribers, and what is the contract you document for subscriber dedupe?

  **Spec basis:** Replay re-emits a logged event; `Idempotency-Key` is passed through so subscribers can dedupe. Selected final flow includes the Idempotency-Key replay drill.

  **Answer:** Every original event delivery gets a stable `Idempotency-Key`, derived from the event id. Retries reuse the same key. Manual replay also reuses the original key and adds replay metadata separately, such as `Ship-Replay: true` and `Ship-Original-Delivery-Id`. Subscriber contract: use `Idempotency-Key` to dedupe side effects; do not treat replay as a new event. Same event, same key, including replay.

### 2.4 — SDK Design

- Will your SDK methods be generated from the OpenAPI spec or hand-written and parity-tested against it? Defend the tradeoff between type quality and drift risk.

  **Spec basis:** Stack guidance says Zod schemas generate OpenAPI; SDK is hand-written in TypeScript for quality and fitness-tested against the spec for parity. Core requirements say SDK method signatures match OpenAPI and drift fails CI.

  **Answer:** Hand-write the SDK for TypeScript quality and developer ergonomics, then parity-test it against the generated OpenAPI spec. OpenAPI remains the contract source for routes and docs; the SDK remains a curated client surface. CI fails when an OpenAPI operation lacks a matching SDK method or when SDK request/response types drift from route schemas. Generate the spec, not the SDK; verify the SDK matches the generated contract.

- What is your error model in the SDK — typed discriminated union (recommended), throw-and-catch with structured errors, or Result-style return? Which feels most TypeScript-native today?

  **Spec basis:** SDK requirements call for typed error union: `{ kind: 'auth' | 'rate_limit' | 'not_found' | 'validation' | 'server', ... }`.

  **Answer:** Deliberate decision: SDK methods throw a `ShipError` whose data is a typed discriminated union. Each error has a stable `kind`, so consumer code can branch cleanly based on the failure type: `auth`, `rate_limit`, `not_found`, `validation`, `server`, or `network`. The SDK preserves the API `request_id` and `details` payload. Do not use Result-style returns; TypeScript SDK users expect failed HTTP calls to throw, but the thrown error should be structured and typed.

- How does the SDK handle pagination — return raw cursors and let consumers loop, return async iterators only, or both? Async-iterators-only is cleanest; both is more flexible.

  **Spec basis:** Public API requirements define cursor pagination: opaque base64 cursors over `{ id, timestamp }`; list responses always return `{ data, next_cursor }`; cursors are stable across reordering operations. SDK requirements call for async-iterator pagination: `for await (const doc of client.documents.iterate())` walks pages transparently.

  **Answer:** Deliberate decision: expose both. Required SDK path: `iterate()` hides cursors and yields items across pages. Page-level access is also available for UI-style pagination, but examples and CLI commands use `iterate()` so normal consumer code does not handle cursors. The page method returns `{ data, next_cursor }` to match the public API contract. Portal UI presents this as "Load more," not numbered page links.

- Where does `ITokenStore`'s contract live — does it persist refresh tokens too, or only access tokens? What is the threading model for refresh under concurrent calls?

  **Spec basis:** SDK auth helpers require a pluggable `ITokenStore` with in-memory, file, and browser localStorage implementations. Refresh tokens are one-time-use, so concurrent refresh attempts must not race.

  **Answer:** Deliberate decision: `ITokenStore` lives in the SDK package and stores both access-token and refresh-token state: access token, refresh token, expiration time, granted scopes, app/client id, and user id when known. Implementations: memory for tests, file store for CLI, browser storage for the browser demo. The SDK serializes refresh with a per-client refresh lock: if multiple requests see an expired access token, the first performs refresh and the others wait for the new token. This matters because refresh tokens are one-time-use; two simultaneous refreshes with the same token would look like token theft and invalidate the family.

### 2.5 — Developer Portal & Self-Service

- Will the portal reuse the public API like any other client, or will it have a privileged internal endpoint for admin operations? Eating the dog food is more rigorous; an internal escape hatch is more pragmatic.

  **Spec basis:** Developer portal manages app registration, client secrets, webhook subscriptions, delivery logs, and replay. Platform goal is API-as-contract discipline, but app creation happens before an OAuth client can authenticate.

  **Answer:** Deliberate bootstrap exception: reuse existing Ship session auth, layout, forms, and service patterns for OAuth app creation and secret rotation, because those actions create the credentials needed to use the public API. For webhook subscriptions, delivery logs, replay, and audit views, use the same public API/service path used by external clients. If existing internal services already perform the underlying document/webhook/audit work, call those services from both public and portal routes rather than duplicating logic.

- How is `client_secret` rotation modeled — is the old secret immediately invalidated, or does it work alongside the new one for a grace period? What does Stripe do, and why?

  **Spec basis:** OAuth app model says raw secret is shown once on creation and rotation, never recoverable. PRESEARCH asks whether rotation immediately invalidates the old secret or allows a grace period.

  **Answer:** Rotation creates a new secret and keeps the previous secret valid for a short grace period, default 24 hours, unless the user chooses "rotate and revoke immediately." The portal shows secret records by label/status only, never raw values after creation. This prevents accidental outages for deployed integrations while still giving an immediate revocation path for suspected leaks. After the grace period, the old secret is disabled automatically.

- How will the delivery-log view scale visually when an app has thousands of deliveries — server-side pagination, virtualized list, time-bucket filters? Which is build-cheap and which is rebuild-cheap later?

  **Spec basis:** Delivery log is queryable per app; developer portal must browse delivery logs and replay failed deliveries. Public API list responses use cursor pagination.

  **Answer:** Delivery log uses server-side cursor pagination from day one, filtered by app and optionally status/time range. The portal shows newest deliveries first with a "Load more" control. Default filters: app, status, event type, and time window. Do not build virtualization first; server-side pagination is cheaper now and remains the right backend shape later. Add virtualized rendering only if one loaded page becomes visually heavy.

- Will the portal show webhook payloads in full, redacted, or behind a click-to-reveal? Defend the choice against the leakage concerns from 1.4.

  **Spec basis:** Webhook deliveries record response metadata and `response_excerpt`. Payloads exclude full document content, but can still include titles, names, ids, URLs, and integration data.

  **Answer:** Portal shows delivery metadata by default: event type, status, attempt count, timestamp, target URL host, latency, and response excerpt. Request payload is hidden behind click-to-reveal and redacted before display for secrets, tokens, signatures, and authorization headers. Do not show full payloads in table rows. This keeps the log useful for debugging while reducing accidental leakage in screenshots and browser history.

### 2.6 — Agent-as-Citizen Rewire

- Which OAuth flow does the agent use — Authorization Code, Device Grant, or Client Credentials (RFC 6749 §4.4) for first-party machine-to-machine? Defend the choice.

  **Spec basis:** Plugforge requires the Part 2 agent to authenticate as a first-party OAuth app and consume the public API through the SDK. PRESEARCH explicitly asks whether the agent should use Authorization Code, Device Grant, or Client Credentials for first-party machine-to-machine. FleetGraph's existing boundary allows the agent to read permitted Ship state and write FleetGraph-owned findings/runs/notifications, while Ship source-record mutations and external contact remain human-gated.

  **Answer:** Use Client Credentials for the first-party FleetGraph agent app. It is deterministic for production and CI, does not require browser consent or device-code approval, and still sends the agent through the SDK, public API middleware, scopes, rate limits, and audit logging. Scope grants follow the existing FleetGraph boundary: read scopes for needed Ship source data and write scope only for FleetGraph-owned state. Do not grant broad Ship mutation scopes such as `documents:write`, `issues:write`, or `sprints:write` for final submission unless a human-approved action flow explicitly requires them.

- How is the agent's app seeded — at boot, via a migration, manually in dev? What guarantees it exists in deployed environments?

  **Spec basis:** Agent-as-Citizen requires the agent to authenticate as a first-party OAuth app in deployed environments. Final proof is audit-log rows showing OAuth app authentication.

  **Answer:** Seed the first-party agent OAuth app with a numbered database migration plus idempotent boot-time verification. The migration creates the app record with stable `client_id`, first-party flag, allowed grant type `client_credentials`, and required scopes. Secrets come from environment variables in deployed environments and local dev env for development; raw secrets are never committed. On boot, the API verifies the configured agent app exists and has the required scopes, failing fast in production if it is missing or misconfigured.

- Which scopes does the agent request, and what is your defense for each? Does the agent need write scopes, or can it stay read-only behind a recommendation pattern?

  **Spec basis:** Plugforge asks whether the agent needs write scopes or can stay read-only behind a recommendation pattern. FleetGraph's existing boundary allows reading permitted Ship state and writing FleetGraph-owned findings/runs/notifications, while Ship source-record mutations require a human.

  **Answer:** Agent scopes mirror the existing FleetGraph boundary. Grant read scopes for Ship source data needed to diagnose work: `documents:read`, `issues:read`, and `sprints:read`. Add narrow FleetGraph-specific write scopes for FleetGraph-owned state, such as `fleetgraph:findings:write`, `fleetgraph:runs:write`, and `fleetgraph:notifications:write`. Do not grant `documents:write`, `issues:write`, or `sprints:write` for final submission. Human-approved actions can use a separate user-delegated flow later. Week 6 proof shows a first-party agent using the public API without privileged Ship source-record mutation.

- Behind a feature flag, both old (direct service calls) and new (SDK calls) paths exist. How does CI prove Part 2's tests pass with the flag both on and off?

  **Spec basis:** Agent rewire says old direct-service path and new SDK path exist behind a feature flag, and CI must prove Part 2 tests pass with the flag both on and off.

  **Answer:** Run the FleetGraph regression lane twice in CI: once with `FLEETGRAPH_USE_PUBLIC_API=false` and once with `FLEETGRAPH_USE_PUBLIC_API=true`. The same behavior tests must pass in both lanes. The public-API lane also asserts audit rows show the first-party agent OAuth app, requested scopes, route, status, latency, and `request_id`. Keep the flag until the public-API lane is stable; remove the old direct-service path after final submission.

---

## Phase 3: Post-Stack Refinement

### 3.1 — Security & Failure Modes

- What happens when an OAuth app's owner is deleted — apps deactivated, transferred to admin, or orphaned with a soft-flag? Each is a different recovery story.

  **Spec basis:** PRESEARCH asks for the recovery story when an OAuth app owner is deleted.

  **Answer:** On owner deletion, user-owned OAuth apps are deactivated by default. Existing access tokens and refresh tokens for those apps are revoked. Admins can transfer ownership before deletion or reactivate by assigning a new owner afterward. First-party system apps, such as the FleetGraph agent app, are not tied to a normal user owner; they use a system owner/service principal and remain active through user deletion.

- What is the failure mode when the webhook deliverer crashes mid-batch — at-least-once delivery (subscribers must dedupe), at-most-once (some lost), or exactly-once aspiration with idempotency keys?

  **Spec basis:** Webhook requirements include delivery log, retry, DLQ, replay, and `Idempotency-Key` preservation.

  **Answer:** Webhooks are at-least-once delivery. Before sending, create or update a delivery attempt record with status pending/sending; after response, mark success or failure. If the deliverer crashes mid-batch, unfinished attempts are picked up again by the retry scanner. Subscribers must dedupe using `Idempotency-Key` because a crash can cause a delivery to be sent more than once. Do not claim exactly-once delivery.

- How do you detect and respond to a leaked `client_secret` — automatic rotation, manual rotation by the owner, or admin-driven force-rotate? What's the audit signal you'd alert on?

  **Spec basis:** OAuth app secrets are shown once and rotate; PRESEARCH asks for leaked-secret response and audit signal.

  **Answer:** Detection signals: repeated `invalid_client` attempts, token requests from new IP/user-agent patterns, unusual rate-limit spikes, and owner/admin report. Response: owner can rotate immediately; admins can force-rotate and revoke all active tokens for the app. Suspected leak creates an audit event with app id, actor, reason, timestamp, and affected secret id, never the raw secret. For severe leaks, disable the app until the owner rotates and reviews subscriptions.

- What is your CSRF protection on the developer portal's app-form and rotate-secret endpoints, given they sit alongside the OAuth consent screen?

  **Spec basis:** Developer portal uses logged-in Ship session endpoints for app creation and secret rotation; OAuth consent also uses the logged-in browser session.

  **Answer:** Portal form POSTs and OAuth consent POSTs use the existing Ship session CSRF protection. Mutating session-auth endpoints require same-site cookies, CSRF token validation, and Origin/Referer checks when present. Public API bearer-token endpoints do not use cookie auth and are not CSRF-sensitive in the same way. Rotate-secret requires a fresh POST with CSRF token and never accepts GET.

### 3.2 — Testing Strategy

- How is the TTFE drill written — full `pnpm install` in a fresh container, or workspace symlink with the install step mocked? Which proves more, and which is fast enough for CI?

  **Spec basis:** TTFE drill must run from a clean container/working directory with published docs and SDK. Stack guidance says `@ship/sdk` is published as a workspace package, with npm-publish documented but not required for the week.

  **Answer:** Deliberate decision: TTFE uses a fresh temporary working directory and installs the SDK/CLI from a packed workspace artifact, not a symlink and not the public npm registry. This proves package metadata, production dependencies, exports, types, CLI bin wiring, login, subscription, document create, webhook receipt, and signature verification without requiring public ownership of `@ship/sdk`. Public npm publication is documented as a future/release step, not required for Week 6. The drill records elapsed milliseconds per stage and fails if total runtime exceeds the configured budget.

- How will OAuth Playwright tests stay stable — do you stub Keycloak/external IdPs, or run a containerized auth server? What does the trade cost in CI minutes?

  **Spec basis:** Auth Code + PKCE flow is implemented by Ship: `/oauth/authorize` → consent → `/oauth/token`. Tests must complete that flow and verify wrong `code_verifier` returns `invalid_grant`.

  **Answer:** OAuth Playwright tests use Ship's own local OAuth provider and seeded test users/apps. Do not run Keycloak, Auth0, or another external identity provider. The test logs in through the existing Ship test auth path, starts `/oauth/authorize` with a seeded app and PKCE challenge, approves consent, exchanges the code, and verifies the token against `/api/v1/me`. Negative test exchanges with a wrong `code_verifier` and expects `invalid_grant`. This keeps CI stable because no third-party auth service is involved.

- What is your strategy for testing the webhook deliverer's retry schedule without sleeping in tests? Deterministic clocks, virtual timers, or fast-forward control?

  **Spec basis:** Webhook retry schedule must be tested; critical guidance says timing-based webhook tests must not use real `setTimeout` waits.

  **Answer:** Use the same deterministic scheduler described in 2.3. Tests enqueue a delivery, force subscriber failures, advance fake time to the 1s, 4s, and 16s retry points, and assert attempts are recorded at the expected scheduled times. No test sleeps for real minutes. Production uses real timers; tests use controlled time.

### 3.3 — Tooling & CI

- Which lint rules catch the public/internal boundary violations early — no imports from `api/src/` in `api/src/platform/api/v1/`, no imports from `api/src/` in `integrations/`, both?

  **Spec basis:** Public API boundary says `/api/v1` routes must not import internal handler files. Critical guidance says external integrations live in `integrations/` and import only `@ship/sdk`, never `api/src/`.

  **Answer:** Enforce both boundaries in CI. Rule 1: `api/src/platform/api/v1/**` cannot import internal route handlers or private `api/src` routes; it must call shared service/domain modules through approved platform interfaces. Rule 2: `integrations/**` cannot import `api/src/**` or `web/src/**`; integrations may import `@ship/sdk` and normal package dependencies only. Violations fail lint, not just review.

- How will the OpenAPI fitness test be wired into CI — fail the build on drift, or warn and post a diff comment? What about additive changes?

  **Spec basis:** OpenAPI is generated from route metadata, never hand-written. Spec parity is asserted by fitness tests.

  **Answer:** OpenAPI fitness tests fail CI on drift. Source of truth is route metadata plus Zod schemas. Generated OpenAPI is an artifact, not hand-edited. When parity fails, fix the earliest wrong layer: route schema/metadata first, generator second, SDK third, docs/examples last. SDK exceptions must be explicitly documented; otherwise every public operation needs a matching SDK surface. Additive changes are allowed only when route metadata, generated spec, SDK surface, and docs move together in the same PR.

- How will the +10% performance regression budget be enforced — manual benchmark, automated baseline comparison, perf job that fails the PR?

  **Spec basis:** MVP hard gate requires P95 latency, bundle size, and per-route query counts within +10% of the Part 1 baseline.

  **Answer:** Store the Part 1 baseline metrics in a checked-in JSON artifact. CI runs the targeted performance lane for public API/document flows, bundle size check, and query-count checks, then compares results to baseline. Fail PRs when P95 latency, bundle size, or per-route query counts exceed baseline by more than 10%, unless the PR explicitly updates the baseline with justification. For noisy timing metrics, use repeated runs or median/P95 from the lane rather than a single request.

### 3.4 — Deployment & Hosting

- Where does the deployed Ship instance live, and how do you give graders a pre-registered OAuth app without exposing your tenant's data?

  **Spec basis:** Final submission requires deployed Ship, live OpenAPI URL, and a pre-registered OAuth app with read-only scopes for graders.

  **Answer:** Deploy Ship on Render unless implementation work exposes a blocking issue with the existing deploy path. Use the existing project pattern: Render web plus Render API. Seed a dedicated grader/demo workspace with synthetic data only. Pre-register a grader OAuth app with read-only scopes and a known redirect URI for the browser demo/CLI docs. Put grader `client_id`, allowed redirect URI, API base URL, and demo credentials in README; do not expose `client_secret` for public clients. For confidential demo clients, provide the secret only through the submission channel or generate it during setup.

- Will the OpenAPI spec be served from the live instance only, or also published as a static doc (Stoplight, Redoc, Swagger UI) at a stable URL?

  **Spec basis:** Submission requirements say OpenAPI spec must be live at `/api/v1/openapi.json` on the deployed instance, plus a static copy at `docs/openapi.json` in the repo.

  **Answer:** Serve OpenAPI from the live API at `/api/v1/openapi.json` and commit a generated static copy at `docs/openapi.json`. The live route proves the deployed app exposes its current contract; the static copy gives reviewers a stable repo artifact. Swagger UI or Redoc is optional convenience, not the source of truth. CI verifies the static copy matches the generated spec.

- If a grader wants to install the CLI from your repo and run it against your deployed instance, what is the one-command setup, and where does it live in the README?

  **Spec basis:** Demo video and TTFE require the five-line story: install SDK/CLI, `ship login`, `ship docs create`, `ship webhooks tail`. Submission requires deployed app credentials in README.

  **Answer:** README has a "Grader TTFE" section with one command: `pnpm drill ttfe --target deployed`. The command installs the packed SDK/CLI from the repo, points it at the deployed API base URL, uses the pre-registered grader OAuth app, runs device login, creates a document, starts webhook tail, verifies the signed `document.created` event, and prints timing by stage. Manual fallback commands are listed immediately below for debugging.

### 3.5 — Observability of API Usage

- What metrics do you record per public API call (route, status, latency, scope used, app, user, `request_id`), and where do they show up (logs, `/metrics`, dev portal)?

  **Spec basis:** Public Audit Trail requires every public API call recorded with timestamp, app `client_id`, `user_id`, route, scope used, status, and latency. PRESEARCH also names route, status, latency, scope, app, user, and `request_id`.

  **Answer:** Record one audit row per `/api/v1` call: timestamp, `request_id`, app/`client_id`, `user_id` when present, token/grant id, route template, method, status, `latency_ms`, scope required/used, rate-limit bucket result, and error code when present. Show it in structured server logs and the developer portal audit view. Aggregate `/metrics` counters are optional. Required evidence comes from audit rows and portal visibility.

- How will you tell, post-demo, that the agent actually went through the public API for every action — a grep of the audit log, a dashboard panel, or a fitness test that runs the agent and inspects the trail?

  **Spec basis:** Submission requirements say Epic 7 proof is the agent's audit-log rows showing OAuth app authentication. Build strategy says the agent rewire replaces direct service calls with SDK calls behind a feature flag.

  **Answer:** Use a fitness test plus an audit-log query. The test runs a representative FleetGraph agent path with `FLEETGRAPH_USE_PUBLIC_API=true`, then asserts every externally visible agent read/write produced `/api/v1` audit rows with the first-party agent `client_id`, required scopes, route, status, latency, and `request_id`. The demo/reviewer view exposes the same audit trail filtered to the agent app. A grep is acceptable for debugging; final evidence is automated test output plus portal/audit evidence.

- How does `Idempotency-Key` reuse vs. fresh keys show up in your delivery log? Could you tell whether a subscriber's dedupe is working from your portal alone?

  **Spec basis:** Replay must preserve the original `Idempotency-Key` so subscribers can dedupe. Delivery log records every attempt and is visible in the developer portal.

  **Answer:** Delivery log stores `idempotency_key`, `event_id`, `subscription_id`, `delivery_id`, `attempt_number`, `replay_of_delivery_id` when applicable, response status, and timestamps. Retries and manual replays show the same `idempotency_key` as the original event; new events show new keys. The portal can prove Ship preserved dedupe inputs, but it cannot prove the subscriber actually deduped unless the subscriber reports a dedupe result. For the final drill, the test subscriber records whether it processed or skipped each key, and the portal/test output shows replay used the original key.
