# Decision Log

Durable choices made during the audit/improvement work. This file exists so we can defend why structural decisions were made, what they do not claim, and what future work must preserve.

## 2026-05-21: Full-Content Search Product Pass

### D016: Content Search Gets Its Own Endpoint And Derived Index

Status: Accepted

Decision: Keep `/api/search/documents` title-only for command-palette lookup, and add `/api/search/content` as the user-facing full-content document search endpoint. `/docs` uses `/api/search/content`. The searchable index lives in `document_search_index` as derived, rebuildable state with weighted `tsvector` data: title `A`, selected properties `B`, TipTap body text `C`.

Why: The product needed real document content search, but broadening the command-palette endpoint would blur two different jobs: fast navigation by title versus ranked content discovery. A derived Postgres full-text index gives visibility-aware search without adding an external search service or making indexed text a new source of truth.

Alternatives considered: Reuse `/api/search/documents`; query `documents.content::text ILIKE`; add an external search engine. Reusing the endpoint breaks the command-palette contract. `ILIKE` over JSON content is neither ranked nor performance-evidence friendly. An external engine is unnecessary until Postgres full-text search is proven insufficient.

Consequences: Search writes must keep the index fresh after REST document create/update and collaboration persistence, and repair/backfill scripts must be able to rebuild it from source documents. Visibility filtering stays in SQL before `LIMIT`: workspace-visible docs, creator-owned private docs, or admin-visible docs. Archived and deleted documents stay excluded.

Evidence: Implementation added migration `038_document_search_index.sql`, fresh-schema bootstrap support, TipTap/property extraction utilities, `/api/search/content`, OpenAPI schema registration, API tests, `/docs` UI integration, `search:reindex`, and benchmark/query-count/EXPLAIN coverage for content search. Focused DB-backed search tests passed: `src/routes/search.test.ts` 26/26. Content-search query-count evidence is `test-results/perf/query-count-api-2026-05-21T15-33-21-438Z.json`; EXPLAIN evidence is `test-results/perf/explain-performance-2026-05-21T15-33-25-144Z.json` and shows `document_search_index_vector_idx` bitmap index scans; bounded benchmark evidence is `test-results/benchmarks/content-search-api-2026-05-21T15-35-00.json`.

**Decision Gist**: Full-content document search is a distinct product endpoint backed by a derived Postgres full-text index; command-palette search remains title-only.

### D017: Authenticated Route Context Replaces New Non-Null Assertions

Status: Accepted

Decision: Add `getAuthenticatedRouteContext(req)` and use it in newly touched authenticated routes instead of adding more `req.userId!` / `req.workspaceId!` assertions.

Why: Auth middleware does attach those fields, but repeated non-null assertions smear the boundary across route code. A small helper keeps the invariant explicit without a broad route rewrite.

Alternatives considered: Leave assertions in place; globally type `authMiddleware` to refine `Request`; rewrite all authenticated routes. Leaving assertions continues drift. A global Express type refinement is not reliable through middleware composition. A repo-wide rewrite is churnier than the current need.

Consequences: New or touched authenticated routes should prefer the helper. Existing assertions can be retired opportunistically when a route is already being changed.

Evidence: `api/src/routes/search.ts` now uses the helper, and `pnpm --filter @ship/api type-check` passes.

**Decision Gist**: Newly touched authenticated routes should acquire user/workspace ids through a route-context helper, not scattered non-null assertions.

## 2026-05-20: Submission-Gated Foundation Pass

### D001: Bootstrap Is An App-Shell Hydration Boundary

Status: Accepted

Decision: Add `GET /api/bootstrap` as a read-only authenticated endpoint for app-shell data currently fetched by startup providers. The web app seeds existing TanStack Query keys from the bootstrap payload instead of replacing the underlying page-level APIs.

Why: The source-of-truth submission gates require measured performance and database-query evidence. Before optimization work can be credible, the app needs a single, explicit place to reduce cold protected-route request fanout without changing document/product semantics. Seeding existing query keys keeps this conservative: pages still own their normal APIs, while bootstrap reduces duplicate startup fetches.

