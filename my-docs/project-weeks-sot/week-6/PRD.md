# PlugForge Literal Requirements Ledger

## Document Rules and Citation Policy

- This document is a literal requirements ledger for the PlugForge assignment; it is not a product-positioning document and does not define Ship's product identity. Source: User decision.
- Allowed source categories are `Plugforge-specs.txt`, `Plugforge-specs.pdf` only where it differs from the text extraction, and explicit user decisions from conversation. Source: User decision.
- Requirement citations from the text extraction must include file name, exact line range, and section path. Source: User decision.
- Bare citation labels are not allowed; citations must not collapse a source to a vague shorthand. Source: User decision.
- `AI Cost Analysis` means the section titled `AI Cost Analysis` inside `Plugforge-specs.txt`, not a separate markdown file. Source: User decision; Plugforge-specs.txt lines 388-432, AI Cost Analysis.
- Lines derived from Pre-Search Checklist questions are open decisions, not requirements. Source: User decision; Plugforge-specs.txt lines 654-818, Appendix: Pre-Search Checklist.
- Existing-code inventory and reuse mapping are outside this PRD rewrite and are deferred until after this literal requirements ledger is accepted. Source: User decision.
- Additive implementation notes in this document do not change, replace, weaken, or complete any canonical requirement. They are non-normative research annotations that connect requirements to existing Ship code, identify reusable substrate, and name likely reuse paths. Use them as recommended starting points unless implementation discovers a cleaner or safer path; if diverging, note why. Reuse levels are exactly: `Existing complete`, `Strong substrate`, `Partial substrate`, or `New build`. Source: User decision.

Requirement classes used below:

- `Required`: a behavior, contract, artifact, or implementation constraint directly required by the spec. Source: User decision.
- `MVP hard gate`: an item in the spec's MVP checklist, where the spec says all items are required to pass. Source: Plugforge-specs.txt lines 43-66, MVP Requirements.
- `Performance target`: a metric target listed by the spec. Source: Plugforge-specs.txt lines 218-234, Performance Targets; Plugforge-specs.txt lines 371-384, Performance Targets - Signature Challenge.
- `Submission requirement`: an artifact or proof required for final submission. Source: Plugforge-specs.txt lines 570-611, Submission Requirements.
- `Open decision`: a choice the spec asks to decide or that the user has not locked. Source: User decision; Plugforge-specs.txt lines 654-818, Appendix: Pre-Search Checklist.
- `User decision`: a requirement, scope choice, or constraint explicitly decided in conversation. Source: User decision.
- `Stretch`: a listed option that is not final scope unless final scope is already complete and the user chooses to attempt it. Source: User decision.

## Authoritative User Decisions

- Final submission deadline for this PRD is Sunday 12:00 PM Austin, Texas time, resolving the conflict between the Project Overview deadline and the Submission Requirements deadline. Source: User decision; Plugforge-specs.txt lines 27-39, Project Overview; Plugforge-specs.txt lines 570-572, Submission Requirements.
- Internal target is Saturday 12:00 PM Austin, Texas time. Source: User decision.
- Selected final scope includes CLI tool with device flow, Slack integration, Browser SDK demo, GitLab integration, refresh-token rotation drill, and Idempotency-Key end-to-end drill; the spec requires at least five flows, and this exact six-item set is a user scope decision. Source: User decision; Plugforge-specs.txt lines 357-368, Implement at Least 5 of the Following Integrations / Flows.
- In-process plugin runtime is stretch only. Source: User decision; Plugforge-specs.txt lines 366-368, Implement at Least 5 of the Following Integrations / Flows.
- Reuse the decided stack where it matches the spec: Node.js, Express, TypeScript strict mode, Zod, generated OpenAPI, React, Postgres, Playwright, and Vitest. Source: User decision; Plugforge-specs.txt lines 435-475, Technical Stack.
- Implement the OAuth provider flows inside Ship; do not use Auth0, Ory Hydra, or a Node OAuth server package for final scope. Source: User decision; Plugforge-specs.txt lines 448-450, Technical Stack > OAuth Implementation.
- Hand-author the public TypeScript SDK surface; generated or OpenAPI-derived types may be used underneath. Source: User decision; Plugforge-specs.txt lines 458-460, Technical Stack > OpenAPI / SDK.
- Use an in-memory webhook deliverer for final scope unless a hard blocker appears and is discussed. Source: User decision; Plugforge-specs.txt lines 452-453, Technical Stack > Webhook Queue.
- Use an in-memory token-bucket rate limiter for final scope unless a hard blocker appears and is discussed. Source: User decision; Plugforge-specs.txt lines 455-456, Technical Stack > Rate Limiting.
- Deployment provider remains open. Source: User decision; Plugforge-specs.txt lines 471-472, Technical Stack > Deployment; Plugforge-specs.txt lines 804-810, Pre-Search Checklist > Phase 3 > Deployment & Hosting.

## Global Pass Criteria

- MVP is a hard gate: all MVP checklist items must pass. Owning sections: OAuth Apps, Public API Contract, TypeScript SDK, Documentation and Submission Evidence. Source: Plugforge-specs.txt lines 43-66, MVP Requirements.
- Time-to-First-Event on a clean machine with docs only must be less than or equal to 30 minutes. Owning section: CLI and Time-to-First-Event Drill. Source: Plugforge-specs.txt lines 222-223, Performance Targets; Plugforge-specs.txt lines 371-378, Performance Targets - Signature Challenge.
- TTFE drill runtime in CI at P95 must be less than 60 seconds. Owning section: CLI and Time-to-First-Event Drill. Source: Plugforge-specs.txt lines 222-223, Performance Targets; Plugforge-specs.txt lines 371-376, Performance Targets - Signature Challenge.
- TTFE drill flake rate over 20 consecutive CI runs must be 0%. Owning section: CLI and Time-to-First-Event Drill. Source: Plugforge-specs.txt lines 379-381, Performance Targets - Signature Challenge.
- OpenAPI spec parity must be 100%. Owning section: Public API Contract. Source: Plugforge-specs.txt lines 226-227, Performance Targets.
- Webhook first-attempt delivery latency at P95 must be less than 2 seconds. Owning section: Webhooks. Source: Plugforge-specs.txt lines 228-229, Performance Targets.
- Webhook retry success rate after transient 5xx must be 100% within the configured schedule. Owning section: Webhooks. Source: Plugforge-specs.txt lines 230-231, Performance Targets.
- Public API responses must carry rate-limit headers 100% of the time. Owning section: Developer Portal, Rate Limiting, and Public Audit Trail. Source: Plugforge-specs.txt lines 232-233, Performance Targets.
- P95 latency, bundle size, and per-route query counts must stay within 10% of the Part 1 baseline. Owning sections: Public API Contract and Documentation and Submission Evidence. Source: Plugforge-specs.txt lines 63-64, MVP Requirements; Plugforge-specs.txt lines 234, Performance Targets.

## OAuth Apps, Grants, Tokens, and Scopes

### Source

- OAuth app model, Authorization Code + PKCE, Device Authorization Grant, Scope Registry, Token Middleware, and Refresh Tokens are specified in the OAuth + Public API Contract Layer. Source: Plugforge-specs.txt lines 73-115, Core Technical Requirements > OAuth + Public API Contract Layer.
- OAuth flow tests are specified in Testing Scenarios. Source: Plugforge-specs.txt lines 191-198, Testing Scenarios.
- OAuth implementation stack guidance is specified in Technical Stack. Source: Plugforge-specs.txt lines 448-450, Technical Stack > OAuth Implementation.

### Additive Implementation Notes

> Additive implementation note: OAuth app model, credential display, bearer auth, and scopes.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: API-token creation already accepts scoped credential requests in `api/src/routes/api-tokens.ts:44`, creates shown-once bearer tokens in `api/src/routes/api-tokens.ts:100`, stores only token hashes in `api/src/routes/api-tokens.ts:104`, and writes token audit events in `api/src/routes/api-tokens.ts:111`. Token persistence exists in `api/src/db/migrations/014_api_tokens.sql:4`; scoped token storage exists in `api/src/db/migrations/041_security_capabilities.sql:1`; bearer-token validation exists in `api/src/middleware/auth.ts:53`; token validation populates principal state in `api/src/security/tokens.ts:47`; scope/principal types live in `api/src/security/principal.ts:4`; scope-to-capability checks live in `api/src/security/capabilities.ts:120` and `api/src/security/capabilities.ts:159`.
> Recommended reuse path: model the OAuth app creation and shown-once secret flow after the API-token create/list/revoke pattern, then adapt bearer middleware to validate OAuth access tokens and populate app, user, and granted scopes. Reuse capability authorization as the downstream domain permission layer.
> Gap/new work: build `oauth_apps` or equivalent, OAuth client-secret hashing with Argon2id, secret rotation records, authorization grants, authorization codes, access tokens, refresh-token families, device codes, consent records, `require(scope)` middleware, and a scopes-as-data registry.
> Do not overclaim: existing API tokens are not OAuth apps, existing token hashes are SHA-256 rather than Argon2id client-secret hashes, and existing scoped API-token auth does not implement Authorization Code + PKCE, Device Authorization Grant, refresh rotation, app ownership, consent, or OAuth error semantics.

> Additive implementation note: Authorization Code + PKCE security mechanics.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: Ship already consumes an external OAuth/OIDC provider through CAIA. PKCE verifier/challenge, state, and nonce generation are in `api/src/services/caia.ts:274`; the authorize URL carries `code_challenge` and `code_challenge_method` in `api/src/services/caia.ts:285`; callback exchange with expected state/nonce lives in `api/src/services/caia.ts:303`; database-backed state storage is used by `api/src/routes/caia-auth.ts:67`; one-time state storage/consume functions live in `api/src/services/oauth-state.ts:58` and `api/src/services/oauth-state.ts:86`; the table is created by `api/src/db/migrations/010_oauth_state.sql:8`.
> Recommended reuse path: copy the security posture and one-time-state pattern for Plugforge OAuth provider flows, but invert the role: Ship must become the authorization server for external clients.
> Gap/new work: implement `/oauth/authorize`, `/oauth/token`, consent UI, PKCE challenge persistence, verifier validation, auth-code issuance, token exchange, OAuth provider errors, and public-client handling.
> Do not overclaim: CAIA proves Ship has OAuth client experience; it is not a reusable OAuth provider implementation.

> Additive implementation note: session CSRF and portal/consent POST protection.
> Canonical requirement unchanged.
> Reuse level: `Strong substrate`.
> Existing substrate: API-token bearer requests bypass CSRF because bearer tokens are not browser auto-attached in `api/src/app.ts:56`; Origin/Referer and CSRF token checks for cookie-auth mutating requests live in `api/src/app.ts:77`; CSRF token endpoint exists at `api/src/app.ts:271`; the web client includes CSRF behavior in `web/src/api/client.ts:102`.
> Recommended reuse path: use existing session CSRF protection for OAuth consent POSTs and developer-portal credential bootstrap endpoints.
> Gap/new work: add OAuth-specific consent routes and ensure they set `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`.
> Do not overclaim: existing CSRF protection does not create the OAuth consent flow; it is only the browser-session safety layer to reuse.

### Required Contract

- `oauth_apps` or an equivalent persistent model must include `id`, `client_id`, hashed `client_secret`, `redirect_uris`, owner, and requested scopes. Source: Plugforge-specs.txt lines 79-81, Core Technical Requirements > OAuth App Model.
- The raw `client_secret` must be shown once on creation. Source: Plugforge-specs.txt lines 47-48, MVP Requirements; Plugforge-specs.txt lines 79-81, Core Technical Requirements > OAuth App Model.
- The raw `client_secret` must be shown once on rotation. Source: Plugforge-specs.txt lines 79-81, Core Technical Requirements > OAuth App Model.
- The raw `client_secret` must never be recoverable after display. Source: Plugforge-specs.txt lines 79-81, Core Technical Requirements > OAuth App Model.
- `/oauth/authorize` must record `code_challenge` and `code_challenge_method`. Source: Plugforge-specs.txt lines 83-85, Core Technical Requirements > Authorization Code + PKCE.
- `/oauth/token` must require `code_verifier` for the Authorization Code + PKCE token exchange. Source: Plugforge-specs.txt lines 83-85, Core Technical Requirements > Authorization Code + PKCE.
- A mismatched verifier must return `400` with `invalid_grant`. Source: Plugforge-specs.txt lines 83-85, Core Technical Requirements > Authorization Code + PKCE; Plugforge-specs.txt lines 191-195, Testing Scenarios.
- `/oauth/device/code` must issue both `user_code` and `device_code`. Source: Plugforge-specs.txt lines 87-89, Core Technical Requirements > Device Authorization Grant.
- `/oauth/device/verify` must accept `user_code`. Source: Plugforge-specs.txt lines 87-89, Core Technical Requirements > Device Authorization Grant.
- The client must poll `/oauth/token` until the Device Authorization Grant is authorized. Source: Plugforge-specs.txt lines 87-89, Core Technical Requirements > Device Authorization Grant.
- Device Authorization Grant polling must honor slow-down responses. Source: Plugforge-specs.txt lines 87-89, Core Technical Requirements > Device Authorization Grant; Plugforge-specs.txt lines 197-198, Testing Scenarios.
- Bearer validation must populate the request with app, user, and granted scopes. Source: Plugforge-specs.txt lines 97-99, Core Technical Requirements > Token Middleware.
- Invalid tokens must return `401`. Source: Plugforge-specs.txt lines 51-52, MVP Requirements; Plugforge-specs.txt lines 97-99, Core Technical Requirements > Token Middleware.
- Missing tokens must return `401`. Source: Plugforge-specs.txt lines 51-52, MVP Requirements.
- Expired tokens must return `401` with a distinct error code. Source: Plugforge-specs.txt lines 51-52, MVP Requirements.
- For expired access tokens, the public error response must use top-level `code: "unauthorized"` and include a machine-readable expired-token subcode in `details.reason`, preserving the exact `ApiError.code` union while satisfying the distinct expired-token requirement. Source: Interpretation of Plugforge-specs.txt lines 51-56, MVP Requirements; Plugforge-specs.txt lines 270-277, Signature Challenge > Interface Definitions.
- Insufficient scope must return `403` and name the missing scope explicitly. Source: Plugforge-specs.txt lines 57-58, MVP Requirements; Plugforge-specs.txt lines 97-99, Core Technical Requirements > Token Middleware.
- Refresh tokens must be one-time-use with rotation. Source: Plugforge-specs.txt lines 100-101, Core Technical Requirements > Refresh Tokens.
- Reuse of a refresh token must invalidate the token family. Source: Plugforge-specs.txt lines 100-101, Core Technical Requirements > Refresh Tokens.
- Scopes must be registered as data. Source: Plugforge-specs.txt lines 91-93, Core Technical Requirements > Scope Registry.
- New scopes must register at module load rather than by editing middleware. Source: Plugforge-specs.txt lines 91-93, Core Technical Requirements > Scope Registry.
- Required scopes are `documents:read`, `documents:write`, `issues:read`, `issues:write`, `sprints:read`, `sprints:write`, and `webhooks:manage`. Source: Plugforge-specs.txt lines 91-93, Core Technical Requirements > Scope Registry.
- Route scopes must be declared through a `require(scope)` middleware factory. Source: Plugforge-specs.txt lines 53-54, MVP Requirements.

### Required Behavior

- An admin must be able to create an OAuth app, receive a `client_id`, and receive a raw `client_secret` shown exactly once while the database stores only a hash. Source: Plugforge-specs.txt lines 47-48, MVP Requirements.
- Authorization Code + PKCE must complete end-to-end through `/oauth/authorize`, consent, `/oauth/token`, and a usable access token. Source: Plugforge-specs.txt lines 49-50, MVP Requirements.
- Bearer token middleware must validate tokens on every `/api/v1/*` route. Source: Plugforge-specs.txt lines 51-52, MVP Requirements.
- The Device Authorization Grant result token must work against `/api/v1/me`. Source: Plugforge-specs.txt lines 197-198, Testing Scenarios.

### Required Tests / Proof

- A Playwright test must complete Authorization Code + PKCE from a registered web app. Source: Plugforge-specs.txt lines 191-195, Testing Scenarios.
- The Playwright test must confirm that a wrong `code_verifier` on token exchange returns `invalid_grant`. Source: Plugforge-specs.txt lines 191-195, Testing Scenarios.
- A test CLI must run Device Authorization Grant, poll `/oauth/token` until authorized, verify slow-down handling, and confirm the token works against `/api/v1/me`. Source: Plugforge-specs.txt lines 197-198, Testing Scenarios.
- The refresh-token rotation drill must prove that stolen refresh-token reuse invalidates the entire token family. Source: User decision; Plugforge-specs.txt lines 363-364, Implement at Least 5 of the Following Integrations / Flows.

### Resolved Security Decisions

- `client_secret` values must be generated once, displayed once, and stored only as salted Argon2id hashes; they are not recoverable, and lost secrets require rotation. Source: PRESEARCH.md lines 94-96; User decision.
- Secret verification must use constant-time comparison against the stored hash. Source: PRESEARCH.md lines 94-96; User decision.
- Access tokens are valid for 15 minutes. Source: PRESEARCH.md lines 98-102; User decision.
- Refresh tokens must be stored hashed at rest, rotated on every refresh, and treated as one-time-use tokens in a family; reuse of an already-used refresh token invalidates the entire family and requires reauthorization. Source: PRESEARCH.md lines 98-102; User decision.
- Refresh-token families expire 30 days after authorization. Source: User decision.
- Scope upgrades require re-consent; newly requested scopes must be highlighted, previously granted scopes shown as already granted, and no silent upgrades are allowed. Source: PRESEARCH.md lines 150-154; User decision.
- The consent screen must live in Ship's web UI on a dedicated OAuth consent route, reached only from `/oauth/authorize` after validating OAuth request parameters and PKCE challenge. Source: PRESEARCH.md lines 156-160; User decision.
- OAuth authorize/consent routes must set `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`. Source: PRESEARCH.md lines 156-160; User decision.
- Device verification UX must support both manual `user_code` entry and a full URL containing the code; URL-prefilled codes still require logged-in user confirmation. Source: PRESEARCH.md lines 162-166; User decision.
- Shown-once `client_secret` values must exist only in the create/rotate success response and immediate in-memory UI state; they must not be persisted in browser storage, URLs, logs, analytics, route state, server-rendered HTML, or error payloads. Source: PRESEARCH.md lines 112-116; Plugforge-specs.txt lines 699-700, Pre-Search Checklist > Phase 1 > Security & Data Sensitivity.
- When a user-owned OAuth app owner is deleted, the app must be deactivated by default and existing access and refresh tokens for that app must be revoked; first-party system apps use a system owner or service principal. Source: PRESEARCH.md lines 304-308; Plugforge-specs.txt lines 777-779, Pre-Search Checklist > Phase 3 > Security & Failure Modes.
- Suspected leaked `client_secret` response must support owner rotation, admin force-rotation, active-token revocation, and an audit event that records app id, actor, reason, timestamp, and affected secret id without recording the raw secret. Source: PRESEARCH.md lines 316-320; Plugforge-specs.txt lines 782-783, Pre-Search Checklist > Phase 3 > Security & Failure Modes.
- Portal form POSTs and OAuth consent POSTs must use existing Ship session CSRF protection; mutating session-auth endpoints require same-site cookies, CSRF token validation, and Origin/Referer checks when present. Source: PRESEARCH.md lines 322-326; Plugforge-specs.txt lines 784-785, Pre-Search Checklist > Phase 3 > Security & Failure Modes.

### Open Decisions


## Public API Contract

### Source

- Public API boundary, error shape, cursor pagination, and OpenAPI are specified in Core Technical Requirements. Source: Plugforge-specs.txt lines 103-115, Core Technical Requirements > OAuth + Public API Contract Layer.
- Documents resource requirements are listed in MVP Requirements. Source: Plugforge-specs.txt lines 53-54, MVP Requirements.
- Exact `ApiError` interface is specified in Interface Definitions. Source: Plugforge-specs.txt lines 268-277, Signature Challenge > Interface Definitions.

### Additive Implementation Notes

> Additive implementation note: generated OpenAPI and route metadata.
> Canonical requirement unchanged.
> Reuse level: `Strong substrate`.
> Existing substrate: route-adjacent OpenAPI registration exists in `api/src/openapi/define-route.ts:142`; route config includes method/path/tags/security/request/response metadata in `api/src/openapi/define-route.ts:38`; the shared registry is in `api/src/openapi/registry.ts:20`; the generator currently runs from `api/src/openapi/registry.ts:43`; the generated document is served at `/api/openapi.json` in `api/src/swagger.ts:42`; generated files are written by `api/src/swagger.ts:112`; root generation also emits web client types in `package.json:31`; OpenAPI route/spec parity checking starts from `scripts/check-openapi-routes.mjs:10`; OpenAPI response assertions exist in `api/src/test/openapi-response.ts:30`; project guidance documents the workflow in `docs/openapi-contract.md:8`.
> Recommended reuse path: create the `/api/v1` public route layer using route-adjacent Zod schemas and metadata, and extend or parallel the existing generator/parity checker for public OpenAPI 3.1 and scope declarations.
> Gap/new work: current OpenAPI is `3.0.0` in `api/src/openapi/registry.ts:46`, current live spec is `/api/openapi.json`, public `/api/v1/openapi.json` does not exist, and route-scope fitness checks do not exist.
> Do not overclaim: the existing OpenAPI system is internal `/api` contract tooling, not the required public `/api/v1` OpenAPI 3.1 surface.

> Additive implementation note: public resource routes should reuse domain services, not internal handlers.
> Canonical requirement unchanged.
> Reuse level: `Strong substrate`.
> Existing substrate: document list/get/create/update/delete handlers exist under `api/src/routes/documents/`; create/update schemas live in `api/src/routes/documents/shared.ts:158`; document reads use `loadDocumentForRead` in `api/src/routes/documents/shared.ts:122`; document creation delegates to `createDocumentMutation` in `api/src/services/document-mutations/create.ts:25`; document OpenAPI schemas exist in `api/src/openapi/schemas/documents.ts:11`; issue mutation services exist in `api/src/services/issue-mutations/create.ts:24` and `api/src/services/issue-mutations/update.ts:30`; sprint/week data is document-backed in `api/src/routes/weeks/sprints/collection.ts:24`; the unified document model is documented in `docs/unified-document-model.md:3` and `docs/unified-document-model.md:84`.
> Recommended reuse path: make `/api/v1` resource handlers call shared domain/query/mutation services or introduce shared public-safe service functions. Do not import internal Express handlers.
> Gap/new work: public response DTOs, public request schemas, cursor envelopes, public `ApiError`, public scopes, and `/api/v1/me` must be implemented.
> Do not overclaim: existing internal `/api/documents`, `/api/issues`, and `/api/weeks` routes return internal shapes and sometimes arrays or legacy error bodies; they do not satisfy Plugforge public route, error, scope, or pagination contracts.

> Additive implementation note: public error shape and request id.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: internal API response typing exists in `shared/src/types/api.ts:1`; generated OpenAPI already includes an internal `ApiErrorResponse` type in `web/src/api/generated/ship-openapi.d.ts:10124`; the web client has status-error handling in `web/src/api/client.ts:127`.
> Recommended reuse path: reuse naming and typed-error discipline, but implement a separate public error middleware for top-level `{ code, message, details?, request_id }`.
> Gap/new work: add public request-id middleware, attach `request_id` to every `/api/v1` failure, map internal domain errors into Plugforge's exact public error-code union, and fitness-test all public failure paths.
> Do not overclaim: existing internal errors are mixed `{ success: false, error: ... }`, `{ error: string }`, and route-specific bodies; they are not the required public `ApiError`.