Alternatives considered: Leave startup fanout as-is and optimize individual list endpoints later; replace page APIs with a broader bootstrap-only data model. The first option does not create leverage for Category 4 measurement. The second option is too invasive and would make bootstrap a new source of product truth.

Consequences: `/api/bootstrap` must stay projection-aligned with the underlying list endpoints for visibility, document associations, project status inference, and standup status semantics. The client seeds existing TanStack Query keys and lets `staleTime`/invalidation govern freshness; it does not force `refetchOnMount: 'always'` after bootstrap hydration. If a list endpoint changes, bootstrap is a contract-drift candidate and should be tested.

Evidence: Focused bootstrap/search/visibility/boundary tests pass against `ship_test_audit`; at the time, `IMPROVEMENT_REPORT.md` kept Category 3 and 4 measurement as `TBD` until before/after benchmark and query-count evidence existed. D014 later added flow-level query-count evidence for the bootstrap app-shell flow.

**Decision Gist**: `/api/bootstrap` preloads existing startup data in one authenticated request to reduce app-shell fanout without replacing normal page APIs as the source of truth.

### D002: Document Search Is Title-Only For Command Palette

Status: Superseded in part by D016

Decision: Implement `/api/search/documents` as title-only, metadata-only search for command-palette navigation. Do not claim or imply full-text document content search from that endpoint. At the time, `/docs` search remained client-side title filtering.

Why: The audit found a false OpenAPI full-text search contract. The submission-gated plan needed to stop command palette from fetching all documents, but full-text content search is a larger product and indexing decision. Title-only search solves the immediate fanout issue without inventing search semantics the product has not chosen.

Alternatives considered: Remove `/search/documents` entirely; implement full-text search now; replace `/docs` search with server search. Removing it preserves honesty but does not reduce command-palette fanout. Full-text search now risks scope creep and unmeasured ranking/security decisions. Replacing `/docs` search changes user-facing behavior beyond the command-palette requirement.

Consequences: Search docs and OpenAPI must call this endpoint title-only. D016 later added full-content search as the distinct `/api/search/content` endpoint with visibility, indexing, ranking, and measurement rails.

Evidence: Focused search tests cover auth, title-only behavior, type filtering, limits, and visibility. `discovery-research-log.md` marks the old false full-text contract as partially resolved.

**Decision Gist**: `/api/search/documents` remains title-only command-palette search; full-content search lives separately at `/api/search/content`.

### D003: Runtime Boundary Schemas Are The Primitive Contract Source

Status: Accepted

Decision: Shared primitive API concepts such as document type, document visibility, belongs-to relationship type, issue state/priority/source, and accountability type should come from `api/src/schemas/document-boundary.ts` and be reused by route validators and OpenAPI schemas.

Why: The audit repeatedly found contract drift between shared types, route-local Zod schemas, database enums, and generated OpenAPI. Duplicated enum literals are cheap until they drift; at this foundation layer drift creates fake-green tests and broken generated clients.

Alternatives considered: Keep route-local schemas and rely on tests; move all domain schema into `@ship/shared`; introduce a broad mapper/refactor pass. Route-local schemas have already drifted. Moving every runtime validator into shared is too broad for this pass. A broad mapper rewrite would create more risk than leverage.

Consequences: SQL projection row types can stay local, but durable API/domain primitive values should not be re-declared in route files or OpenAPI files. Drift tests should compare shared values, runtime Zod values, database enum values, and OpenAPI values for high-risk primitives.

Evidence: `api/src/schemas/document-boundary.test.ts` covers document type drift across shared/runtime/OpenAPI/database, and route/OpenAPI schemas now reuse boundary primitives in high-risk paths.

**Decision Gist**: Shared API primitive values live in `document-boundary.ts` so routes, OpenAPI, shared types, and database enums stop drifting apart.

### D004: Current `schema.sql` And Numbered Migrations Must Coexist

Status: Accepted for current repo shape

Decision: Treat `api/src/db/schema.sql` as the current bootstrap schema for fresh databases, while making numbered migrations idempotent when they add structures already present in `schema.sql`.