> Additive implementation note: cursor pagination.
> Canonical requirement unchanged.
> Reuse level: `New build`.
> Existing substrate: internal list routes exist, for example documents in `api/src/routes/documents/list.ts:12` and issues in `api/src/routes/issues/index.ts:56`.
> Recommended reuse path: reuse the underlying list queries where safe, but wrap all public list responses in `{ data, next_cursor }`.
> Gap/new work: opaque base64 cursor encode/decode over `{ id, timestamp }`, stable ordering, list endpoint fitness tests, and SDK iterator behavior.
> Do not overclaim: existing internal list routes return arrays and do not provide opaque public cursors.

### Required Contract

- Public routes must live only at `/api/v1/*`. Source: Plugforge-specs.txt lines 103-104, Core Technical Requirements > Public API Boundary.
- Internal endpoints must stay at `/api/`. Source: Plugforge-specs.txt lines 103-104, Core Technical Requirements > Public API Boundary.
- `/api/v1/` must be mounted as a fresh public router that does not share middleware with the internal API. Source: Plugforge-specs.txt lines 485-487, Build Strategy > Priority Order.
- A lint rule must fail the build if a public route imports from internal handler files. Source: Plugforge-specs.txt lines 103-104, Core Technical Requirements > Public API Boundary.
- At least the documents resource must implement GET list, GET by id, and POST. Source: Plugforge-specs.txt lines 53-54, MVP Requirements.
- `/api/v1/me` is required because OAuth/device-flow proof must validate a token against it and the SDK skeleton must call `.me()`. Source: Plugforge-specs.txt lines 61-62, MVP Requirements; Plugforge-specs.txt lines 197-198, Testing Scenarios.
- `/api/v1/openapi.json` must serve the generated OpenAPI 3.1 spec. Source: Plugforge-specs.txt lines 59-60, MVP Requirements; Plugforge-specs.txt lines 113-115, Core Technical Requirements > OpenAPI 3.1 Spec.
- Every public failure must return `ApiError` with `{ code, message, details?, request_id }`. Source: Plugforge-specs.txt lines 55-56, MVP Requirements; Plugforge-specs.txt lines 106-107, Core Technical Requirements > Consistent Error Shape.
- `ApiError` allowed `code` values are exactly `unauthorized`, `forbidden`, `not_found`, `validation_failed`, `rate_limited`, and `server_error`. Source: Plugforge-specs.txt lines 270-277, Signature Challenge > Interface Definitions.
- `ApiError.message` and `ApiError.request_id` are required string fields. Source: Plugforge-specs.txt lines 270-277, Signature Challenge > Interface Definitions.
- `ApiError.details` is optional and must be `Record<string, unknown>` when present. Source: Plugforge-specs.txt lines 270-277, Signature Challenge > Interface Definitions.
- List responses must always return `{ data, next_cursor }`. Source: Plugforge-specs.txt lines 109-111, Core Technical Requirements > Cursor Pagination.
- Cursors must be opaque base64 cursors over `{ id, timestamp }`. Source: Plugforge-specs.txt lines 109-111, Core Technical Requirements > Cursor Pagination.
- Cursors must be stable across reordering operations. Source: Plugforge-specs.txt lines 109-111, Core Technical Requirements > Cursor Pagination.
- Every public list endpoint must return the cursor-pagination envelope `{ data, next_cursor }`; small static lists may return `next_cursor: null` but must not opt out of the response envelope. Source: Interpretation of Plugforge-specs.txt lines 109-111, Core Technical Requirements > Cursor Pagination; Plugforge-specs.txt lines 730-731, Pre-Search Checklist > Phase 2 > Public API Shape.
- OpenAPI 3.1 must be generated from route metadata in-process. Source: Plugforge-specs.txt lines 113-115, Core Technical Requirements > OpenAPI 3.1 Spec.
- The OpenAPI spec must not be hand-written. Source: Plugforge-specs.txt lines 59-60, MVP Requirements; Plugforge-specs.txt lines 113-115, Core Technical Requirements > OpenAPI 3.1 Spec.
- Public routes must have request and response schemas in Zod adjacent to the handler so the generator can walk them. Source: Plugforge-specs.txt lines 510-511, Critical Guidance > Generate the OpenAPI spec.
- Minimum public endpoint floor is `GET /api/v1/me`; `GET /api/v1/documents`, `GET /api/v1/documents/:id`, and `POST /api/v1/documents`; webhook subscription management, delivery-log query, and replay endpoints; and the minimum issues surface needed for Slack `issue.assigned` notifications and GitLab issue-to-merge-request linking. Source: Interpretation of Plugforge-specs.txt lines 53-54, MVP Requirements; Plugforge-specs.txt lines 130-153, Core Technical Requirements > Webhooks: Signing, Retries, Replay; Plugforge-specs.txt lines 160-162, Core Technical Requirements > Typed SDK Surface; User decision.
- The `client.sprints` SDK client and sprint scopes must exist, but concrete sprint endpoints are required only when exposed in OpenAPI or used by selected final flows. Source: Interpretation of Plugforge-specs.txt lines 91-93, Core Technical Requirements > Scope Registry; Plugforge-specs.txt lines 160-162, Core Technical Requirements > Typed SDK Surface.

Exact public error contract:

Source: Plugforge-specs.txt lines 270-277, Signature Challenge > Interface Definitions.

```ts
interface ApiError {
  code: "unauthorized" | "forbidden" | "not_found"
    | "validation_failed" | "rate_limited" | "server_error";
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
}
```

### Required Tests / Proof

- A fitness test must assert `ApiError` shape over all `/api/v1` routes. Source: Plugforge-specs.txt lines 55-56, MVP Requirements.
- A fitness test must enumerate every `/api/v1/*` route and assert that each one has an OpenAPI entry. Source: Plugforge-specs.txt lines 199-201, Testing Scenarios.
- A fitness test must assert that each `/api/v1/*` route declares a scope. Source: Plugforge-specs.txt lines 199-201, Testing Scenarios.
- A fitness test must assert that public-route failure paths return `ApiError`. Source: Plugforge-specs.txt lines 199-201, Testing Scenarios.
- A fitness test must assert cursor pagination for list endpoints. Source: Plugforge-specs.txt lines 199-201, Testing Scenarios.
- A unit test must validate generated `/api/v1/openapi.json` against the OpenAPI 3.1 schema. Source: Plugforge-specs.txt lines 59-60, MVP Requirements; Plugforge-specs.txt lines 202-203, Testing Scenarios.
- CI must fail on OpenAPI generator drift. Source: Plugforge-specs.txt lines 510-511, Critical Guidance > Generate the OpenAPI spec.
- Existing Playwright regression suite must pass on main. Source: Plugforge-specs.txt lines 63-64, MVP Requirements.
- Performance regression checks must keep P95 latency, bundle size, and per-route query counts within 10% of the Part 1 baseline. Source: Plugforge-specs.txt lines 63-64, MVP Requirements; Plugforge-specs.txt lines 234, Performance Targets.

### Performance Targets

- OAuth Authorization Code + PKCE round-trip P95 must be less than 3 seconds. Source: Plugforge-specs.txt lines 224-225, Performance Targets.
- OpenAPI spec parity between spec and routes must be 100%. Source: Plugforge-specs.txt lines 226-227, Performance Targets.

### Open Decisions

- Field-level filtering or sparse-fieldset policy, if any, is open. Source: Plugforge-specs.txt lines 726-727, Pre-Search Checklist > Phase 2 > Public API Shape.
- Versioning policy after `/api/v1/` is open. Source: Plugforge-specs.txt lines 728-729, Pre-Search Checklist > Phase 2 > Public API Shape.
- OpenAPI drift CI behavior is open only if the team wants something other than fail-the-build; the spec guidance says generator drift should fail CI. Source: Plugforge-specs.txt lines 510-511, Critical Guidance > Generate the OpenAPI spec; Plugforge-specs.txt lines 799-800, Pre-Search Checklist > Phase 3 > Tooling & CI.
- The exact mechanism for enforcing the 10% performance budget is open. Source: Plugforge-specs.txt lines 801-802, Pre-Search Checklist > Phase 3 > Tooling & CI.

### Explicit Non-Scope

- Public `/api/v1/*` routes must not import internal handler files. Source: Plugforge-specs.txt lines 103-104, Core Technical Requirements > Public API Boundary.
- The OpenAPI spec must not be hand-written. Source: Plugforge-specs.txt lines 59-60, MVP Requirements; Plugforge-specs.txt lines 113-115, Core Technical Requirements > OpenAPI 3.1 Spec.

## Webhooks

### Source

- Webhook signing, retry, DLQ, delivery log, and replay requirements are specified in Core Technical Requirements. Source: Plugforge-specs.txt lines 118-153, Core Technical Requirements > Webhooks: Signing, Retries, Replay.
- Webhook tests are specified in Testing Scenarios. Source: Plugforge-specs.txt lines 204-212, Testing Scenarios.
- Exact signature helper contract is specified in Interface Definitions. Source: Plugforge-specs.txt lines 292-299, Signature Challenge > Interface Definitions.

### Additive Implementation Notes

> Additive implementation note: event publication and durable retry pattern.
> Canonical requirement unchanged.
> Reuse level: `Strong substrate`.
> Existing substrate: FleetGraph already uses durable attention events. Its queue table is `api/src/db/migrations/045_fleetgraph_attention_events.sql:3`; attempts/status fields are in `api/src/db/migrations/045_fleetgraph_attention_events.sql:24`; active dedupe and claim indexes are in `api/src/db/migrations/045_fleetgraph_attention_events.sql:42` and `api/src/db/migrations/045_fleetgraph_attention_events.sql:51`; retry delay logic exists in `api/src/fleetgraph/persistence.ts:247`; enqueue is in `api/src/fleetgraph/persistence.ts:509`; claim uses `FOR UPDATE SKIP LOCKED` in `api/src/fleetgraph/persistence.ts:542`; retry/fail paths live in `api/src/fleetgraph/persistence.ts:606` and `api/src/fleetgraph/persistence.ts:627`.
> Recommended reuse path: model webhook delivery persistence, claiming, backoff, terminal failure, and replay safety after the FleetGraph queue patterns, while keeping webhook event/delivery schemas separate from FleetGraph attention events.
> Gap/new work: build event registry, `IEventBus`, subscription matcher, webhook subscriptions, signing secret storage, HMAC signer, in-memory deliverer, delivery log, DLQ, replay, idempotency headers, retry classification, and deterministic timing tests.
> Do not overclaim: FleetGraph attention events are not webhooks; they do not store webhook subscriptions, target URLs, HMAC secrets, response excerpts, delivery logs, DLQ visibility, or replay endpoints.

> Additive implementation note: domain layer writes already publish post-write side effects.
> Canonical requirement unchanged.
> Reuse level: `Strong substrate`.
> Existing substrate: FleetGraph events are enqueued from domain/service code, not route-only glue. `enqueueFleetGraphIssueAttentionEvents` is in `api/src/fleetgraph/events.ts:41`; issue creation publishes attention events in `api/src/services/issue-mutations/create.ts:102`; issue updates publish attention events in `api/src/services/issue-mutations/update.ts:297`; realtime broadcast helpers exist in `api/src/collaboration/broadcast.ts:130`; current shared realtime event types live in `shared/src/types/realtime-events.ts:18`.
> Recommended reuse path: publish webhook domain events from the same mutation/service layer where Ship source writes complete, then fan out through the new event bus.
> Gap/new work: convert Plugforge event types into data with Zod payload schemas and wire document/issue/sprint writes to publish the exact required events.
> Do not overclaim: realtime WebSocket broadcast and FleetGraph attention events are internal side effects, not the required third-party webhook pipeline.

> Additive implementation note: existing generated OpenAPI confirms no webhook API surface exists yet.
> Canonical requirement unchanged.
> Reuse level: `New build`.
> Existing substrate: generated web OpenAPI types currently expose `webhooks` as an empty type in `web/src/api/generated/ship-openapi.d.ts:10047`.
> Recommended reuse path: use this as a negative check: adding `/api/v1/webhooks` should visibly create generated public webhook operations and SDK parity cases.
> Gap/new work: every webhook management, delivery-log query, and replay operation must be added from scratch.
> Do not overclaim: current repository has webhook mentions in docs/backlog, not a webhook product implementation.

### Required Contract