Why: The project currently runs `schema.sql` first and then numbered migrations. Fresh Docker-backed databases exposed multiple split-brain failures where `schema.sql` already contained later-era objects and pending migrations attempted to create or rename them again. Making these migrations idempotent preserves fresh bootstrap and existing-database upgrade paths without rewriting the migration system mid-pass.

Alternatives considered: Stop running `schema.sql` before migrations; remove later-era objects from `schema.sql`; mark migrations as applied after schema bootstrap. All three are larger migration-system decisions with higher data-risk. The conservative fix is to make duplicate-structure migrations tolerate the current bootstrap schema.

Consequences: New migrations that add objects also present in `schema.sql` must use `IF NOT EXISTS`, conditional `DO` blocks, or equivalent checks. This is not a permanent endorsement of the current migration architecture; it is the current operating rule until the repo chooses a cleaner bootstrap/migration model.

Evidence: Docker-backed `ship_dev` and sidecar `ship_test_audit` migrations now complete after idempotency fixes to `010_oauth_state.sql`, `025_prevent_circular_parent.sql`, `033_sprint_to_week_rename.sql`, and `035_add_comments.sql`.

**Decision Gist**: `schema.sql` remains the fresh-database bootstrap path for now, while migrations are made idempotent where they overlap with it.

### D005: Raw E2E Is Guarded; The Safe Runner Is Canonical

Status: Accepted

Decision: Make raw `pnpm test:e2e` fail closed with guidance. Use `pnpm test:e2e:run` as the canonical E2E command. Keep `pnpm test:e2e:raw` as the internal raw Playwright path used by `scripts/run-e2e.sh`.

Why: The audit identified raw Playwright output as a fake-green/fake-signal rail: it can flood output, hide failures, and make Codex sessions unstable. The source-of-truth wants defensible evidence, so E2E must run through the controlled runner that tracks progress and final status.

Alternatives considered: Leave raw Playwright available and rely on discipline; rename existing scripts without a guided failure. Discipline is too weak for a repeated operational footgun. A guided failure makes the correct path discoverable.

Consequences: Documentation, memory, and future agents must treat `pnpm test:e2e:run` as the entrypoint. Raw Playwright should only be used deliberately through `test:e2e:raw` when investigating runner internals.

Evidence: `pnpm test:e2e` exits nonzero with runner guidance; `pnpm test:e2e:run -- --list` previously listed the suite through the controlled path.

**Decision Gist**: Raw `pnpm test:e2e` is intentionally blocked, and `pnpm test:e2e:run` is the canonical E2E evidence path.

### D006: OpenAPI YAML Must Be Tool-Valid, Not Just Generated

Status: Accepted

Decision: The OpenAPI generator formats YAML with Prettier so `api/openapi.yaml` is valid for stricter YAML tooling, not merely accepted by one parser.

Why: Generated contracts are evidence artifacts. A YAML file that looks generated but fails common tooling is a contract rail failure. Since Prettier is already a project dependency, using it in generation avoids hand-formatting generated output.

Alternatives considered: Keep JSON as the only authoritative artifact; manually run Prettier after generation; add a new YAML dependency. JSON-only would leave a broken advertised artifact. Manual formatting is easy to forget. A new YAML dependency is unnecessary because Prettier is already available.

Consequences: `openapi:generate` now has an async generation path and depends on the existing Prettier package. Verification should include JSON parse, YAML parse, and `pnpm exec prettier --check api/openapi.yaml`.

Evidence: OpenAPI JSON/YAML parse passes, and `pnpm exec prettier --check api/openapi.yaml` passes after generation.

**Decision Gist**: Generated OpenAPI YAML must be valid for normal tooling, so generation formats it with Prettier instead of producing barely-parseable output.

### D007: Explicit Database URLs Must Win During Migration

Status: Accepted

Decision: `api/src/db/migrate.ts` should not let production secret loading overwrite an explicitly provided `DATABASE_URL`.

Why: Shadow-copy and test workflows intentionally pass explicit database URLs. If production-mode secret loading can replace that URL, a shadow/test migration command can accidentally target prod. That is a high-severity operational boundary error.