- Event types must be registered as data. Source: Plugforge-specs.txt lines 122-124, Core Technical Requirements > Event Registry.
- Required event types are `document.created`, `document.updated`, `document.deleted`, `issue.created`, `issue.assigned`, `issue.status_changed`, `sprint.started`, and `sprint.completed`. Source: Plugforge-specs.txt lines 122-124, Core Technical Requirements > Event Registry.
- Each event type must have a Zod schema. Source: Plugforge-specs.txt lines 122-124, Core Technical Requirements > Event Registry.
- Event bus interface must be `IEventBus`. Source: Plugforge-specs.txt lines 126-128, Core Technical Requirements > Event Bus.
- Domain layer must publish events on writes; route layer must not publish domain events. Source: Plugforge-specs.txt lines 126-128, Core Technical Requirements > Event Bus.
- In-process event bus implementation must ship. Source: Plugforge-specs.txt lines 126-128, Core Technical Requirements > Event Bus.
- Queue-backed implementation, if added, must be a Liskov-substitutable drop-in. Source: Plugforge-specs.txt lines 126-128, Core Technical Requirements > Event Bus.
- Webhook subscriptions must be per-app and per-event-type. Source: Plugforge-specs.txt lines 130-132, Core Technical Requirements > Webhook Subscriptions.
- Webhook subscriptions must store target URL, hashed signing secret, and active flag. Source: Plugforge-specs.txt lines 130-132, Core Technical Requirements > Webhook Subscriptions.
- Webhook subscriptions must be manageable via `/api/v1/webhooks`. Source: Plugforge-specs.txt lines 130-132, Core Technical Requirements > Webhook Subscriptions.
- `/api/v1/webhooks` must be gated by `webhooks:manage` scope. Source: Plugforge-specs.txt lines 130-132, Core Technical Requirements > Webhook Subscriptions.
- Webhook signing must use HMAC-SHA256. Source: Plugforge-specs.txt lines 134-136, Core Technical Requirements > HMAC-SHA256 Signing.
- Webhook signature header must be Stripe-style `Ship-Signature: t=<unix-seconds>,v1=<hex-hmac>`. Source: Plugforge-specs.txt lines 134-136, Core Technical Requirements > HMAC-SHA256 Signing.
- The SDK verifier must reject signatures older than 5 minutes by default. Source: Plugforge-specs.txt lines 134-136, Core Technical Requirements > HMAC-SHA256 Signing.
- Retry schedule must be exponential backoff with jitter: 1s, 4s, 16s, 1m, 5m, 30m. Source: Plugforge-specs.txt lines 138-140, Core Technical Requirements > Retry Schedule.
- Subscriber 5xx responses, timeouts, and `429 Too Many Requests` responses must be retried. Source: Plugforge-specs.txt lines 138-142, Core Technical Requirements > Retry Schedule; User decision.
- Subscriber non-429 4xx responses must be treated as permanent failures and dead-lettered. Source: Plugforge-specs.txt lines 138-142, Core Technical Requirements > Retry Schedule; User decision.
- `429` is deliberately the only retryable 4xx because it is a backpressure signal and may include `Retry-After`. Source: User decision.
- After 6 failed attempts, deliveries must land in a DLQ visible in the developer portal. Source: Plugforge-specs.txt lines 142-144, Core Technical Requirements > Dead-Letter Queue.
- Operators must be able to replay manually from DLQ or delivery log. Source: Plugforge-specs.txt lines 142-144, Core Technical Requirements > Dead-Letter Queue.
- Replays must carry the original idempotency key. Source: Plugforge-specs.txt lines 142-144, Core Technical Requirements > Dead-Letter Queue; Plugforge-specs.txt lines 152-153, Core Technical Requirements > Replay.
- `webhook_deliveries` must record every attempt with `subscription_id`, `event_id`, `attempt_number`, `response_status`, `response_excerpt`, and `latency_ms`. Source: Plugforge-specs.txt lines 148-150, Core Technical Requirements > Delivery Log.
- Delivery log must be queryable per app. Source: Plugforge-specs.txt lines 148-150, Core Technical Requirements > Delivery Log.
- `/api/v1/webhooks/deliveries/:id/replay` must re-emit a logged event. Source: Plugforge-specs.txt lines 152-153, Core Technical Requirements > Replay.
- `Idempotency-Key` header must pass through so subscribers can dedupe. Source: Plugforge-specs.txt lines 152-153, Core Technical Requirements > Replay.
- `verifyWebhook(headers, rawBody, secret, toleranceSec?)` public function name, arguments, and boolean return are exact public contract. Source: Plugforge-specs.txt lines 294-299, Signature Challenge > Interface Definitions.
- `verifyWebhook` default tolerance is 300 seconds. Source: Plugforge-specs.txt lines 294-299, Signature Challenge > Interface Definitions.

Exact webhook signature contract:

Source: Plugforge-specs.txt lines 292-299, Signature Challenge > Interface Definitions.

```ts
// Header: Ship-Signature: t=1715985600,v1=<hex-hmac-sha256>
function verifyWebhook(
  headers: Record<string, string>,
  rawBody: string,
  secret: string,
  toleranceSec?: number,   // default 300
): boolean;
```

### Required Behavior

- Signature timestamp must prevent replay. Source: Plugforge-specs.txt lines 134-136, Core Technical Requirements > HMAC-SHA256 Signing.
- `verifyWebhook(headers, rawBody, secret)` must return true or false in one call. Source: Plugforge-specs.txt lines 172-173, Core Technical Requirements > Webhook Verifier.
- Tampered bodies must fail signature verification. Source: Plugforge-specs.txt lines 172-173, Core Technical Requirements > Webhook Verifier; Plugforge-specs.txt lines 264-265, Signature Challenge > Required Capabilities.
- Expired timestamps must fail signature verification. Source: Plugforge-specs.txt lines 172-173, Core Technical Requirements > Webhook Verifier; Plugforge-specs.txt lines 264-265, Signature Challenge > Required Capabilities.
- Missing `v1` header must fail signature verification. Source: Plugforge-specs.txt lines 172-173, Core Technical Requirements > Webhook Verifier.
- Valid payloads must pass signature verification. Source: Plugforge-specs.txt lines 264-265, Signature Challenge > Required Capabilities.

### Required Tests / Proof

- A webhook test must create a webhook subscription via the SDK. Source: Plugforge-specs.txt lines 204-206, Testing Scenarios.
- A webhook test must create a document. Source: Plugforge-specs.txt lines 204-206, Testing Scenarios.
- A webhook test must verify that a signed POST arrives at the target URL within 2 seconds. Source: Plugforge-specs.txt lines 204-206, Testing Scenarios.
- A webhook test must verify the signature with the SDK helper. Source: Plugforge-specs.txt lines 204-206, Testing Scenarios.
- A webhook test must tamper with the body and verify the helper rejects it. Source: Plugforge-specs.txt lines 204-206, Testing Scenarios.
- A retry test must make a subscriber return 500 on the first three attempts and 200 on the fourth. Source: Plugforge-specs.txt lines 207-209, Testing Scenarios.
- The retry test must verify 1s, 4s, and 16s minimum waits before retries. Source: Plugforge-specs.txt lines 207-209, Testing Scenarios.
- The retry test must verify the fourth attempt records success in the delivery log. Source: Plugforge-specs.txt lines 207-209, Testing Scenarios.
- A DLQ test must force 6 consecutive failures. Source: Plugforge-specs.txt lines 210-212, Testing Scenarios.
- The DLQ test must verify the delivery lands in the dead-letter queue. Source: Plugforge-specs.txt lines 210-212, Testing Scenarios.
- The DLQ test must verify the delivery is visible in the developer portal. Source: Plugforge-specs.txt lines 210-212, Testing Scenarios.
- A replay test must replay against a now-healthy subscriber and verify replay succeeds with the original idempotency key intact. Source: Plugforge-specs.txt lines 210-212, Testing Scenarios.
- Webhook timing tests must use deterministic clock injection or controlled timers, not long real-time sleeps. Source: Plugforge-specs.txt lines 513-515, Critical Guidance > Webhook timing tests.

### Performance Targets

- Webhook first-attempt delivery latency P95 must be less than 2 seconds. Source: Plugforge-specs.txt lines 228-229, Performance Targets.
- Webhook retry success after transient 5xx must be 100% within the configured schedule. Source: Plugforge-specs.txt lines 230-231, Performance Targets.
- Webhook signature verification by SDK helper must be less than 1 ms per call. Source: Plugforge-specs.txt lines 377-378, Performance Targets - Signature Challenge.

### Open Decisions

- Exact signed payload string is open. Source: Plugforge-specs.txt lines 733-735, Pre-Search Checklist > Phase 2 > Webhook Reliability.
- Webhook payload content is open: resource ID only or resource content. Source: Plugforge-specs.txt lines 696-698, Pre-Search Checklist > Phase 1 > Security & Data Sensitivity; Plugforge-specs.txt lines 733-735, Pre-Search Checklist > Phase 2 > Webhook Reliability.
- Delivery-log retention window is open. Source: Plugforge-specs.txt lines 670-671, Pre-Search Checklist > Phase 1 > Scale & Load Expectations.
- Test-control mechanism for retry timing is open if deterministic clock injection is not used. Source: Plugforge-specs.txt lines 513-515, Critical Guidance > Webhook timing tests; Plugforge-specs.txt lines 736-737, Pre-Search Checklist > Phase 2 > Webhook Reliability.

## TypeScript SDK

### Source

- SDK surface, OAuth helpers, pagination, verifier, and error union are specified in SDK, Rate Limiting, Developer Portal. Source: Plugforge-specs.txt lines 156-178, Core Technical Requirements > SDK, Rate Limiting, Developer Portal.
- Exact `ShipClient` interface is specified in Interface Definitions. Source: Plugforge-specs.txt lines 279-290, Signature Challenge > Interface Definitions.
- SDK parity testing is specified in Testing Scenarios. Source: Plugforge-specs.txt lines 202-203, Testing Scenarios.

### Additive Implementation Notes

> Additive implementation note: SDK package shape and generated type substrate.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: the workspace already supports packages in `pnpm-workspace.yaml:2`; generated OpenAPI-to-TypeScript is wired in `package.json:31`; the web app already uses `openapi-fetch` in `web/package.json:53`; the generated typed client is created in `web/src/api/client.ts:102`; `ApiPaths` is exported in `web/src/api/client.ts:143`; existing CLI/package structure can be copied from `packages/shipshape-security/package.json:1`, `packages/shipshape-security/bin/shipshape-security.mjs:1`, and `packages/shipshape-security/src/cli/router.mjs:1`.
> Recommended reuse path: create a new `@ship/sdk` workspace package using the existing package/build/bin conventions, consume generated or OpenAPI-derived types internally, and hand-author the public `ShipClient` surface.
> Gap/new work: add the package itself, public exports, resource clients, OAuth helpers, `ITokenStore`, refresh lock, async iterators, `ShipError`, webhook verifier, size check, and OpenAPI-to-SDK parity test.
> Do not overclaim: the web app's generated OpenAPI client is SDK-adjacent infrastructure; it is not `@ship/sdk` and is not the required public developer surface.

> Additive implementation note: API-as-agent-tool precedent.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: Ship's MCP server already auto-generates tools from the running OpenAPI spec in `api/src/mcp/server.ts:3`; it fetches `/api/openapi.json` in `api/src/mcp/server.ts:126`; tool generation starts in `api/src/mcp/server.ts:322`; API-token-based execution is configured through `SHIP_API_TOKEN` and `SHIP_URL` in `api/src/mcp/server.ts:9`; docs describe the same OpenAPI-to-tool loop in `docs/ship-claude-cli-integration.md:253`.
> Recommended reuse path: use this as evidence that Ship already treats OpenAPI as an agent/tool contract. Keep SDK parity similarly generated-and-checked, but curated by a hand-authored TypeScript surface.
> Gap/new work: public `/api/v1` operations, SDK methods, and OAuth-based auth must replace internal MCP assumptions for Plugforge.
> Do not overclaim: MCP tool generation is not the SDK and does not satisfy npm package, TypeScript ergonomics, OAuth helper, async iterator, or webhook verifier requirements.