Alternatives considered: Require callers to also set `ENVIRONMENT=shadow`; make shadow scripts call a separate migration script. Those can still be footguns. The invariant should live in the migration runner: explicit process input wins.

Consequences: Production secret loading remains fallback behavior only when no `DATABASE_URL` is set. Scripts that pass explicit URLs are safer and easier to reason about.

Evidence: Rails/DB review found and fixed the risk in `migrate.ts`; shell scripts passed syntax validation.

**Decision Gist**: An explicitly provided `DATABASE_URL` must always win during migrations so test/shadow workflows cannot be silently redirected to production.

### D008: API Benchmark Harness Is The Measurement Rail

Status: Accepted

Decision: Add `pnpm benchmark:api` backed by `scripts/benchmark-api.mjs` as the repeatable API benchmark runner. The runner logs in with fixed benchmark credentials, exercises fixed high-value endpoints including `/api/bootstrap`, supports controlled duration/concurrency/rate settings, writes JSON output, and exits nonzero on request failures or non-2xx responses.

Why: Category 4 performance claims are only defensible if the measurement path is repeatable. Ad hoc curl timing or browser impressions are too easy to cherry-pick and too hard to compare before/after. A small repo-local runner gives us a stable measurement rail without adding a new dependency or external service.

Alternatives considered: Use manual curl loops; add a full load-testing framework; defer performance measurement until after feature work. Manual loops are not evidence. A full framework is more tool than this submission pass needs. Deferring measurement recreates the audit problem: claims before proof.

Consequences: Benchmark results are evidence artifacts, not product behavior. Endpoint lists, default credentials, concurrency, rate cap, and output path are now part of the measurement contract and should be changed deliberately. Claims in docs should remain `TBD` until this runner or a stronger measurement path has produced before/after data.

Evidence: `package.json` exposes `benchmark:api`; `scripts/benchmark-api.mjs` writes JSON under `test-results/benchmarks/` by default and fails on non-2xx/fetch failures.

**Decision Gist**: `pnpm benchmark:api` is the repeatable API measurement rail for performance claims, with fixed endpoints, auth, rate/concurrency controls, and JSON output.

### D009: Shadow Database Copy Must Fail Closed

Status: Accepted

Decision: Shadow database copy scripts must stop on schema reset, restore, or verification failures. They should use `ON_ERROR_STOP=1`, capture restore logs, suppress only noisy notices, verify copied row counts, and avoid printing success before verification passes.

Why: The audit found a dangerous fake-green path: a script could drop the target schema, fail restore, and still continue as if shadow was refreshed. That is worse than no automation because it gives confidence while destroying the test surface needed for submission evidence.

Alternatives considered: Keep warnings for count mismatches; rely on manual inspection of restore output; only fix the local copy path. Warnings are too weak after destructive schema reset. Manual inspection is not a guardrail. Fixing only one path leaves the SSM copy flow with the same failure mode.

Consequences: Shadow refresh is stricter now. Some copies that used to limp forward will fail loudly, and that is intentional. If migrations legitimately change row counts, the script should be updated with an explicit verification rule instead of downgrading restore or schema failures back to warnings.

Evidence: `scripts/copy-db-to-shadow.sh` and `scripts/copy-db-via-ssm.sh` now fail on schema reset/restore errors and require users/documents counts to match before reporting success.

**Decision Gist**: Shadow database copy scripts must fail closed on reset, restore, or verification errors instead of printing fake success after a broken refresh.

### D010: Evidence Runs Must Separate Measurement From Claims

Status: Accepted

Decision: Add `pnpm evidence:run` and `pnpm evidence:compare` as repo-local submission evidence rails. Collectors write raw measurements and artifacts under `my-docs/evidence-runs/<run-id>/`, while claim status is recorded separately as `met`, `failed`, or `not_measured`.

Why: The source-of-truth requires proof: before/after benchmarks, query counts, EXPLAIN output, tests, accessibility reports, and runtime evidence. Prior reports sometimes had useful work recorded beside `TBD` proof gaps. A runner that separates collection from claim evaluation makes overclaiming harder and keeps evidence repeatable.