### Required Contract

- `@ship/sdk` must exist as a pnpm workspace package skeleton. Source: Plugforge-specs.txt lines 61-62, MVP Requirements.
- `new ShipClient({ token }).me()` against a running server must return the typed authenticated user. Source: Plugforge-specs.txt lines 61-62, MVP Requirements.
- `@ship/sdk` must expose resource clients: `client.documents`, `client.issues`, `client.sprints`, and `client.webhooks`. Source: Plugforge-specs.txt lines 160-162, Core Technical Requirements > Typed SDK Surface.
- SDK method signatures must match the OpenAPI spec. Source: Plugforge-specs.txt lines 160-162, Core Technical Requirements > Typed SDK Surface.
- SDK drift must fail CI through a fitness test. Source: Plugforge-specs.txt lines 160-162, Core Technical Requirements > Typed SDK Surface.
- `ShipClient.authorizationCodeFlow()` must handle Authorization Code + PKCE end-to-end. Source: Plugforge-specs.txt lines 164-166, Core Technical Requirements > OAuth Helpers.
- `ShipClient.deviceLogin()` must handle Device Authorization Grant end-to-end. Source: Plugforge-specs.txt lines 164-166, Core Technical Requirements > OAuth Helpers.
- SDK token storage must be pluggable through `ITokenStore` with in-memory, file, and browser `localStorage` implementations. Source: Plugforge-specs.txt lines 164-166, Core Technical Requirements > OAuth Helpers.
- `ITokenStore` must persist both access-token and refresh-token state, including expiration time, granted scopes, app/client id, and user id when known. Source: PRESEARCH.md lines 240-244; User decision.
- SDK refresh must serialize concurrent refresh attempts per client so one-time-use refresh tokens are not reused accidentally. Source: PRESEARCH.md lines 240-244; User decision.
- `client.documents.iterate()` must support `for await (const doc of client.documents.iterate())` pagination. Source: Plugforge-specs.txt lines 168-170, Core Technical Requirements > Async-Iterator Pagination.
- SDK must provide `iterate()` methods that handle cursors internally so normal consumer code never sees them. Source: Plugforge-specs.txt lines 168-170, Core Technical Requirements > Async-Iterator Pagination.
- SDK may also expose page-level methods returning `{ data, next_cursor }` for UI and portal pagination. Source: User decision; Plugforge-specs.txt lines 109-111, Core Technical Requirements > Cursor Pagination.
- SDK errors must be a discriminated union with kinds `auth`, `rate_limit`, `not_found`, `validation`, and `server`. Source: Plugforge-specs.txt lines 175-177, Core Technical Requirements > Typed Error Union.
- SDK consumers must be able to switch on error kind exhaustively. Source: Plugforge-specs.txt lines 175-177, Core Technical Requirements > Typed Error Union.
- SDK methods must throw `ShipError` objects whose data is the discriminated union; SDK-only network failures use `kind: "network"`. Source: PRESEARCH.md lines 228-232; User decision.
- `ShipError` must preserve the API `request_id` and `details` payload when the failure came from an API response. Source: PRESEARCH.md lines 228-232; User decision.
- Hand-authored SDK public surface is final scope; generated or OpenAPI-derived types may be used underneath. Source: User decision; Plugforge-specs.txt lines 458-460, Technical Stack > OpenAPI / SDK.

Exact SDK public contract:

Source: Plugforge-specs.txt lines 279-290, Signature Challenge > Interface Definitions.

```ts
class ShipClient {
  readonly documents: DocumentsClient;
  readonly issues:     IssuesClient;
  readonly sprints:    SprintsClient;
  readonly webhooks:   WebhooksClient;

  static async deviceLogin(opts: {
    onUserCode: (code: string, verifyUrl: string) => void;
    tokenStore?: ITokenStore;
  }): Promise<ShipClient>;
}
```

### Required Tests / Proof

- A parity test must validate generated `/api/v1/openapi.json` against the OpenAPI 3.1 JSON schema and walk every spec method to assert the SDK exposes a typed call for it. Source: Plugforge-specs.txt lines 202-203, Testing Scenarios.

### Performance Targets

- SDK install size with production dependencies only must be less than 250 KB minified and gzipped. Source: Plugforge-specs.txt lines 383-384, Performance Targets - Signature Challenge.

### Open Decisions


### Explicit Non-Scope

- A generated raw SDK must not be the public developer surface. Source: User decision.

## CLI and Time-to-First-Event Drill

### Source

- TTFE definition, five-line story, required capabilities, exact interface snippets, example drill loop, and evaluation criteria are specified in Signature Challenge. Source: Plugforge-specs.txt lines 238-354, Signature Challenge.
- CLI flow is a must-ship integration. Source: Plugforge-specs.txt lines 357-358, Implement at Least 5 of the Following Integrations / Flows.

### Additive Implementation Notes

> Additive implementation note: CLI package and drill harness.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: existing workspace package/bin conventions live in `packages/shipshape-security/package.json:1`, `packages/shipshape-security/bin/shipshape-security.mjs:1`, and `packages/shipshape-security/src/cli/router.mjs:1`; workspace packages are listed in `pnpm-workspace.yaml:2`; API and E2E tests already have isolated environment support through `e2e/fixtures/isolated-env.ts:5`, worker-scoped fixtures in `e2e/fixtures/isolated-env.ts:91`, API server setup in `e2e/fixtures/isolated-env.ts:146`, web server setup in `e2e/fixtures/isolated-env.ts:206`, and dynamic baseURL support in `e2e/fixtures/isolated-env.ts:283`; Playwright isolation is documented in `playwright.config.ts:4`; shard runner infrastructure exists in `scripts/run-e2e-shards.sh:17`.
> Recommended reuse path: create the `ship` CLI as a package/bin using the existing package style, then make the TTFE drill pack/install the SDK/CLI from a clean working directory and run against a controlled Ship instance.
> Gap/new work: add `ship login`, `ship docs ls`, `ship docs get`, `ship docs create`, `ship webhooks tail`, device-login token storage, packed-artifact install, webhook listener/tail implementation, elapsed-stage timing, and CI threshold enforcement.
> Do not overclaim: the security probe CLI is only a package/CLI pattern; it is not the Plugforge `ship` CLI and does not implement Device Authorization Grant or webhook tailing.

### Required Contract

- CLI tool with device flow is must-ship. Source: User decision; Plugforge-specs.txt lines 357-358, Implement at Least 5 of the Following Integrations / Flows.
- CLI commands must include `ship login`, `ship docs ls`, `ship docs get`, `ship docs create`, and `ship webhooks tail`. Source: Plugforge-specs.txt lines 357-358, Implement at Least 5 of the Following Integrations / Flows.
- `ship login` must use Device Authorization Grant. Source: Plugforge-specs.txt lines 251-255, Signature Challenge > Five-Line Developer Story; Plugforge-specs.txt lines 357-358, Implement at Least 5 of the Following Integrations / Flows.
- `ship docs create --title "hello"` must use the SDK under the hood. Source: Plugforge-specs.txt lines 251-255, Signature Challenge > Five-Line Developer Story.
- `ship webhooks tail` must stream signed deliveries to stdout. Source: Plugforge-specs.txt lines 251-255, Signature Challenge > Five-Line Developer Story.
- `pnpm drill ttfe` must run the full loop end-to-end against a containerized Ship instance from a clean working directory. Source: Plugforge-specs.txt lines 259-261, Signature Challenge > Required Capabilities.

Exact five-line developer story:

Source: Plugforge-specs.txt lines 247-255, Signature Challenge > Five-Line Developer Story.

```bash
pnpm install @ship/sdk
ship login
ship docs create --title "hello"
ship webhooks tail
# document.created event arrives, signature verified
```

### Required Behavior

- The TTFE drill must measure the time for a developer to go from a clean container with only published docs and SDK to a verified signed webhook in the terminal. Source: Plugforge-specs.txt lines 238-245, Signature Challenge > Time-to-First-Event Drill.
- The TTFE drill must record elapsed milliseconds for install. Source: Plugforge-specs.txt lines 262-263, Signature Challenge > Required Capabilities.
- The TTFE drill must record elapsed milliseconds for login. Source: Plugforge-specs.txt lines 262-263, Signature Challenge > Required Capabilities.
- The TTFE drill must record elapsed milliseconds for subscription registration. Source: Plugforge-specs.txt lines 262-263, Signature Challenge > Required Capabilities.
- The TTFE drill must record elapsed milliseconds for document creation. Source: Plugforge-specs.txt lines 262-263, Signature Challenge > Required Capabilities.
- The TTFE drill must record elapsed milliseconds for webhook receipt. Source: Plugforge-specs.txt lines 262-263, Signature Challenge > Required Capabilities.
- The TTFE drill must record elapsed milliseconds for signature verification. Source: Plugforge-specs.txt lines 262-263, Signature Challenge > Required Capabilities.
- The TTFE drill must verify signatures through the SDK in one line with `verifyWebhook(headers, rawBody, secret)`. Source: Plugforge-specs.txt lines 264-265, Signature Challenge > Required Capabilities.
- The TTFE drill must run in CI on every PR. Source: Plugforge-specs.txt lines 266-266, Signature Challenge > Required Capabilities.
- Any TTFE regression past the configured threshold must fail the build. Source: Plugforge-specs.txt lines 266-266, Signature Challenge > Required Capabilities.
- The scripted drill must create a `ShipClient` through `ShipClient.deviceLogin`. Source: Plugforge-specs.txt lines 309-312, Signature Challenge > Example Drill Loop.
- The scripted drill must create a `document.created` webhook subscription through `client.webhooks.create`. Source: Plugforge-specs.txt lines 314-318, Signature Challenge > Example Drill Loop.
- The scripted drill must create a document through `client.documents.create({ title: "hello" })`. Source: Plugforge-specs.txt lines 320-321, Signature Challenge > Example Drill Loop.
- The scripted drill must wait for a signed delivery and verify it with `verifyWebhook`. Source: Plugforge-specs.txt lines 323-327, Signature Challenge > Example Drill Loop.
- The scripted drill must verify the delivered event type is `document.created`. Source: Plugforge-specs.txt lines 329-329, Signature Challenge > Example Drill Loop.
- The scripted drill must complete under 60,000 ms in CI. Source: Plugforge-specs.txt lines 330-330, Signature Challenge > Example Drill Loop.

### Required Tests / Proof

- TTFE drill must run end-to-end from a clean container: `pnpm install @ship/sdk`, `ship login`, create document, receive verified webhook in under 30 minutes elapsed. Source: Plugforge-specs.txt lines 213-215, Testing Scenarios.
- Final TTFE acceptance proof must use a clean container or clean working directory with a real package install from a packed workspace artifact; mocked workspace symlink installs may be used only for local development speed and do not satisfy final TTFE proof. Source: Interpretation of Plugforge-specs.txt lines 213-215, Testing Scenarios; Plugforge-specs.txt lines 259-266, Signature Challenge > Required Capabilities; Plugforge-specs.txt lines 471-472, Technical Stack > Deployment; User decision.
- CI proof for Epic 6 must be the TTFE drill passing in CI. Source: Plugforge-specs.txt lines 597-599, Submission Requirements.

### Evaluation Criteria

- Install stage must resolve the workspace package, load types in editor, and produce no peer-dependency errors. Source: Plugforge-specs.txt lines 334-340, Signature Challenge > Evaluation Criteria.
- Auth stage must display user code, polling must succeed within 60 seconds in tests, and token must persist in configured store. Source: Plugforge-specs.txt lines 341-342, Signature Challenge > Evaluation Criteria.
- Subscribe stage must persist subscription, return signing secret once, and show subscription in the developer portal. Source: Plugforge-specs.txt lines 344-345, Signature Challenge > Evaluation Criteria.
- Trigger stage must create the document, publish `document.created` on the bus, and deliver POSTs to subscribers. Source: Plugforge-specs.txt lines 347-348, Signature Challenge > Evaluation Criteria.
- Verify stage must pass valid signature, fail tampered body, and fail timestamp older than 5 minutes. Source: Plugforge-specs.txt lines 350-351, Signature Challenge > Evaluation Criteria.
- Total elapsed must be less than 60 seconds in CI and less than or equal to 30 minutes on a clean machine following only published docs. Source: Plugforge-specs.txt lines 353-354, Signature Challenge > Evaluation Criteria.