Alternatives considered: Keep using ad hoc shell snippets; build one large all-or-nothing submission script. Ad hoc snippets are too easy to lose or compare incorrectly. A large monolith would be brittle and would hide which evidence lane failed. Small collectors keep the design modular and let incomplete lanes report `not_measured` honestly.

Consequences: Evidence artifacts are now part of the submission workflow and may be tracked when they support proof. The runner must remain read-only by default and must not regenerate tracked contracts unless explicitly asked. New collectors should report missing prerequisites as `not_measured`, not as a fake pass.

Evidence: `pnpm evidence:run -- --phase final-review --run-id codex-final-review` writes artifacts under `my-docs/evidence-runs/codex-final-review/`; its manifest is correctly failed because the nested `openapi.prettier.json` claim is failed, while incomplete proof lanes remain `not_measured`. `pnpm evidence:compare codex-final-check codex-final-review` passes and writes comparison artifacts under the final-review run directory.

**Decision Gist**: Evidence collection is modular and claim-aware, so proof gaps stay visible instead of becoming prose claims.

### D011: Performance Measurement Rails Precede Performance Claims

Status: Accepted

Decision: Add idempotent audit-load seeding, query-count capture, and EXPLAIN capture scripts before making Category 3 or Category 4 improvement claims.

Why: `/api/bootstrap` is a strong app-shell fanout foundation, but it does not by itself satisfy the Category 3 endpoint P95 requirement. Category 3 requires identical-condition endpoint benchmarks, and Category 4 requires query-count or slow-query proof. Measurement rails must exist before optimization claims are credible.

Alternatives considered: Claim bootstrap as an API latency win; optimize endpoints first and measure afterward. Bootstrap is a flow/fanout improvement, not a direct endpoint P95 reduction. Optimizing before fixed measurement recreates the audit problem.

Consequences: Category 3 remains incomplete until before/after endpoint P95 results meet the source requirement under identical data volume, concurrency, and hardware. D014 later captured Category 4 flow-level query-count proof for bootstrap. `ship_dev` remains the runtime/performance database, while `ship_test_audit` remains the destructive test database.

Evidence: `node --check scripts/seed-audit-load.mjs`, `node --check scripts/query-count-api.mjs`, and `node --check scripts/explain-performance.mjs` pass; the scripts are exposed through `pnpm perf:seed-audit-load`, `pnpm perf:query-count-api`, and `pnpm perf:explain`. `seed-audit-load` is workspace-scoped and tops up tagged issue documents, users/person docs, sprints, and audit logs. Closeout artifacts were written to `test-results/perf/query-count-api-2026-05-20T23-37-27-346Z.json` and `test-results/perf/explain-performance-2026-05-20T23-37-37-930Z.json`.

**Decision Gist**: Performance work now has measurement rails; Category 3 still needs endpoint P95 proof, while Category 4 has later flow-level query-count proof in D014.

### D012: Backlinks Offline State Is Degraded, Not Dead

Status: Accepted

Decision: When backlink polling fails or the browser goes offline, preserve the last successful backlinks, show an accessible stale/offline status, pause polling while offline, retry on reconnect, and avoid repeated console-error spam.

Why: The audit found Backlinks as a console-only runtime failure during disconnects. Treating the panel as a degraded surface keeps the document usable and tells users whether relationship context may be stale.

Alternatives considered: Keep the existing red error state; hide the panel while offline; add a broad global offline system first. A red dead-end discards useful stale context. Hiding the panel loses information. A global offline system is larger than the current source-required fix.

Consequences: Backlinks can display stale data with an explicit status. This improves runtime behavior but does not complete Category 6 until before/after screenshot or recording evidence is captured.

Evidence: `pnpm --filter @ship/web exec vitest run src/components/editor/BacklinksPanel.test.tsx src/components/editor/CommentMark.test.ts` passes.

**Decision Gist**: Backlinks keep useful stale context and expose degraded state instead of failing silently or noisily.

### D013: Closeout Accessibility Runs Stay Report-First Until Known Debt Is Fixed

Status: Accepted

Decision: Use `pnpm a11y:closeout` as a repeatable Playwright/axe reporter for `/docs`, a real `/documents/:id`, and `/my-week`. Keep it non-blocking by default, with `-- --fail-on-serious` available when the known contrast debt is resolved and the team wants a hard gate.