### Performance Targets

- TTFE drill runtime in CI at P95 must be less than 60 seconds. Source: Plugforge-specs.txt lines 371-376, Performance Targets - Signature Challenge.
- TTFE on a clean machine with docs only must be less than or equal to 30 minutes real elapsed. Source: Plugforge-specs.txt lines 377-378, Performance Targets - Signature Challenge.
- Drill flake rate over 20 consecutive CI runs must be 0%. Source: Plugforge-specs.txt lines 379-381, Performance Targets - Signature Challenge.

### Snippet Classification

- Exact command sequence is `pnpm install @ship/sdk`, `ship login`, `ship docs create --title "hello"`, and `ship webhooks tail`. Source: Plugforge-specs.txt lines 247-255, Signature Challenge > Five-Line Developer Story.
- Exact terminal outcome is `document.created` event arrival with signature verified; arrow/checkmark rendering is not contract. Source: Plugforge-specs.txt lines 251-255, Signature Challenge > Five-Line Developer Story.
- Required behavior from the example drill loop is `ShipClient.deviceLogin`, `client.webhooks.create`, `client.documents.create({ title: "hello" })`, `verifyWebhook`, delivered event type `document.created`, and elapsed time less than 60,000 ms. Source: Plugforge-specs.txt lines 303-331, Signature Challenge > Example Drill Loop.
- Illustrative example-code details are the sample path `integrations/cli/tests/ttfe.drill.ts`, comments, variable names, test framework syntax, `testListener`, `sub`, `delivery`, `t0`, `process.env.SHIP_DEVICE_CODE`, and `timeoutMs: 5000`, unless separately repeated as requirements elsewhere. Source: Plugforge-specs.txt lines 303-331, Signature Challenge > Example Drill Loop.

### Open Decisions

- CLI framework is open: commander, oclif, or no framework. Source: User decision; Plugforge-specs.txt lines 462-465, Technical Stack > Reference Integrations.

## Selected Integrations and Drills

### Source

- The spec requires at least 5 integrations/flows and marks CLI must-ship. Source: Plugforge-specs.txt lines 357-368, Implement at Least 5 of the Following Integrations / Flows.
- User selected 6 final integrations/flows and made the 7th stretch only. Source: User decision.
- External integrations must import only `@ship/sdk`, never `api/src/*`. Source: Plugforge-specs.txt lines 518-520, Critical Guidance > External integrations import only @ship/sdk.

### Additive Implementation Notes

> Additive implementation note: selected integrations are mostly new, but resource/event substrate exists.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: there is no top-level `sdk/`, `cli/`, or `integrations/` directory in the current workspace package list at `pnpm-workspace.yaml:2`. Slack appears as backlog/seed data in `api/src/db/seed.ts:631`, not as integration code. Issue assignment state already exists in issue mutation logic at `api/src/services/issue-mutations/update.ts:146`; issue mutations already emit FleetGraph events at `api/src/services/issue-mutations/update.ts:297`; document creation already uses a domain mutation service in `api/src/services/document-mutations/create.ts:25`; browser SPA infrastructure exists in `web/package.json:2` and `web/src/main.tsx:1`.
> Recommended reuse path: build integrations only through `@ship/sdk` and public webhooks. For Slack, consume signed `document.created` and `issue.assigned` payloads and post notification messages. For GitLab, use public issue data plus webhook/application wiring. For the browser demo, reuse the existing React/Vite app conventions but authenticate through Authorization Code + PKCE.
> Gap/new work: Slack OAuth/app setup, Slack notification worker/app, GitLab app wiring, browser SDK demo app, integration import-boundary lint rule, refresh-token rotation drill, and idempotency replay drill.
> Do not overclaim: Slack/GitLab/plugin runtime are not already implemented; existing docs/backlog mentions are not integration substrate.

### CLI Tool

- CLI tool with device flow is final scope and must ship. Source: User decision; Plugforge-specs.txt lines 357-358, Implement at Least 5 of the Following Integrations / Flows.
- CLI must support `ship login`, `ship docs ls`, `ship docs get`, `ship docs create`, and `ship webhooks tail`. Source: Plugforge-specs.txt lines 357-358, Implement at Least 5 of the Following Integrations / Flows.

### Slack Integration

- Slack integration is final scope. Source: User decision; Plugforge-specs.txt lines 360-361, Implement at Least 5 of the Following Integrations / Flows.
- Slack integration must receive signed Ship webhooks. Source: Plugforge-specs.txt lines 360-361, Implement at Least 5 of the Following Integrations / Flows.
- Slack integration must post `document.created` to Slack channels. Source: Plugforge-specs.txt lines 360-361, Implement at Least 5 of the Following Integrations / Flows.
- Slack integration must post `issue.assigned` to Slack channels. Source: Plugforge-specs.txt lines 360-361, Implement at Least 5 of the Following Integrations / Flows.
- Slack integration must use Slack OAuth. Source: Plugforge-specs.txt lines 360-361, Implement at Least 5 of the Following Integrations / Flows.
- Slack integration must import only `@ship/sdk`, not `api/src/*`. Source: Plugforge-specs.txt lines 518-520, Critical Guidance > External integrations import only @ship/sdk.

### Browser SDK Demo

- Browser SDK demo is final scope. Source: User decision; Plugforge-specs.txt lines 362-362, Implement at Least 5 of the Following Integrations / Flows.
- Browser SDK demo must be a single-page app. Source: Plugforge-specs.txt lines 362-362, Implement at Least 5 of the Following Integrations / Flows.
- Browser SDK demo must use Authorization Code + PKCE. Source: Plugforge-specs.txt lines 362-362, Implement at Least 5 of the Following Integrations / Flows.
- Browser SDK demo must list the authenticated user's documents. Source: Plugforge-specs.txt lines 362-362, Implement at Least 5 of the Following Integrations / Flows.

### GitLab Integration

- GitLab integration is final scope. Source: User decision; Plugforge-specs.txt lines 363-363, Implement at Least 5 of the Following Integrations / Flows.
- GitLab integration must link Ship issues to GitLab merge requests. Source: User decision; Plugforge-specs.txt lines 363-363, Implement at Least 5 of the Following Integrations / Flows.
- GitLab integration must use Ship webhook plus GitLab integration/application wiring. Source: User decision; Plugforge-specs.txt lines 363-363, Implement at Least 5 of the Following Integrations / Flows.
- GitLab integration must import only `@ship/sdk`, not `api/src/*`. Source: Plugforge-specs.txt lines 518-520, Critical Guidance > External integrations import only @ship/sdk.

### Refresh-Token Rotation Drill

- Refresh-token rotation drill is final scope. Source: User decision; Plugforge-specs.txt lines 364-364, Implement at Least 5 of the Following Integrations / Flows.
- Refresh-token rotation drill must prove that a stolen refresh token, when reused, invalidates the entire family. Source: Plugforge-specs.txt lines 364-364, Implement at Least 5 of the Following Integrations / Flows.

### Idempotency-Key End-to-End Drill

- Idempotency-Key end-to-end drill is final scope. Source: User decision; Plugforge-specs.txt lines 365-366, Implement at Least 5 of the Following Integrations / Flows.
- Idempotency-Key drill must confirm subscribers dedupe replayed deliveries. Source: Plugforge-specs.txt lines 365-366, Implement at Least 5 of the Following Integrations / Flows.
- Idempotency-Key drill must preserve the original `Idempotency-Key` on replay. Source: Plugforge-specs.txt lines 365-366, Implement at Least 5 of the Following Integrations / Flows; Plugforge-specs.txt lines 152-153, Core Technical Requirements > Replay.

### Stretch Plugin Runtime

- In-process plugin runtime is stretch only. Source: User decision; Plugforge-specs.txt lines 366-368, Implement at Least 5 of the Following Integrations / Flows.
- If attempted, plugin runtime hook is `document.beforeCreate`. Source: Plugforge-specs.txt lines 366-368, Implement at Least 5 of the Following Integrations / Flows.
- If attempted, plugin runtime must use `isolated-vm`. Source: Plugforge-specs.txt lines 366-368, Implement at Least 5 of the Following Integrations / Flows.
- If attempted, plugin runtime must have hard CPU and memory caps. Source: Plugforge-specs.txt lines 366-368, Implement at Least 5 of the Following Integrations / Flows.
- If attempted, plugin runtime must be explicitly experimental. Source: Plugforge-specs.txt lines 366-368, Implement at Least 5 of the Following Integrations / Flows.

### Required Tests / Proof

- Integrations must fail CI if they import `api/src/*`. Source: Plugforge-specs.txt lines 518-520, Critical Guidance > External integrations import only @ship/sdk.
- Selected integrations must only import `@ship/sdk` for Ship access. Source: Plugforge-specs.txt lines 518-520, Critical Guidance > External integrations import only @ship/sdk.

### Explicit Non-Scope

- Do not expand beyond the selected integrations/flows until required scope is complete. Source: User decision.
- In-process plugin runtime is not final scope. Source: User decision; Plugforge-specs.txt lines 366-368, Implement at Least 5 of the Following Integrations / Flows.

## Developer Portal, Rate Limiting, and Public Audit Trail

### Source

- Rate limit enforcement, public audit trail, and developer portal requirements are specified in SDK, Rate Limiting, Developer Portal. Source: Plugforge-specs.txt lines 179-188, Core Technical Requirements > SDK, Rate Limiting, Developer Portal.
- Portal replay and DLQ visibility are also required by Webhooks and Testing Scenarios. Source: Plugforge-specs.txt lines 142-144, Core Technical Requirements > Dead-Letter Queue; Plugforge-specs.txt lines 210-212, Testing Scenarios.

### Additive Implementation Notes

> Additive implementation note: developer portal credential and audit UI patterns.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: workspace settings already includes API-token UI state and rendering in `web/src/pages/WorkspaceSettings.tsx:523`; API-token calls are in `web/src/lib/api.ts:570`; admin audit-log state loads in `web/src/pages/AdminDashboard.tsx:33`; audit-log UI rendering starts in `web/src/pages/AdminDashboard.tsx:406`; workspace audit-log API calls exist in `web/src/lib/api.ts:455`; admin audit routes query audit rows in `api/src/routes/admin/audit-logs.ts:17`; workspace audit routes query audit rows in `api/src/routes/workspaces/audit-logs.ts:19`.
> Recommended reuse path: reuse existing settings/admin UI patterns for OAuth app list/create, shown-once secret display, audit browsing, and basic table/filter interactions. Reuse public API/service paths for webhook subscriptions, delivery logs, replay, and public audit views.
> Gap/new work: OAuth app portal pages, secret rotation UX, webhook subscription UI, delivery log UI, DLQ view, replay action, public audit filters, and portal routes backed by public/service paths.
> Do not overclaim: API-token UI proves credential-management patterns, not OAuth app registration or webhook portal functionality.

> Additive implementation note: rate limiting.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: Express rate limiting is already configured in `api/src/app.ts:193` for login and `api/src/app.ts:204` for general API traffic, then mounted for `/api/` in `api/src/app.ts:261`; AI analysis has a separate in-memory user limiter in `api/src/services/ai-analysis.ts:80`; collaboration has connection/message limiters in `api/src/collaboration/runtime-state.ts:83` and `api/src/collaboration/runtime-state.ts:98`.
> Recommended reuse path: reuse only the middleware placement and in-memory limiter experience; implement a Plugforge-specific token-bucket limiter for `/api/v1` keyed per OAuth app and access token.
> Gap/new work: token bucket data structure, app/token bucket keys, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`, public `rate_limited` `ApiError`, and 100% header fitness tests.
> Do not overclaim: existing `express-rate-limit` is global/IP-style and configured with `legacyHeaders: false`; it is not the required per-app/per-token public API limiter.

> Additive implementation note: public audit trail.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: audit insertion is centralized in `api/src/services/audit.ts:16` and writes to `audit_logs` in `api/src/services/audit.ts:33`; audit rows preserve actor-null cases via `api/src/db/migrations/009_audit_logs_nullable_actor.sql:1`; user deletion preserves audit rows via `api/src/db/migrations/036_fix_audit_and_comments_fks.sql:12`; API-token create/revoke already audit in `api/src/routes/api-tokens.ts:111` and `api/src/routes/api-tokens.ts:228`.
> Recommended reuse path: either extend audit logging or add a public API audit table/service that records one row per `/api/v1` request, then expose it through the developer portal.
> Gap/new work: request id, route template, method, app `client_id`, user id, token/grant id, required scope, status, latency, rate-limit result, and error code for every public API call.
> Do not overclaim: existing audit logs record selected actions, not every public API call and not the Plugforge public audit schema.

### Required Contract

- Public API rate limits must be token-bucket limits per app and per token. Source: Plugforge-specs.txt lines 179-181, Core Technical Requirements > Rate Limit Enforcement.
- Public responses must carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. Source: Plugforge-specs.txt lines 179-181, Core Technical Requirements > Rate Limit Enforcement.
- `429` responses must carry `Retry-After`. Source: Plugforge-specs.txt lines 179-181, Core Technical Requirements > Rate Limit Enforcement.
- Every public API call must be recorded with timestamp, app `client_id`, `user_id`, route, scope used, status, and latency. Source: Plugforge-specs.txt lines 183-184, Core Technical Requirements > Public Audit Trail.
- Public audit trail must be queryable in the developer portal. Source: Plugforge-specs.txt lines 183-184, Core Technical Requirements > Public Audit Trail.
- Developer portal must be in-app UI. Source: Plugforge-specs.txt lines 186-188, Core Technical Requirements > Developer Portal.
- Developer portal must list apps. Source: Plugforge-specs.txt lines 186-188, Core Technical Requirements > Developer Portal.
- Developer portal must support registering apps. Source: Plugforge-specs.txt lines 186-188, Core Technical Requirements > Developer Portal.
- Developer portal must support viewing or rotating `client_secret`, with the secret shown once. Source: Plugforge-specs.txt lines 186-188, Core Technical Requirements > Developer Portal.
- Developer portal must support managing subscriptions. Source: Plugforge-specs.txt lines 186-188, Core Technical Requirements > Developer Portal.
- Developer portal must support browsing delivery log. Source: Plugforge-specs.txt lines 186-188, Core Technical Requirements > Developer Portal.
- Developer portal must support replaying failed deliveries. Source: Plugforge-specs.txt lines 186-188, Core Technical Requirements > Developer Portal.
- Developer portal webhook subscriptions, delivery logs, replay, and audit views must reuse the public API/service path used by external clients. Source: User decision; Plugforge-specs.txt lines 442-445, Technical Stack > Frontend.
- Developer portal OAuth app creation and client-secret rotation may use session-auth bootstrap endpoints because those actions create credentials needed to use the public API. Source: User decision; Plugforge-specs.txt lines 442-445, Technical Stack > Frontend.

### Required Tests / Proof

- DLQ test must verify the failed delivery is visible in the developer portal. Source: Plugforge-specs.txt lines 210-212, Testing Scenarios.
- Replay test must click replay against a now-healthy subscriber and verify replay succeeds with the original idempotency key intact. Source: Plugforge-specs.txt lines 210-212, Testing Scenarios.
- Public API responses must include rate-limit headers 100% of the time. Source: Plugforge-specs.txt lines 232-233, Performance Targets.

### Open Decisions

- Whether old client secrets are immediately invalidated on rotation or allowed during a grace period is open. Source: Plugforge-specs.txt lines 757-758, Pre-Search Checklist > Phase 2 > Developer Portal & Self-Service.
- Whether webhook payloads are shown full, redacted, or click-to-reveal is open. Source: Plugforge-specs.txt lines 761-762, Pre-Search Checklist > Phase 2 > Developer Portal & Self-Service.
- Delivery-log UI scaling approach is open. Source: Plugforge-specs.txt lines 759-760, Pre-Search Checklist > Phase 2 > Developer Portal & Self-Service.
- Audit-log retention window is open. Source: Plugforge-specs.txt lines 812-818, Pre-Search Checklist > Phase 3 > Observability of API Usage.

## Agent-as-Citizen and AI Cost Analysis

### Source

- Agent rewire appears in Background. Source: Plugforge-specs.txt lines 20-25, Background.
- `AI Cost Analysis` is a heading inside `Plugforge-specs.txt`, not a separate document. Source: User decision; Plugforge-specs.txt lines 388-432, AI Cost Analysis.
- Critical guidance states the platform must not invoke the LLM. Source: Plugforge-specs.txt lines 516-517, Critical Guidance > One LLM call per agent turn.

### Additive Implementation Notes

> Additive implementation note: FleetGraph is the agent-as-citizen precedent.
> Canonical requirement unchanged.
> Reuse level: `Strong substrate`.
> Existing substrate: FleetGraph's current responsibility boundary, human gate, and cost claims are documented in `FLEETGRAPH.md:7`; trigger model is documented in `FLEETGRAPH.md:91`; deterministic-first/cost-avoidance rationale is documented in `FLEETGRAPH.md:143`; cost lanes and runtime model accounting are documented in `FLEETGRAPH.md:176`; model-call guardrails are documented in `FLEETGRAPH.md:204`; no-candidate worker ticks spending zero model tokens are documented in `FLEETGRAPH.md:284`; FleetGraph system principal type exists in `api/src/security/principal.ts:32`; capability handling for `fleetgraph_system` is in `api/src/security/capabilities.ts:269`; worker execution already uses that principal in `api/src/fleetgraph/execution/worker.ts:237`; proof scripts are wired in `package.json:68`.
> Recommended reuse path: keep FleetGraph's current behavioral boundary, but rewire the agent's Ship reads/writes through first-party OAuth app credentials, `@ship/sdk`, `/api/v1`, scopes, rate limits, and public audit logging.
> Gap/new work: first-party OAuth app seeding, selected agent scopes, SDK-based FleetGraph client path, feature flag if needed, public API audit assertions, and proof rows showing OAuth app authentication.
> Do not overclaim: FleetGraph is currently a privileged internal/system principal path; it does not already authenticate as an OAuth app or consume Ship through the public SDK/API.

> Additive implementation note: AI cost analysis instrumentation.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: FleetGraph model invocation captures token metadata and cost metadata in `api/src/fleetgraph/model.ts:53` and `api/src/fleetgraph/model.ts:95`; zero-model metadata helpers exist in `api/src/fleetgraph/model.ts:138`; proof rendering reports graph invocation count, model calls, tokens, deterministic runs, and model cost in `scripts/fleetgraph-proof/render-markdown.mjs:56`; FleetGraph proof check is wired in `package.json:69`.
> Recommended reuse path: use FleetGraph's runtime cost accounting as the baseline for the agent-rewire cost comparison and explicitly separate platform API/webhook/portal traffic from user-initiated agent LLM turns.
> Gap/new work: before/after measurement around the public-API rewire and production projections for API calls, webhook deliveries, agent LLM calls, delivery-log retention, and audit-log retention.
> Do not overclaim: FleetGraph proof records agent runtime/model costs; it does not automatically account for all Plugforge platform traffic or CI/developer costs.

### Required Contract

- Platform itself must do zero AI work. Source: Plugforge-specs.txt lines 388-394, AI Cost Analysis.
- LLM must be invoked only on user-initiated agent turns. Source: Plugforge-specs.txt lines 388-394, AI Cost Analysis; Plugforge-specs.txt lines 516-517, Critical Guidance > One LLM call per agent turn.
- OAuth, public API, webhooks, SDK, CLI, portal, and integration traffic must not trigger LLM calls. Source: Plugforge-specs.txt lines 388-394, AI Cost Analysis; Plugforge-specs.txt lines 516-517, Critical Guidance > One LLM call per agent turn.
- Agent rewire must authenticate the Part 2 agent as a first-party OAuth app and consume the public API through the SDK. Source: Plugforge-specs.txt lines 20-23, Background; Plugforge-specs.txt lines 388-394, AI Cost Analysis.
- Agent rewire must use the same scopes, rate limits, and audit trail as external developer access. Source: Plugforge-specs.txt lines 20-23, Background.
- Cost must scale with agent activity, not platform traffic. Source: Plugforge-specs.txt lines 388-394, AI Cost Analysis.

### Required Tests / Proof

- LLM API spend during the agent rewire must be tracked per day while migrating direct service calls to SDK calls. Source: Plugforge-specs.txt lines 396-399, AI Cost Analysis > Development & Testing Costs to Track.
- The agent rewire must confirm token volume does not change. Source: Plugforge-specs.txt lines 396-399, AI Cost Analysis > Development & Testing Costs to Track.
- CI minutes for the TTFE drill must be timed on Day 1 and weekly CI bill must be budgeted explicitly. Source: Plugforge-specs.txt lines 400-401, AI Cost Analysis > Development & Testing Costs to Track.
- OAuth flow testing CI compute cost must be counted. Source: Plugforge-specs.txt lines 402-403, AI Cost Analysis > Development & Testing Costs to Track.
- OpenAPI spec generation and validation overhead in CI must be counted. Source: Plugforge-specs.txt lines 404-405, AI Cost Analysis > Development & Testing Costs to Track.
- Storage and egress for the dev portal demo must be sized at expected demo volume. Source: Plugforge-specs.txt lines 406-408, AI Cost Analysis > Development & Testing Costs to Track.
- Production cost projection must include API calls/day, webhook deliveries/day, agent LLM calls/day, and estimated monthly cost tiers. Source: Plugforge-specs.txt lines 411-421, AI Cost Analysis > Production Cost Projections.
- AI Cost Analysis must state webhook fanout ratio. Source: Plugforge-specs.txt lines 424-426, AI Cost Analysis > Include Assumptions.
- AI Cost Analysis must state agent active rate and average agent turns per active user. Source: Plugforge-specs.txt lines 427-429, AI Cost Analysis > Include Assumptions.
- AI Cost Analysis must state delivery-log and audit-log retention assumptions. Source: Plugforge-specs.txt lines 430-432, AI Cost Analysis > Include Assumptions.
- Epic 7 proof must be audit-log rows showing OAuth app authentication. Source: Plugforge-specs.txt lines 597-599, Submission Requirements.

### Open Decisions

- Exact OAuth flow used by the first-party agent is open. Source: Plugforge-specs.txt lines 764-766, Pre-Search Checklist > Phase 2 > Agent-as-Citizen Rewire.
- How the first-party agent OAuth app is seeded is open. Source: Plugforge-specs.txt lines 767-768, Pre-Search Checklist > Phase 2 > Agent-as-Citizen Rewire.
- Agent scopes are open. Source: Plugforge-specs.txt lines 769-770, Pre-Search Checklist > Phase 2 > Agent-as-Citizen Rewire.
- CI proof for old and new agent paths behind feature flag is open if feature flag is used. Source: Plugforge-specs.txt lines 771-772, Pre-Search Checklist > Phase 2 > Agent-as-Citizen Rewire.

### Explicit Non-Scope

- Do not add platform-layer AI features such as smart OAuth-scope suggestions. Source: Plugforge-specs.txt lines 516-517, Critical Guidance > One LLM call per agent turn.

## Documentation and Submission Evidence

### Source

- Architecture document requirements are specified in Required Documentation. Source: Plugforge-specs.txt lines 525-566, Required Documentation.
- Submission deliverables are specified in Submission Requirements. Source: Plugforge-specs.txt lines 570-611, Submission Requirements.
- User decision resolves the deadline conflict in favor of Sunday noon Austin/Texas time. Source: User decision; Plugforge-specs.txt lines 27-39, Project Overview; Plugforge-specs.txt lines 570-572, Submission Requirements.

### Additive Implementation Notes

> Additive implementation note: deployment and evidence substrate.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: active deployment path is Render in `DEPLOYMENT.md:3`; current Render health URLs are documented in `DEPLOYMENT.md:41`; Render services are declared in `render.yaml:1`; API service build/migrate command is in `render.yaml:6`; web static service starts at `render.yaml:69`; Render Postgres is declared in `render.yaml:96`; FleetGraph/trace env wiring exists in `render.yaml:30` through `render.yaml:65`.
> Recommended reuse path: use the existing Render API/web/Postgres pattern for the deployed Plugforge demo unless a blocker appears, then add public `/api/v1/openapi.json`, seeded grader workspace data, and seeded grader OAuth apps.
> Gap/new work: deployed public OpenAPI route, committed `docs/openapi.json`, grader OAuth app seeding, README credentials, developer portal reachability, TTFE against deployed target, and demo evidence.
> Do not overclaim: current Render deployment proves hosting substrate, not Plugforge public API/OAuth/webhook readiness.

> Additive implementation note: test and CI substrate.
> Canonical requirement unchanged.
> Reuse level: `Partial substrate`.
> Existing substrate: full local verification orchestration exists in `scripts/run-all-tests.sh:35`; API test runner exists in `scripts/run-api-tests.sh:29`; E2E sharding exists in `scripts/run-e2e-shards.sh:17`; OpenAPI strict check is in `.husky/pre-commit:13`; GitHub workflow inventory currently contains `security-probe.yml` only, with PR/push triggers in `.github/workflows/security-probe.yml:4` and Postgres service in `.github/workflows/security-probe.yml:19`.
> Recommended reuse path: wire Plugforge fitness tests into existing local scripts and add CI coverage where submission requires every-PR proof.
> Gap/new work: TTFE drill CI lane, OAuth Playwright CI lane, `/api/v1` OpenAPI/schema/scope/error/pagination fitness tests, SDK parity test, SDK size check, webhook timing tests, and integration import-boundary lint.
> Do not overclaim: existing scripts support full local verification, but the current GitHub workflow set does not yet run the full Plugforge acceptance matrix on every PR.

> Additive implementation note: architecture documentation paths.
> Canonical requirement unchanged.
> Reuse level: `Strong substrate`.
> Existing substrate: existing OpenAPI contract workflow is documented in `docs/openapi-contract.md:8`; route-adjacent schema guidance is in `docs/openapi-contract.md:28`; unified document model source of truth is in `docs/unified-document-model.md:3`; document associations are documented in `docs/unified-document-model.md:84`; agent/FleetGraph proof and cost docs live in `FLEETGRAPH.md:7`; browser storage conventions for portal UI preferences are in `docs/conventions/browser-storage.md:1`.
> Recommended reuse path: write `docs/architecture.md` by referencing these existing documents and then adding the Plugforge-specific module tree, composition root, sequence diagrams, public/internal boundary, OAuth flows, webhook pipeline, SDK surface, and agent-before/after.
> Gap/new work: `docs/architecture.md` and `docs/openapi.json` must still be authored/generated for Plugforge.
> Do not overclaim: existing docs explain Ship's current architecture; they do not satisfy the Plugforge required architecture document by themselves.

### Required Documentation

- Architecture document must be 1-2 pages and committed at `docs/architecture.md`. Source: Plugforge-specs.txt lines 525-528, Required Documentation; Plugforge-specs.txt lines 588-589, Submission Requirements.
- Architecture document must include a module layout tree for `api/src/platform/` and `sdk/`. Source: Plugforge-specs.txt lines 531-532, Required Documentation.
- Architecture document must include one sentence per module for `apps`, `oauth`, `scopes`, `ratelimit`, `webhooks`, `api/v1`, `openapi`, and `audit`. Source: Plugforge-specs.txt lines 531-532, Required Documentation.
- Architecture document must include SOLID rationale with file path references. Source: Plugforge-specs.txt lines 534-536, Required Documentation.
- Architecture document must include composition-root pseudo-code for `api/src/app.ts` wiring concrete OAuth, rate-limiter, event-bus, and webhook-deliverer implementations. Source: Plugforge-specs.txt lines 538-540, Required Documentation.
- Architecture document must include in-memory test wiring as a sibling diagram. Source: Plugforge-specs.txt lines 538-540, Required Documentation.
- Architecture document must include public/internal boundary sequence diagram showing `/api/v1/` routes calling the same domain services as internal routes, with auth/scope/audit/webhook attaching only at the public layer. Source: Plugforge-specs.txt lines 542-544, Required Documentation.
- Architecture document must include Authorization Code + PKCE sequence diagram. Source: Plugforge-specs.txt lines 546-548, Required Documentation.
- Architecture document must include Device Authorization Grant sequence diagram. Source: Plugforge-specs.txt lines 546-548, Required Documentation.
- OAuth diagrams must mark where PKCE verifier is validated and where refresh-token rotation happens. Source: Plugforge-specs.txt lines 546-548, Required Documentation.
- Architecture document must include webhook pipeline from event source to `IEventBus` to subscription matcher to signer to `IWebhookDeliverer` to retry scheduler to delivery log. Source: Plugforge-specs.txt lines 550-552, Required Documentation.
- Webhook pipeline must mark where the signature is computed and where `Idempotency-Key` originates. Source: Plugforge-specs.txt lines 550-552, Required Documentation.
- Architecture document must include SDK surface: resource clients, auth helpers, async iterators, error union, webhook verifier. Source: Plugforge-specs.txt lines 554-556, Required Documentation.
- SDK surface documentation must mark which surfaces are stable and which are pre-1.0. Source: Plugforge-specs.txt lines 554-556, Required Documentation.
- Architecture document must include agent-as-citizen before/after diagram. Source: Plugforge-specs.txt lines 558-560, Required Documentation.
- Agent diagram must show before as direct domain calls and after as OAuth app to SDK to public API to same domain services. Source: Plugforge-specs.txt lines 558-560, Required Documentation.
- Agent diagram must mark the audit-log payoff. Source: Plugforge-specs.txt lines 558-560, Required Documentation.
- Architecture document must describe failure mode for corrupted token store. Source: Plugforge-specs.txt lines 562-566, Required Documentation.
- Architecture document must describe failure mode for subscriber signing-secret rotation mid-flight. Source: Plugforge-specs.txt lines 562-566, Required Documentation.
- Architecture document must describe failure mode for queue deliverer crash. Source: Plugforge-specs.txt lines 562-566, Required Documentation.
- Architecture document must describe failure mode for OpenAPI generator boot failure. Source: Plugforge-specs.txt lines 562-566, Required Documentation.

### Submission Requirements

- GitLab repository must be public. Source: User decision; Plugforge-specs.txt lines 576-578, Submission Requirements.
- Per-slice branches must be preserved. Source: Plugforge-specs.txt lines 576-578, Submission Requirements.
- Each PR description must list which acceptance criterion the slice advances. Source: Plugforge-specs.txt lines 576-578, Submission Requirements.
- Each PR description must confirm the fitness test passed. Source: Plugforge-specs.txt lines 576-578, Submission Requirements.
- Demo video must be 3-5 minutes. Source: Plugforge-specs.txt lines 580-583, Submission Requirements.
- Demo video must show the five-line story: fresh terminal, `pnpm install @ship/sdk`, `ship login`, `ship docs create`, `ship webhooks tail`, and verified signed delivery. Source: Plugforge-specs.txt lines 580-583, Submission Requirements.
- Demo video must show developer portal replay. Source: Plugforge-specs.txt lines 580-583, Submission Requirements.
- Pre-Search document must have all three phases completed with written answers. Source: Plugforge-specs.txt lines 585-586, Submission Requirements; Plugforge-specs.txt lines 654-818, Appendix: Pre-Search Checklist.
- Saved AI conversation must be attached as a reference artifact. Source: Plugforge-specs.txt lines 585-586, Submission Requirements.
- Live OpenAPI spec must be available at `/api/v1/openapi.json` on the deployed instance. Source: Plugforge-specs.txt lines 591-592, Submission Requirements.
- Static OpenAPI copy must be committed at `docs/openapi.json`. Source: Plugforge-specs.txt lines 591-592, Submission Requirements.
- OpenAPI spec must validate against the OpenAPI schema. Source: Plugforge-specs.txt lines 591-592, Submission Requirements.
- AI Cost Analysis submission must include tracked dev spend. Source: Plugforge-specs.txt lines 594-595, Submission Requirements.
- AI Cost Analysis submission must include production projections table. Source: Plugforge-specs.txt lines 594-595, Submission Requirements.
- AI Cost Analysis submission must include explicit assumptions for webhook fanout, agent active rate, and storage retention. Source: Plugforge-specs.txt lines 594-595, Submission Requirements.
- Per-epic write-up must use before -> fix -> after -> proof. Source: Plugforge-specs.txt lines 597-599, Submission Requirements.
- Epic 6 proof must be TTFE drill passing in CI. Source: Plugforge-specs.txt lines 597-599, Submission Requirements.
- Epic 7 proof must be agent audit-log rows showing OAuth app authentication. Source: Plugforge-specs.txt lines 597-599, Submission Requirements.
- Three discoveries must be included. Source: Plugforge-specs.txt lines 601-604, Submission Requirements.
- Deployed application must have a public URL. Source: Plugforge-specs.txt lines 606-608, Submission Requirements.
- Deployed application must have a pre-registered OAuth app with read-only scopes for graders. Source: Plugforge-specs.txt lines 606-608, Submission Requirements.
- Credentials must be in the README. Source: Plugforge-specs.txt lines 606-608, Submission Requirements.
- Developer portal must be reachable. Source: Plugforge-specs.txt lines 606-608, Submission Requirements.
- OpenAPI spec must be resolvable on deployed application. Source: Plugforge-specs.txt lines 606-608, Submission Requirements.
- Social post must tag `@GauntletAI`. Source: Plugforge-specs.txt lines 610-611, Submission Requirements.
- Social post screenshot must show `ship webhooks tail` with a verified signed event arriving in real time. Source: Plugforge-specs.txt lines 610-611, Submission Requirements.

### Open Decisions

- Deployment provider is open. Source: User decision; Plugforge-specs.txt lines 471-472, Technical Stack > Deployment; Plugforge-specs.txt lines 804-810, Pre-Search Checklist > Phase 3 > Deployment & Hosting.
- How graders receive a pre-registered OAuth app without exposing tenant data is open. Source: Plugforge-specs.txt lines 804-806, Pre-Search Checklist > Phase 3 > Deployment & Hosting.
- Whether OpenAPI is served only from the live instance or also published as static docs is open beyond the required live and committed static copies. Source: Plugforge-specs.txt lines 591-592, Submission Requirements; Plugforge-specs.txt lines 807-808, Pre-Search Checklist > Phase 3 > Deployment & Hosting.
- One-command setup for graders installing the CLI against the deployed instance is open. Source: Plugforge-specs.txt lines 809-810, Pre-Search Checklist > Phase 3 > Deployment & Hosting.

## Explicit Non-Scope

- Do not use Auth0, Ory Hydra, or another external OAuth provider for final scope. Source: User decision.
- Do not use a generated raw SDK as the public developer surface. Source: User decision.
- Do not hand-write the OpenAPI spec. Source: Plugforge-specs.txt lines 59-60, MVP Requirements; Plugforge-specs.txt lines 113-115, Core Technical Requirements > OpenAPI 3.1 Spec.
- Do not add Redis, BullMQ, SQS, Upstash, or Cloudflare rate-limit rules unless a hard blocker appears and is discussed. Source: User decision.
- Do not add platform-layer AI features to OAuth, public API, webhooks, SDK, CLI, portal, or integrations. Source: Plugforge-specs.txt lines 388-394, AI Cost Analysis; Plugforge-specs.txt lines 516-517, Critical Guidance > One LLM call per agent turn.
- Do not let integrations import `api/src/*`. Source: Plugforge-specs.txt lines 518-520, Critical Guidance > External integrations import only @ship/sdk.
- Do not let `/api/v1/*` routes import internal handler files. Source: Plugforge-specs.txt lines 103-104, Core Technical Requirements > Public API Boundary.
- Do not make the in-process plugin runtime part of final scope. Source: User decision; Plugforge-specs.txt lines 366-368, Implement at Least 5 of the Following Integrations / Flows.
- Do not expand beyond the selected integrations/flows until required scope is complete. Source: User decision.