Why: The manual closeout found real product/a11y signals, but some are currently known failures. A report-first runner saves manual effort without making the normal E2E lane fail on already-known debt.

Consequences: Category 7 can be remeasured quickly, and the report can become a gate when serious violations are resolved. Later closeout evidence showed the `--fail-on-serious` gate passing on `/docs`, a selected document page, and `/my-week`; Lighthouse remains unrereun.

Evidence: `pnpm a11y:closeout` writes `test-results/a11y-closeout/axe-summary.json` and screenshots.

**Decision Gist**: Automate the repeatable accessibility scan now; turn it into a blocker only after the known violations are gone.

### D014: Flow Query Counts Are The Bootstrap Proof Unit

Status: Accepted

Decision: Extend `pnpm perf:query-count-api` so it measures named user flows in addition to individual endpoints. Use the protected docs startup app-shell flow as the Category 4 proof unit for bootstrap: old fanout is `/api/auth/me`, wiki documents, programs, projects, issues, standup status, and action items; current behavior is `/api/bootstrap`.

Why: `/api/bootstrap` is designed to reduce request fanout and repeated authenticated list/status work. Endpoint-only measurements can show that `/api/bootstrap` is heavier than any one old endpoint, but that is the wrong comparison. The unit that matters is the startup flow it replaces.

Alternatives considered: Keep endpoint-only query counts; use browser network traces only; optimize bootstrap payload bytes first. Endpoint-only counts understate the benefit. Browser traces are useful but less repeatable for SQL counts. Payload bytes were not the bottleneck in the measured run: current bootstrap was only 79 bytes larger than old fanout against the same data.

Consequences: Future bootstrap changes must preserve flow-level evidence, not just endpoint rows. Category 3 P95 claims still require `pnpm benchmark:api` or stronger before/after latency evidence. Category 4 query-count claims can use the named flow aggregate when run under the same database, user, process, and hardware.

Evidence: `test-results/perf/query-count-api-2026-05-21T02-15-44-061Z.json` measured old protected docs startup fanout at 7 requests, 33 SQL queries, 984,044 response bytes, and 32 ms total elapsed. Current `/api/bootstrap` measured 1 request, 24 SQL queries, 984,123 response bytes, and 17 ms total elapsed. That is -9 queries / -27.3% and requests 7 -> 1 / -85.7% for the flow. `test-results/perf/explain-performance-2026-05-21T02-16-39-379Z.json` records current EXPLAIN output; no slow-query improvement is claimed.

**Decision Gist**: Bootstrap performance proof is flow-level query-count evidence, not a one-endpoint comparison.

### D015: Issue Lists Are Metadata Projections

Status: Accepted

Decision: Keep `GET /api/issues` and `/api/bootstrap` issue data as metadata-only list projections. They do not select or return TipTap `content`, and they omit absent optional fields such as missing ticket numbers, assignees, estimates, rejection reasons, and accountability fields. Issue detail routes continue to return editor content.

Why: Audit-scale data made issue payloads dominate both `/api/issues` and `/api/bootstrap`. List and app-shell views render titles, state, priority, associations, and small metadata; shipping full editor JSON and null-heavy fields through those paths adds bytes without adding user-visible value.

Alternatives considered: Keep full issue objects everywhere; optimize SQL/indexes first; make bootstrap define a separate bespoke issue shape. Full objects kept the payload bottleneck. SQL/index work was not the measured bottleneck for this lane. A bespoke bootstrap shape would create drift from the issue list contract, so the safer contract is one shared list projection.

Consequences: Frontend list, kanban, and picker surfaces must treat some issue metadata as optional. OpenAPI exposes `IssueListItem` separately from full `Issue`. Future issue-detail work must not infer that list responses contain editor content.

Evidence: Valid before benchmark `test-results/benchmarks/api-2026-05-21T02-40-19-503Z.json`; final after benchmark `test-results/benchmarks/api-2026-05-21T03-11-53-590Z.json`; payload spot check after compaction measured `/api/issues` at 307,043 bytes and `/api/bootstrap` at 429,806 bytes on the audit-load dev database. `GET /api/issues` P95 improved by 30.0% at 10c and 26.7% at 25c in the final run, while `/api/bootstrap` P95 remains mixed.

**Decision Gist**: List/app-shell issue data is a compact metadata contract; full editor content belongs on issue detail routes.

### D018: OpenAPI Is The Generated Frontend API Type Source

Status: Accepted

Decision: Use OpenAPI as the generated frontend API contract source. Generate `web/src/api/generated/ship-openapi.d.ts` from `api/openapi.json` with `openapi-typescript`, use `openapi-fetch` through `web/src/api/client.ts`, and keep legacy `apiGet`/`apiPost` helpers only as compatibility shims for uncovered or intentionally raw endpoints.

Why: Hand-maintained frontend response casts and `readJson<T>` calls made the API boundary easy to drift. A generated client makes request params, bodies, and responses flow from the same contract used for API docs and MCP-facing route registration.

Alternatives considered: Continue local frontend interfaces and casts; add runtime validation first; migrate all frontend calls immediately. Local casts recreate the current drift. Runtime validation is a valuable future 10x option, but it is larger and does not replace compile-time contract generation. Immediate broad migration is unsafe because the route/spec checker currently shows incomplete and stale OpenAPI coverage.

Consequences: Route-family work that touches frontend API shape should update OpenAPI first, regenerate types, then migrate callers. `pnpm openapi:check` is report-first for now because the existing contract is incomplete; treating it as a hard gate would block on pre-existing drift. Use `pnpm openapi:check -- --strict` when a route-family pass is ready to make coverage blocking. The next 10x step is route/spec coverage enforcement, then optional runtime response validation for trust-boundary hardening.

Evidence: `pnpm openapi:generate` writes `api/openapi.json`, `api/openapi.yaml`, and `web/src/api/generated/ship-openapi.d.ts`. `pnpm openapi:check` reports 195 runtime routes, 121 OpenAPI operations, 82 missing, and 8 stale after fixing duplicate route mounts, path-param normalization, and the files/auth route families on 2026-05-21. `pnpm type-check` passes after the first typed-client migrations.

**Decision Gist**: OpenAPI is now the frontend API type source, but coverage debt must be closed before broad generated-client migration.

### D019: Runtime Response Validation Waits For Honest Route Coverage

Status: Accepted

Decision: Do not add production runtime response validation as the next blanket move. Use test-time response validation first: selected integration tests should assert that runtime JSON responses match the same Zod schemas that generate OpenAPI. Close OpenAPI coverage for each migrated route family before making that family strict.

Why: Runtime validation only improves trust if the schema being enforced is true. The current checker still reports 195 runtime routes, 121 OpenAPI operations, 82 runtime routes missing from OpenAPI, and 8 stale OpenAPI operations. Test-time validation catches drift without adding request-path production risk while the contract is still being cleaned up.

Alternatives considered: Add production middleware immediately; skip runtime validation entirely; migrate all frontend calls to generated types first. Immediate middleware is premature while stale/missing route coverage is known. Skipping validation leaves the trust boundary compile-time only. Broad migration first would spread generated false confidence through more UI code.

Consequences: The next API-contract 10x path is ordered: route/spec coverage, strict coverage gate, targeted test-time response validation, optional staging-only production validation, then broader generated-client migration. Runtime validators should focus on endpoints where malformed server data can silently corrupt UI state, not every low-risk read on day one.

Evidence: `api/src/test/openapi-response.ts` provides `expectOpenApiResponse`, and `api/src/routes/openapi-contract.test.ts` validates `GET /api/auth/session`, `GET /api/csrf-token`, and `POST /api/auth/login` against their registered OpenAPI component schemas. The focused DB-backed test run passed. `pnpm openapi:check` is report-only today and currently reports 82 missing routes and 8 stale operations. `web/src/api/client.ts` uses `openapi-fetch` with legacy-compatible CSRF/session/JSON behavior, but it does not perform production response validation.

**Decision Gist**: Runtime validation is valuable, but only after the OpenAPI source is honest enough to validate against.
