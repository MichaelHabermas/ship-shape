# Audit Report

---

## Executive Summary

Ship is usable under the audited local workload, and the core product direction is sound: the unified document model gives the system a coherent foundation for issues, projects, programs, sprints, people, and weekly planning. The audit did not find a product that is fundamentally broken. It found a product whose main risks are concentrated at the boundaries where that model meets production reality: API route contracts, database row mapping, frontend loading behavior, test isolation, accessibility semantics, and documentation/API alignment.

The most important pattern is boundary drift. Several high-risk files sit close to request input and database output while relying on unsafe casts, non-null assertions, and implicit shape assumptions. Search is documented differently than it is implemented. Shared document-tree UI appears in core flows but carries markup and accessibility defects. These are not random issues; they are symptoms of a system whose conceptual model is cleaner than some of its enforcement points.

Frontend performance is the largest user-facing opportunity. The audited production build ships too much JavaScript through the initial entry path, with expensive editor, collaboration, emoji, and highlighting dependencies contributing to a large main chunk. The issue is less about total app size than about load timing: users pay early for capabilities they may not use immediately.

API latency is not the primary performance concern in the local audit. Rate-aware endpoint benchmarks were mostly acceptable at the audited data volume. The more meaningful performance pressure comes from page-load fanout, repeated session writes, large list payloads, and unclear ownership of search behavior between client and server.

Data and test safety are credible but uneven. The audit used explicit runtime-load data in `ship_dev` and a separate `ship_test_audit` database for destructive checks, which is the right separation. The risk is that the codebase does not make that separation hard enough to misuse. In a system with destructive tests and local PostgreSQL workflows, accidental database targeting remains a material operational footgun.

Overall, Ship looks like a coherent product with implementation debt in the places that matter most: typed boundaries, initial-load discipline, shared UI semantics, and source-of-truth alignment. The opportunity is not to change the architecture. It is to make the existing architecture more enforceable, so the unified document model remains a strength as the system grows.

---

## Context

- Audit date/time: 2026-05-19 10:23:21 CDT.
- Code state: `5731a92a01e357b0ffb7ffa28e3319b3a14ffedf`; working tree clean.
- Environment: macOS 26.5 build 25F71; Node `v24.15.0`; pnpm `10.27.0`.
- Runtime startup: `pnpm dev` started shared TypeScript watch with 0 errors, Vite `6.4.1` at `http://localhost:5174/`, and API at `http://localhost:3000`.
- Runtime services: Yjs collaboration server attached; Events WebSocket server attached; CAIA not configured; API CORS origin `http://localhost:5174`.
- Database: `ship_dev` from `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_dev`.
- Seed/data volume after `pnpm db:migrate && pnpm db:seed`: 257 documents total (`wiki` 7, `issue` 104, `program` 5, `project` 15, `sprint` 35, `person` 11, `weekly_plan` 32, `weekly_retro` 27, `standup` 6, `weekly_review` 15); 11 users. This meets the audit target for issues and sprints/weeks, but not 500+ documents or 20+ users.
- Audit-scale data added for runtime measurement: 9 audit users, 9 audit person documents, and 250 audit wiki documents. Final runtime-audit volume: 516 documents total (`wiki` 257, `issue` 104, `program` 5, `project` 15, `sprint` 35, `person` 20, `weekly_plan` 32, `weekly_retro` 27, `standup` 6, `weekly_review` 15); 20 users. 259 documents are tagged with `properties.audit_load = true`.[^7]
- Sidecar benchmark database: `ship_test_audit` exists and is migrated. Use it only for destructive API test/coverage benchmarking and improvement checks; keep browser/runtime/performance measurements on `ship_dev`.[^4]
- Authenticated login verified with `dev@ship.local`; landing URL: `http://localhost:5174/docs`.
- Browser console after login shows one `401 Unauthorized` from `:3000/api/auth/me`, followed by successful realtime event connection and pong messages.
- Runtime flow URL note: the global Issues list is available at `http://localhost:5174/issues`; Issues are also discoverable through Programs, where each program has its own Issues tab.

---

## Category 1: Type Safety

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Explicit `any` usage was measured with the TypeScript compiler parser by counting `SyntaxKind.AnyKeyword` AST nodes.[^1]
- Type assertions were measured with the same parser approach by counting `SyntaxKind.AsExpression` AST nodes.[^1]
- Non-null assertions were measured with the same parser approach by counting `SyntaxKind.NonNullExpression` AST nodes.[^1]
- TypeScript suppression directives were counted with a targeted text scan for `@ts-ignore` and `@ts-expect-error` in the same scopes.[^2]
- Strict mode was checked in root and package TypeScript configs.
- Violation-dense files were ranked by combined production counts of `any`, `as`, non-null assertions, and TypeScript suppression directives.

**Baseline**

| Metric                                        | Value                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total `any` types                             | 278 total, 94 in production                                                                                                                                                 |
| Total type assertions (`as`)                  | 713 total, 504 in production                                                                                                                                                |
| Total non-null assertions (`!`)               | 348 total, 325 in production                                                                                                                                                |
| Total `@ts-ignore` / `@ts-expect-error`       | 1 total, 0 in production                                                                                                                                                    |
| Strict mode enabled?                          | Yes                                                                                                                                                                         |
| Strict mode error count (if disabled)         | N/A                                                                                                                                                                         |
| Top 5 violation-dense files (production only) | `api/src/routes/weeks.ts` (85), `api/src/routes/projects.ts` (51), `api/src/routes/issues.ts` (49), `web/src/pages/UnifiedDocumentPage.tsx` (37), `api/src/db/seed.ts` (35) |

**Measurement note:** The baseline counts above are the authoritative Category 1 counts because they use a TypeScript AST scan over the documented audit scope. ESLint is configured as a warning/worklist tool for the same problem area, but it is not the official denominator for the 25% reduction. After adding ESLint, `@typescript-eslint/no-explicit-any` reported 269 total / 83 production warnings, while the AST baseline reported 278 total / 94 production `any` nodes. This difference is expected because the two tools do not inspect exactly the same scope and do not count all syntactic forms identically. Use the AST counter for before/after reporting; use ESLint to find and prioritize real fixes. Type-aware ESLint rules such as `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-argument`, and `no-unsafe-return` intentionally count downstream unsafe usage, so one root `any` or unsafe cast can produce several ESLint warnings.

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** API routes are the biggest type-safety risk. The densest files are `weeks.ts`, `projects.ts`, and `issues.ts`, where unsafe casts and non-null assertions touch request data, DB rows, and API responses.
2. **High:** Raw database row mapping is too trusted. PostgreSQL results are cast into app types without much runtime validation, so schema/content drift can become runtime bugs.
3. **Medium:** Editor/document conversions are loosely typed. Yjs, TipTap JSON, and document metadata cross boundaries where the compiler cannot fully verify shape.
4. **Medium:** Non-null assertions are common in production route code, making correctness depend on nearby human reasoning instead of explicit control flow.
5. **Low:** TypeScript suppression comments are not a current production concern; only one appears, and it's in a test.

**Remediation Plan**

Add a lightweight ESLint type-safety guardrail, then clean up the highest-risk files first.

1. Add ESLint with simple root scripts: `"lint": "eslint ."` and `"lint:fix": "eslint . --fix"`.[^6]
2. Configure type-safety rules as warnings at first: no explicit `any`, no non-null assertions, no unsafe assignments/member access/arguments/returns, and no unnecessary type assertions.
3. Keep the existing AST audit counter as the measurable baseline and regression check. ESLint helps developers find issues; the audit script proves the 25% reduction.
4. Start remediation in the densest production route files: `api/src/routes/weeks.ts`, `api/src/routes/projects.ts`, and `api/src/routes/issues.ts`.
5. Replace unsafe route-boundary patterns with real narrowing: Zod-parsed `req.query` / `req.body`, typed `pool.query<T>()` rows, explicit row mapper types, and guarded access to document `properties`.
6. Treat editor/Yjs/TipTap typing as a later pass. API and database boundaries carry more production risk and will remove more meaningful violations faster.

---

## Category 2: Production Frontend Bundle Size

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Total production bundle size was measured after `pnpm build:web` by summing raw JavaScript and CSS files in `web/dist`, excluding source maps. Full `web/dist` static output, including icons/images, was also measured for context.
- Largest chunk was identified by sorting generated `web/dist/assets` JavaScript and CSS files by byte size.
- Number of chunks was measured by counting generated JavaScript and CSS files in `web/dist/assets`, excluding source maps.
- Largest dependencies were measured from Vite/Rollup production build metadata by grouping rendered `node_modules` module lengths by package. The generated report is in `my-docs/audit-evidence/category-2-bundle/bundle-treemap.html`.
- Unused dependencies were checked by comparing `web/package.json` dependencies against static imports in `web/src`, then spot-checking candidates with `rg` and the generated bundle report.
- Package manifests were also spot-checked for dependencies that may belong in `devDependencies`; `@tanstack/react-query-devtools` and `@modelcontextprotocol/sdk` need follow-up classification before moving anything.

**Baseline**

| Metric                         | Value                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Total production bundle size   | 2,262.65 KB JS/CSS (3,351.53 KB full `web/dist`)                                |
| Largest chunk                  | `assets/index-C2vAyoQ1.js` (2,025.10 KB)                                        |
| Number of chunks               | 262 JS/CSS chunks (261 JS, 1 CSS)                                               |
| Top 3 largest dependencies     | `emoji-picker-react` (399.59 KB), `highlight.js` (377.92 KB), `yjs` (264.92 KB) |
| Unused dependencies identified | `@tanstack/query-sync-storage-persister`                                        |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** The main JavaScript chunk dominates the bundle. `assets/index-C2vAyoQ1.js` is 2,025.10 KB, about 89% of the raw JS/CSS bundle, and triggers Vite's >500 KB warning.
2. **High:** Code splitting exists but is not reducing the initial bundle enough. The build emits 262 JS/CSS chunks, but most are tiny while the main app chunk remains very large.
3. **Medium:** `emoji-picker-react` and `highlight.js` are large feature-specific dependencies. They appear expensive relative to how often emoji picking or code highlighting is likely needed on initial load. `yjs` is also large, but it supports core collaboration behavior. (react-router dropped out because the earlier source-map method was counting source content differently. The Rollup metadata is the better number for this row because it reflects rendered module lengths in the actual production bundle.)
4. **Low:** `@tanstack/query-sync-storage-persister` appears unused by static import and bundle-report checks. `@uswds/uswds` was a false positive because it is used through the icon glob/generation path.

**Remediation Plan**

Reduce the initial JavaScript bundle by making expensive features load only when needed.

1. Gate `ReactQueryDevtools` behind a dev-only dynamic import so it never ships in the production entry bundle.
2. Remove the unused `@tanstack/query-sync-storage-persister` dependency if the static import and bundle checks still confirm it is unused.
3. Reclassify package manifests after checking runtime entrypoints: move `@tanstack/react-query-devtools` to `devDependencies` once it is dev-only gated, and move `@modelcontextprotocol/sdk` to `devDependencies` if `api/src/mcp/server.ts` remains a local/tooling entrypoint rather than production runtime.
4. Lazy-load `emoji-picker-react`; the picker should download only when the emoji popover opens.
5. Convert eager page imports in `web/src/main.tsx` to route-level `React.lazy` imports, especially admin, org chart, reviews, settings, and document-heavy pages.
6. Split the editor path so non-editor pages do not pay for TipTap, Yjs, ProseMirror, lowlight, or collaboration code on initial load.
7. Reduce syntax-highlighting weight by registering only needed languages or loading highlighting after the editor/code block is actually used.
8. Measure success with the same production build and bundle report, targeting at least a 20% reduction in the initial `assets/index-*.js` chunk without removing user-facing functionality.

---

## Category 3: API Response Time

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Authenticated API requests were benchmarked with session cookies captured from Chrome DevTools or created through the app's CSRF-protected login flow. Cookie validity was confirmed with `curl`, returning `200 105338` for `GET /api/documents?type=wiki`.[^10]
- Benchmarks ran against `ship_dev` with 517 documents, 104 issues, 20 users, and 35 sprints.
- “Most important” endpoints were selected by user-flow criticality, expected frequency, backend weight, and coverage of the source-of-truth product surfaces: documents, issues, project/program planning, and weekly planning.
- Flow 1, load main page (`/docs`): representative endpoint selected as `GET http://localhost:3000/api/documents?type=wiki`, because it is the main content payload for the documents page and the largest visible API response during page load.
- Final P50/P95/P99 values were measured with a custom Node HTTP harness that recorded every request duration and calculated exact percentiles. Each endpoint ran for 15 seconds at 10, 25, and 50 connections. These are local benchmarks under the source-of-truth concurrency and data-volume conditions, not production performance results.[^10]
- Flow 2, list issues (`/issues`): selected as `GET http://localhost:3000/api/issues`, because issues are a core Ship surface and this endpoint returned one of the largest observed payloads (`200 102132`).
- Flow 3, load current week (`/my-week`): selected as `GET http://localhost:3000/api/dashboard/my-week`, because `/my-week` is the default authenticated landing route and the weekly planning surface.
- Flow 4, list projects (`/projects`): selected as `GET http://localhost:3000/api/projects`, because project planning is a primary navigation surface and the endpoint is part of the `/docs` hydration fanout.
- Flow 5, program-scoped issues (`/documents/:programId/issues`): selected as `GET http://localhost:3000/api/programs/:id/issues`, because Issues are also discoverable through Programs, where each program exposes an Issues tab.
- Search was investigated but not used as a Cat 3 benchmark row: `/docs` search is client-side title filtering, `/api/search/mentions` is a title-only mention/embed helper, and the documented `/api/search/documents` route is not mounted.

**Baseline**

| Endpoint                       | P50                              | P95                                | P99                                |
| ------------------------------ | -------------------------------- | ---------------------------------- | ---------------------------------- |
| `GET /api/documents?type=wiki` | 10c: 8 ms; 25c: 8 ms; 50c: 9 ms  | 10c: 11 ms; 25c: 10 ms; 50c: 11 ms | 10c: 12 ms; 25c: 11 ms; 50c: 15 ms |
| `GET /api/issues`              | 10c: 10 ms; 25c: 9 ms; 50c: 9 ms | 10c: 13 ms; 25c: 11 ms; 50c: 11 ms | 10c: 19 ms; 25c: 15 ms; 50c: 19 ms |
| `GET /api/dashboard/my-week`   | 10c: 9 ms; 25c: 9 ms; 50c: 11 ms | 10c: 12 ms; 25c: 11 ms; 50c: 13 ms | 10c: 13 ms; 25c: 15 ms; 50c: 14 ms |
| `GET /api/projects`            | 10c: 7 ms; 25c: 8 ms; 50c: 8 ms  | 10c: 9 ms; 25c: 9 ms; 50c: 9 ms    | 10c: 11 ms; 25c: 11 ms; 50c: 11 ms |
| `GET /api/programs/:id/issues` | 10c: 7 ms; 25c: 7 ms; 50c: 8 ms  | 10c: 9 ms; 25c: 9 ms; 50c: 9 ms    | 10c: 10 ms; 25c: 10 ms; 50c: 11 ms |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Rate limiting makes naive concurrent benchmarks invalid. Uncapped `autocannon` immediately produced hundreds of thousands of non-2xx responses. The final exact-percentile pass temporarily raised the dev API rate limit, then ran the same endpoint/concurrency matrix with `0` non-2xx responses.
2. **High:** Search ownership is split and drifted. Architecture docs describe server full-text search with offline fallback, OpenAPI documents `GET /api/search/documents`, but the route is not implemented. The visible Docs search is client-side title filtering, while `/api/search/mentions` is a separate title-only helper for mentions/slash embeds.
3. **Medium:** Main list endpoints are fast under local load but payload-heavy. `GET /api/documents?type=wiki` returns about 106 KB per response; `GET /api/issues` returns about 102 KB per response.
4. **Medium:** The baseline may be too gentle to expose optimization headroom. If these numbers are used to benchmark improvements, harsher follow-up conditions may be useful: larger data volume, production-like deployment, cold-cache runs, or higher allowed request rates.
5. **Medium:** Document-view measurement is incomplete from the REST layer. Hard reload of a document page exposed backlinks only; document body loading appears to happen through cached state, frontend state, or the editor/collaboration path, so REST-only benchmarking misses part of the user-visible document-load path.
6. **Low:** Project/program planning endpoints are fast under the checked load. `GET /api/projects` stayed at 11 ms P99 at 50 connections, and `GET /api/programs/:id/issues` stayed at 11 ms P99 at 50 connections.
7. **Low:** The sprint/week endpoint is small and stable. `GET /api/dashboard/my-week` returned about 1.2 KB and stayed at 14 ms P99 at 50 connections.

**Remediation Plan**

1. Add a benchmark script that always supplies an authenticated cookie, fixed duration, fixed connection counts, and a safe `-R` cap so future measurements are comparable.
2. Either implement `GET /api/search/documents` or remove it from OpenAPI; then decide whether Docs search should stay client-side or use backend search for larger datasets.
3. Split or paginate the largest list payloads before optimizing individual SQL queries. The current bottleneck is not raw local latency; it is full-list transfer and hydration behavior.
4. Add an explicit way to measure document body load separately from backlinks, including the editor/Yjs path if that is the real source of document content.
5. Keep the app rate limit visible in perf reports. A high-throughput benchmark that mostly measures 429 responses is worse than no benchmark.

---

## Category 4: Database Query Efficiency

**Methodology (Describe how you measured it (tools, commands, methodology))**

- PostgreSQL `pg_stat_statements` was unavailable for this local server because it was not loaded via `shared_preload_libraries`, so query counts were measured with a temporary in-process API harness.
- The harness imported `createApp()` and monkeypatched `pool.query` to record SQL count and elapsed time for each request, then logged in as `dev@ship.local` and replayed the same flow endpoints used in Category 3.
- “Load main page” was measured as the observed `/docs` hydration sequence: `/api/auth/me`, `/api/weeks/my-action-items`, `/api/auth/session`, `/api/standups/status`, `/api/issues`, `/api/projects`, `/api/programs`, `/api/documents?type=wiki`, `/api/team/people?includeArchived=true`, and a second `/api/auth/session`.
- “Search content” was recorded as zero backend queries because the Docs search box did not issue a backend request.
- `EXPLAIN (ANALYZE, BUFFERS)` was run against the slow/list-driving queries behind `GET /api/documents?type=wiki`, `GET /api/issues`, `GET /api/documents/:id/backlinks`, and the weekly-plan lookup inside `GET /api/dashboard/my-week`.[^11]

**Baseline**

| User flow         | Total queries | Slowest query (ms) | N+1 detected?                                                      |
| ----------------- | ------------- | ------------------ | ------------------------------------------------------------------ |
| Load main page    | 41            | 4.00               | No row-level N+1; repeated session/auth checks across 10 API calls |
| View a document   | 5             | 0.56               | No                                                                 |
| List issues       | 5             | 1.00               | No                                                                 |
| Load sprint board | 9             | 0.57               | No                                                                 |
| Search content    | 0             | N/A                | N/A; client-side filter only                                       |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Main page load fans out into too many backend requests. The measured `/docs` hydration path made 10 API calls and 41 SQL queries before any user interaction.
2. **Medium:** Session/auth checks are repeated per API call. The main-page flow executed 10 session lookups and 10 session `last_activity` updates, adding write pressure and noise to every multi-request page load.
3. **Medium:** The largest list endpoints are single-query but payload-heavy. `GET /api/issues` and `GET /api/documents?type=wiki` did not show row-level N+1 behavior, but they return full lists with large response bodies.
4. **Medium:** The sprint/week board uses 9 queries for a small response. No N+1 was confirmed, but the query count is high relative to the 1.2 KB payload.
5. **Medium:** `EXPLAIN` shows JSON-expression filtering after broad document-type index scans for weekly-plan style lookups. At the current audit scale this is fast, but the access pattern is fragile as weekly documents grow because `(properties->>'person_id')` and `(properties->>'week_number')::int` are not covered by a purpose-built index.
6. **Low:** Docs search uses no database query because it filters client-side. That is efficient for the current loaded list, but it cannot become true full-content search without a real backend endpoint.

**Remediation Plan**

1. Reduce page-load API fanout before tuning individual SQL. Bundle related bootstrap data or rely more consistently on React Query cache hydration.
2. Avoid updating session `last_activity` on every single request in bursty page loads; throttle or coalesce the write while preserving the 15-minute inactivity policy.
3. Add pagination or server-side limits for document and issue lists before the audit-load dataset grows further.
4. Add targeted indexes for repeated JSON-property filters before the data set grows, starting with weekly-plan/person/week lookups if dashboard latency increases.
5. Implement real document search and wire `/docs` to it, or deliberately remove `/api/search/documents` from OpenAPI and update the architecture docs to say document search is client-side/title-only. The current halfway state is misleading.
6. Keep the query-count harness or replace it with proper Postgres query stats in dev, so future improvements can be checked with the same five flows.

---

## Category 5: Test Coverage and Quality

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Test inventory was measured by scanning `api/src`, `web/src`, `shared/src`, and `e2e` for `*.test.ts(x)` and `*.spec.ts(x)` files, then counting declared `test(...)` / `it(...)` cases.[^3]
- Web unit tests were run with `pnpm --filter @ship/web exec vitest run`.
- API unit tests were run with `pnpm --filter @ship/api exec vitest run` against the sidecar benchmark database (`ship_test_audit`) to avoid truncating local application data.[^4]
- E2E test count was measured with `npx playwright test --list` from the `e2e/` directory, which enumerates every test the runner would execute.[^5]
- E2E tests were later run locally through the controlled background/polling runner shape, with Docker/Testcontainers enabled and Playwright Chromium installed.[^5-e2e-run]
- Flaky test detection: both API and web suites were run 3× each; any test that changed pass/fail status across runs was flagged as flaky.
- API code coverage was measured by temporarily installing `@vitest/coverage-v8@4.0.17` (matching the project's `vitest@4.0.17`) and running `pnpm --filter @ship/api exec vitest run --coverage` against `ship_test_audit`. The dependency was removed after measurement.
- Web coverage was checked in `web/vitest.config.ts`; no coverage provider is configured.

**Baseline**

| Metric                            | Value                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Total tests                       | 1,471 executable tests across 115 files (451 API in 28 files, 151 web in 16 files, 869 E2E in 71 files)                  |
| Pass / Fail / Flaky               | API unit: 451 / 0 / 0; Web unit: 138 / 13 / 0; E2E full run: 851 / 1 / 5 retry-flake signals, with 17 skipped            |
| Suite runtime                     | API unit: 10.76s; Web unit: 1.05s                                                                                        |
| Critical flows with zero coverage | None obvious by file inventory for document CRUD, auth, collaboration, issues, weeks, search, accessibility, or security |
| Code coverage % (if measured)     | API: 40.34% statements, 33.44% branches, 40.9% functions, 40.52% lines; Web: not configured                              |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Web unit tests are failing: 13 of 151 failed, in `document-tabs.test.ts` (9), `DetailsExtension.test.ts` (3), and `useSessionTimeout.test.ts` (1). These are assertion mismatches against changed implementation (e.g., tab configs, TipTap extension content schema), not environmental failures.
2. **High:** The full E2E run has one final failure: `e2e/inline-comments.spec.ts:118` (`canceling a comment removes the highlight`). The canceled comment leaves `.comment-highlight` visible after cancel.
3. **High:** API code coverage is 40% across the board. Route files for `programs.ts` (5%), `dashboard.ts` (2%), `weekly-plans.ts` (5%), and `comments.ts` (9%) have near-zero coverage despite being production endpoints.
4. **Medium:** E2E retry logs show five flake signals that passed on retry: bulk selection strict locator ambiguity, feedback consolidation missing external row, `/my-week` stale-data visibility timeouts, project week navigation link timeout, and weekly accountability returning `null` where a person/document id was expected.[^5-e2e-run]
5. **Medium:** Web has no coverage measurement configured. `web/vitest.config.ts` has no `coverage` block; adding `@vitest/coverage-v8` with a `provider: 'v8'` config would enable it.
6. **Medium:** API test safety requires the sidecar benchmark database. `api/src/test/setup.ts` runs `TRUNCATE ... CASCADE` on `documents`, `users`, `workspaces`, `audit_logs`, and other tables. Running `pnpm test` from root will destroy local development data unless `DATABASE_URL` points to `ship_test_audit` or another disposable database.
7. **Low:** No flaky tests detected across 3 repeated runs of both API and web suites.

**Remediation Plan**

Restore trust in the test system before expanding it.

1. Fix the 13 failing web unit tests and the final E2E inline-comment cancellation failure so the normal test gates are green.
2. Triage the five E2E retry-flake signals; either harden the selectors/waits or convert unstable assumptions into deterministic fixture setup.
3. Add a hard safety guard to API test setup so destructive truncation only runs against an explicit disposable test database.
4. Add web coverage reporting with `@vitest/coverage-v8`, but start with measurement only, not strict thresholds.
5. Add three meaningful tests for high-risk, low-coverage behavior: workspace isolation, document association correctness, and weekly plan/comment/dashboard route behavior.
6. Add a lightweight test-quality gate for fake confidence: no `.only`, no TODO-only tests, no conditional skips for missing seed data, and `test.fixme()` for intentionally unfinished tests.
7. Use coverage to choose blind spots, not as the goal. Success is green tests plus regression coverage for real product risks.

---

## Category 6: Runtime Error and Edge Case Handling

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Static error-handling coverage was checked with `rg` for React error boundaries, global browser error/rejection handlers, Node `unhandledRejection` / `uncaughtException` handlers, and API `catch` blocks.
- Runtime console baseline uses the authenticated browser session on the same audit-scale `ship_dev` data set.
- Malformed input was checked against login UI validation and document API validation: empty login, script-like invalid email, 5,000-character password, empty document title, 300-character document title, and script-like/special-character document title.[^9]
- Concurrent collaboration was checked with two authenticated browser contexts editing the body of the same temporary audit document.[^9]
- Slow-network behavior was checked by throttling `/docs` to an emulated 3G-like profile through Chrome DevTools Protocol.[^9]
- Server logs were checked from the external `pnpm dev` terminal after the edge-case pass.[^9]

**Baseline**

| Metric                                | Value                                                                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console errors during normal usage    | 0 across `/docs`, `/issues`, `/my-week`, and `/projects` after clearing Console                                                                                                                                                    |
| Unhandled promise rejections (server) | No process-level `unhandledRejection` / `uncaughtException` handlers found                                                                                                                                                         |
| Network disconnect recovery           | Partial: document page stays rendered; offline mode repeatedly logs `BacklinksPanel.tsx` fetch failures; errors stop after returning to `No throttling`, but no visible offline/reconnected state appears                          |
| Missing error boundaries              | Partial boundary only: main `<Outlet />` wrapped; providers, sidebars, command palette, realtime/auth layers not wrapped                                                                                                           |
| Silent failures identified            | Backlinks fetch failures are console-only during disconnect; no visible user feedback                                                                                                                                              |
| Malformed input handling              | Mixed: login empty/script-like input shows user-facing errors; document API rejects empty/300-char titles with JSON 400; missing CSRF returns HTML 403 stack page                                                                  |
| Concurrent same-document editing      | Pass for checked editor-body case: two sessions editing the same temporary document converged to the same body text with both edits present                                                                                        |
| 3G throttled behavior                 | Partial pass: `/docs` became visible under throttling in 16.4s with no lingering loading text, but no explicit slow-network state appears                                                                                          |
| Server logs during edge checks        | CSRF stack traces logged for invalid-CSRF requests; Bedrock `CredentialsProviderError` logged during plan analysis when AWS credentials were unavailable; no `unhandledRejection` / `uncaughtException` process event was observed |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Network disconnects create console-only failures. `BacklinksPanel.tsx` repeatedly logs `Failed to fetch` while offline, but the user sees no offline state, retry status, or degraded-mode message.
2. **High:** CSRF failures can leak an HTML stack page. A state-changing request without `X-CSRF-Token` returned a 403 HTML response containing a `ForbiddenError` stack trace from `csrf-sync`, which is inconsistent with the JSON API error shape and exposes implementation details.
3. **High:** Server process-level failure handling is missing. No `process.on('unhandledRejection')` or `process.on('uncaughtException')` handler was found, so unexpected async failures may be logged inconsistently or terminate without a controlled shutdown path.
4. **Medium:** AI plan analysis logs a full AWS `CredentialsProviderError` when Bedrock credentials are unavailable locally. The error is caught, but the local runtime still emits a long provider stack instead of a concise degraded-mode message.
5. **Medium:** Error boundaries are incomplete. The main `<Outlet />` is wrapped, but providers, auth/realtime layers, sidebars, command palette, and properties portal are outside the boundary.
6. **Medium:** API routes mostly catch and return JSON 500s, but error handling is duplicated per route instead of centralized. This increases the chance of inconsistent messages/statuses as routes grow.
7. **Medium:** Slow network does not hang the checked `/docs` flow, but it also does not provide a clear slow/degraded state. The page became visible after about 16.4s under throttling.
8. **Low:** Login and document validation behaved predictably for checked malformed inputs: empty login produced `Email address is required`, invalid script-like credentials produced `Invalid email or password`, and invalid document titles returned JSON 400s.
9. **Low:** Checked two-session editor-body collaboration converged correctly: both browser contexts ended with both edits present.
10. **Low:** Normal authenticated navigation was quiet. `/docs`, `/issues`, `/my-week`, and `/projects` produced 0 console errors after clearing Console.

**Remediation Plan**

1. Add visible offline/degraded states for polling panels and realtime features, starting with `BacklinksPanel`.
2. Add centralized Express error middleware for CSRF and other middleware errors so 403/500 failures return JSON without HTML stack traces.
3. Add a local degraded-mode path for AI analysis when Bedrock/AWS credentials are unavailable, with concise logs and user-facing fallback behavior.
4. Add process-level `unhandledRejection` and `uncaughtException` handlers with structured logging and graceful shutdown behavior.
5. Move error boundaries higher or add separate boundaries around providers/sidebar/realtime surfaces so one crash cannot blank major app chrome.
6. Add centralized route helpers so thrown errors become consistent JSON responses.
7. Keep the normal-navigation, malformed-input, slow-network, and two-session collaboration checks as regression smoke tests after fixes.

---

## Category 7: Accessibility Compliance

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Lighthouse Accessibility audits were run in Chrome DevTools, Desktop navigation mode, Accessibility category only, against the login page and authenticated local pages on `http://localhost:5174`.
- “Major pages” were defined as the unauthenticated entry page plus authenticated pages covering primary navigation, distinct page templates, and source-of-truth core workflows: docs, document editor, issues, program-scoped issues, weekly planning, and projects.
- Audited pages: `/login`, `/docs`, `/documents/df41d98b-f009-4230-bd39-3953ca5a6507`, `/issues`, `/documents/1cdf945f-f04d-4ee5-ba38-e9f83afb473a/issues`, `/my-week`, and `/projects`.
- Axe scans were run with `@axe-core/playwright@4.11.0` against `/login`, `/docs`, `/documents/df41d98b-f009-4230-bd39-3953ca5a6507`, `/documents/1cdf945f-f04d-4ee5-ba38-e9f83afb473a/issues`, `/my-week`, and `/projects`.[^8]
- Keyboard navigation was checked manually on `/docs`, including sidebar/nav, search/sort/view controls, New Document, document tree rows, row action buttons, document activation with Enter, action-items modal Escape behavior, and the command palette opened with `Cmd+K`.[^8]
- VoiceOver was checked manually on `/docs` for page structure, document tree understandability, control names, and command palette usability.[^8]
- Lighthouse version: 13.0.2; Chromium: 148.0.0.0; run date: 2026-05-19. Lighthouse warned that IndexedDB data may affect loading performance, but this does not affect the accessibility score.

**Baseline**

| Metric                                    | Value                                                                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lighthouse accessibility score (per page) | `/login`: 98; `/docs`: 91; `/documents/:id`: 91; `/issues`: 100; `/documents/:programId/issues`: 100; `/my-week`: 96; `/projects`: 100                                                                         |
| Total Critical/Serious violations         | Axe: 2 critical nodes and 40 serious nodes across scanned pages; Lighthouse: 6 page-failures across 4 unique issue types                                                                                       |
| Keyboard navigation completeness          | Partial pass: `/docs` visible focus and expected activation worked for checked controls; `Cmd+K` command palette supported type/search, arrow navigation, Enter activation, and Escape close; no trap observed |
| Screen reader usability                   | VoiceOver partial pass: page structure clear; document tree understandable despite known ARIA/list issues; controls mostly named; command palette usable                                                       |
| Color contrast failures                   | Axe: `/my-week` 21 serious nodes, `/projects` 16 serious nodes; Lighthouse: `/my-week` only                                                                                                                    |
| Missing ARIA labels or roles              | 2 pages with ARIA required-child failures: `/docs`, `/documents/:id`; `/login` lacks a main landmark                                                                                                           |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Document list/document editor pages have structural accessibility defects. `/docs` and `/documents/:id` both fail Lighthouse checks for ARIA required children and invalid list-item structure.
2. **High:** Axe confirms critical/serious defects on the document tree: `aria-required-children` is critical on `/docs` and `/documents/:id`; invalid `li` parent structure is serious on both pages.
3. **High:** Color contrast is broader than Lighthouse showed. Axe reports 21 serious contrast nodes on `/my-week` and 16 serious contrast nodes on `/projects`, mainly low-contrast accent badges/counts and muted text on dark backgrounds.
4. **Medium:** Program-scoped Issues (`/documents/:programId/issues`) scored 100 in Lighthouse and had 0 axe violations in the scanned state, while the global `/issues` route also scored 100 in Lighthouse.
5. **Medium:** `/login` scores 98 but lacks a main landmark; axe also reports 5 moderate `region` nodes because page content is not contained by landmarks.
6. **Medium:** Keyboard navigation worked on the checked `/docs` surfaces, including the command palette, but remains partial because editor-specific shortcuts and rich-text toolbar behavior were not fully exercised.
7. **Medium:** VoiceOver was usable on `/docs`, but the known ARIA/list defects mean screen-reader semantics are not fully trustworthy until the document tree markup is corrected.
8. **Low:** Lighthouse reports 10 manual checks per page, so automated scores do not cover purpose/state clarity, focus management after dynamic updates, or custom-control semantics.

**Remediation Plan**

1. Fix the shared document tree/list markup first, because the same ARIA/list failures hit both `/docs` and `/documents/:id`.
2. Audit custom list/menu/tree components for correct parent/child roles and valid HTML list structure.
3. Fix contrast failures found by axe: `/my-week` accent/current badges and muted plan numbering; `/projects` filter count badges and ICE score badges.
4. Add a `main` landmark to the login page layout.
5. Add a focused keyboard checklist for command palette, New Document, document tree expand/collapse, editor focus, properties sidebar controls, and action-item modal.
6. Re-run Lighthouse on the same seven pages after fixes and require no automated failures before claiming accessibility improvement.

---

## Appendix

[^1]: Category 1 counts used the script below with `kindToCount` set to `ts.SyntaxKind.AnyKeyword` for `any`, `ts.SyntaxKind.AsExpression` for `as` assertions, and `ts.SyntaxKind.NonNullExpression` for non-null assertions.

```bash
node <<'NODE'
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const kindToCount = ts.SyntaxKind.AnyKeyword;

function collectFiles({ roots, excludeTests }) {
  const excludedDirs = new Set(['dist', 'node_modules', 'coverage', 'test-results', 'playwright-report']);
  if (excludeTests) excludedDirs.add('__tests__');
  const files = [];

  function isTestFile(filePath) {
    return /(^|\/)(test|tests|__tests__)(\/|$)/.test(filePath)
      || /\.(test|spec)\.tsx?$/.test(filePath);
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) walk(filePath);
      } else if (/\.(ts|tsx)$/.test(entry.name) && (!excludeTests || !isTestFile(filePath))) {
        files.push(filePath);
      }
    }
  }

  roots.forEach(walk);
  return files;
}

function countKind(files, roots) {
  const rows = [];
  const byRoot = {};
  let total = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    let count = 0;
    function visit(node) {
      if (node.kind === kindToCount) count += 1;
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    if (count > 0) {
      rows.push([file, count]);
      total += count;
      const root = roots.find((candidate) => file.startsWith(candidate + '/')) || 'other';
      byRoot[root] = (byRoot[root] || 0) + count;
    }
  }

  rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { total, byRoot, filesWithMatches: rows.length, scannedFiles: files.length, top20: rows.slice(0, 20) };
}

const auditRoots = ['web/src', 'api/src', 'shared/src', 'e2e'];
const prodRoots = ['web/src', 'api/src', 'shared/src'];

console.log(JSON.stringify({
  auditScope: countKind(collectFiles({ roots: auditRoots, excludeTests: false }), auditRoots),
  productionOnly: countKind(collectFiles({ roots: prodRoots, excludeTests: true }), prodRoots),
}, null, 2));
NODE
```

[^2]: Category 1 suppression count used `@ts-ignore\b|@ts-expect-error\b` over the same full and production-only file scopes.

[^3]: Category 5 static inventory used `rg -c '\b(test|it)\s*\(' --glob '*.test.ts' --glob '*.test.tsx' --glob '*.spec.ts' {api/src,web/src,shared/src,e2e}` to count declared test cases. Note: this grep counts syntactic matches including helpers and comments; the authoritative count comes from the test runners themselves.

[^4]: Category 5 sidecar benchmark database for safely running destructive API tests and coverage:

```bash
PSQL="/opt/homebrew/Cellar/libpq/18.3/bin/psql"
PGURI="postgresql://ship:ship_dev_password@localhost:5432"

# One-time setup if ship_test_audit does not exist.
$PSQL "$PGURI/postgres" -c "CREATE DATABASE ship_test_audit;"
DATABASE_URL="$PGURI/ship_test_audit" pnpm --filter @ship/api db:migrate

# Rerun API tests or coverage against the sidecar DB.
DATABASE_URL="$PGURI/ship_test_audit" pnpm --filter @ship/api exec vitest run
DATABASE_URL="$PGURI/ship_test_audit" pnpm --filter @ship/api exec vitest run --coverage
```

[^5]: Category 5 E2E test count used Playwright's built-in listing from the `e2e/` directory:

```bash
cd e2e && npx playwright test --list 2>&1 | tail -1
# Output: "Listing 869 tests in 71 files"
```

This is authoritative over the grep-based count (883) because Playwright resolves `test.describe`, `test.skip`, parameterized tests, and other runtime constructs that grep cannot distinguish from non-test usage of `test(` / `it(`.

[^5-e2e-run]: Category 5 full E2E run evidence from May 20, 2026. The repository documentation warns not to run `pnpm test:e2e` directly in Codex because the 600+ line stream can crash the context. The intended `/e2e-test-runner` skill was referenced in docs but was not present in this checkout, so the run used the same controlled shape: background execution, `test-results/summary.json` polling, Docker/Testcontainers enabled, and Playwright Chromium installed via `pnpm test:e2e:setup`.

```bash
pnpm test:e2e:run
pnpm exec playwright test --last-failed --reporter=json
```

Final Playwright status was failed. `test-results/.last-run.json` reported one final failed test: `e2e/inline-comments.spec.ts:118` (`canceling a comment removes the highlight`). With 869 listed tests and 17 skipped, the inferred final E2E pass/fail/skip count is 851 / 1 / 17. `test-results/summary.json` is a progress file and overcounted retry attempts before the reporter fix, so it should not be used as the final pass/fail source for this run.

Retry failures that passed later, treated as flake signals:

- `e2e/bulk-selection.spec.ts:1581`: strict locator for `#5` also matched `#50` and `#51`.
- `e2e/feedback-consolidation.spec.ts:67`: timed out waiting for `External feature request`.
- `e2e/my-week-stale-data.spec.ts`: plan/retro edits timed out before becoming visible on `/my-week`.
- `e2e/project-weeks.spec.ts:205`: timed out waiting for `Navigation Test Project`.
- `e2e/weekly-accountability.spec.ts:469`: expected assigned person/document id but received `null`.

[^6]: Category 1 ESLint type-safety rules:

```bash
'@typescript-eslint/no-explicit-any': 'warn',
'@typescript-eslint/no-non-null-assertion': 'warn',
'@typescript-eslint/consistent-type-assertions': ['warn', {
  assertionStyle: 'as',
  objectLiteralTypeAssertions: 'never',
}],
'@typescript-eslint/no-unsafe-assignment': 'warn',
'@typescript-eslint/no-unsafe-member-access': 'warn',
'@typescript-eslint/no-unsafe-argument': 'warn',
'@typescript-eslint/no-unsafe-return': 'warn',
'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
'@typescript-eslint/strict-boolean-expressions': 'off',
```

[^7]: Runtime audit-load rows can be removed after measurement with:

```bash
PSQL="/opt/homebrew/Cellar/libpq/18.3/bin/psql"
PGURI="postgresql://ship:ship_dev_password@localhost:5432"

$PSQL "$PGURI/ship_dev" -c "DELETE FROM documents WHERE properties->>'audit_load' = 'true';"
$PSQL "$PGURI/ship_dev" -c "DELETE FROM users WHERE email LIKE 'audit.user%@ship.local';"
```

[^8]: Category 7 accessibility evidence.

Axe command shape:

```bash
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const base = 'http://localhost:5174';
const routes = [
  '/login',
  '/docs',
  '/documents/df41d98b-f009-4230-bd39-3953ca5a6507',
  '/documents/1cdf945f-f04d-4ee5-ba38-e9f83afb473a/issues',
  '/my-week',
  '/projects',
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

async function login() {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill('dev@ship.local');
  await page.locator('input').nth(1).fill('admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/docs/, { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function scan(targetPage, route) {
  await targetPage.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  await targetPage.waitForTimeout(1000);
  const axe = await new AxeBuilder({ page: targetPage }).analyze();
  return {
    route,
    violations: axe.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
      help: violation.help,
    })),
  };
}

await login();

const results = [];
const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const anonPage = await anon.newPage();
results.push(await scan(anonPage, '/login'));
await anon.close();

for (const route of routes.slice(1)) {
  results.push(await scan(page, route));
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
NODE
```

Axe output summary:

| Route                                                    | Critical | Serious | Moderate | Notes                                 |
| -------------------------------------------------------- | -------- | ------- | -------- | ------------------------------------- |
| `/login`                                                 | 0        | 0       | 6        | `landmark-one-main` (1), `region` (5) |
| `/docs`                                                  | 1        | 1       | 0        | `aria-required-children`, `listitem`  |
| `/documents/df41d98b-f009-4230-bd39-3953ca5a6507`        | 1        | 1       | 0        | same document tree defects as `/docs` |
| `/documents/1cdf945f-f04d-4ee5-ba38-e9f83afb473a/issues` | 0        | 0       | 0        | no axe violations                     |
| `/my-week`                                               | 0        | 21      | 0        | `color-contrast`                      |
| `/projects`                                              | 0        | 16      | 0        | `color-contrast`                      |

Representative raw axe details:

- `/docs`: `ul[aria-label="Workspace documents"]` failed `aria-required-children`; `ul[aria-label="Workspace documents"] > li:nth-child(11)` failed `listitem`.
- `/documents/:id`: the same workspace document tree failed `aria-required-children` and `listitem`.
- `/my-week`: `Current` badge contrast was 2.55:1 (`#005ea2` on `#0a1d2b`); weekly plan number labels were 2.26:1 (`#4c4c4c` on `#0d0d0d`).
- `/projects`: planned-count badge contrast was 3.65:1 (`#8a8a8a` on `#333333`); ICE score badges were 2.55:1 (`#005ea2` on `#0a1d2b`).

Manual keyboard notes:

- `/docs`: visible focus and expected activation worked for checked sidebar/nav, search/sort/view controls, New Document, document tree rows, row action buttons, document activation with Enter, and action-items modal Escape behavior.
- Command palette: `Cmd+K` opened it; typing/search, arrow navigation, Enter activation, and Escape close worked.
- No focus trap was observed in the checked flows.

Manual VoiceOver notes:

- `VoiceOver: page structure clear; document tree understandable despite known ARIA/list issues; controls mostly named; command palette usable.`

[^9]: Category 6 runtime/error evidence.

Runtime edge-case checks used Chrome headless through Playwright against the running local app at `http://localhost:5174` / `http://localhost:3000`.

Command shape:

```bash
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';

const base = 'http://localhost:5174';
const api = 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
// Login as dev@ship.local / admin123.
// Fetch /api/csrf-token for state-changing API requests.
// Exercise login validation, document create validation, script-like title rendering,
// two-browser-context document body editing, and CDP network throttling.
NODE
```

Malformed input results:

| Check                                                                         | Result                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Login submit with empty fields                                                | User-facing alert: `Email address is required`                                      |
| Login with script-like invalid email and 5,000-character password             | User-facing alert: `Invalid email or password`                                      |
| `POST /api/documents` with empty title and valid CSRF                         | `400 application/json`, Zod `too_small` title error                                 |
| `POST /api/documents` with 300-character title and valid CSRF                 | `400 application/json`, Zod `too_big` title error                                   |
| `POST /api/documents` with script-like/special-character title and valid CSRF | `201 application/json`; title stored literally                                      |
| Render script-like title in browser                                           | `window.__shipAuditXss` remained false; title rendered as text                      |
| `POST /api/documents` without CSRF                                            | `403 text/html`; response included `ForbiddenError: invalid csrf token` stack trace |

Concurrent editing result:

```json
{
  "bodyA": "Session A body edit. Session B body edit. \\nDev User\\n\\n",
  "bodyB": "Session A body edit. Session B body edit. \\nDev User\\n\\n",
  "containsAInBoth": true,
  "containsBInBoth": true
}
```

Slow-network result:

```json
{
  "check": "3G throttled /docs",
  "elapsedMs": 16387,
  "docsVisible": true,
  "loadingTextCount": 0
}
```

Browser console during the automated Cat 6 pass showed expected resource errors from checked negative cases: initial unauthenticated `/api/auth/me` 401, validation 400s, and the intentionally missing-CSRF 403. No browser `pageerror` was observed. The pasted `pnpm dev` server logs showed repeated Events WebSocket connect/disconnect messages, normal Yjs content conversion/loading messages, three `ForbiddenError: invalid csrf token` stack traces from the missing-CSRF check, and one `CredentialsProviderError: Could not load credentials from any providers` from AI plan analysis. No `unhandledRejection` or `uncaughtException` process event was visible in the pasted logs.

[^10]: Category 3 API benchmark command shapes and notes.

Cookie check:

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  -H "Cookie: $SHIP_COOKIE" \
  "http://localhost:3000/api/documents?type=wiki"
# 200 105338
```

Initial `autocannon` benchmark shape:

```bash
pnpm dlx autocannon -c 10 -d 15 -R 50 \
  -H "Cookie: $SHIP_COOKIE" \
  "http://localhost:3000/api/documents?type=wiki"

pnpm dlx autocannon -c 25 -d 15 -R 50 \
  -H "Cookie: $SHIP_COOKIE" \
  "http://localhost:3000/api/issues"

pnpm dlx autocannon -c 50 -d 15 -R 25 \
  -H "Cookie: $SHIP_COOKIE" \
  "http://localhost:3000/api/dashboard/my-week"
```

Endpoint-specific request rates used in the final exact-percentile baseline:

| Endpoint                   | 10c        | 25c        | 50c        |
| -------------------------- | ---------- | ---------- | ---------- |
| `/api/documents?type=wiki` | 50 req/sec | 50 req/sec | 50 req/sec |
| `/api/issues`              | 50 req/sec | 50 req/sec | 50 req/sec |
| `/api/dashboard/my-week`   | 50 req/sec | 50 req/sec | 25 req/sec |
| `/api/projects`            | 50 req/sec | 50 req/sec | 50 req/sec |
| `/api/programs/:id/issues` | 50 req/sec | 50 req/sec | 50 req/sec |

The uncapped `autocannon` benchmark was discarded because it measured rate-limit behavior instead of endpoint latency: `1998 2xx responses, 454536 non 2xx responses`. `autocannon` was also not used for the final table because it does not report exact P95 (`p90`, `p97_5`, and `p99` are available, but not `p95`). The final table uses a custom Node HTTP harness that recorded each request duration and calculated exact P50/P95/P99. During that final pass, the dev API rate limit was temporarily raised from `1000/min` to `100000/min`, then restored after measurement.

[^11]: Category 4 `EXPLAIN ANALYZE` evidence.

Representative `EXPLAIN (ANALYZE, BUFFERS)` results on the audit-scale `ship_dev` database:

| Query                                    | Plan shape                                                                     | Execution time | Notes                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Documents list, `document_type = 'wiki'` | `Seq Scan on documents` + sort                                                 | 0.412 ms       | 258 rows returned; 259 rows filtered; planner chose seq scan at current table size despite `idx_documents_active`.                 |
| Issues list                              | `Bitmap Index Scan on idx_documents_document_type` + hash left joins + sort    | 0.230 ms       | 104 rows returned; joins to `users` and person docs are batched, no row-level N+1.                                                 |
| Backlinks                                | `Bitmap Index Scan on idx_document_links_target` + nested joins                | 0.095 ms       | 0 rows for checked doc; correct target index used.                                                                                 |
| My-week weekly-plan lookup               | `Bitmap Index Scan on idx_documents_document_type`, then JSON-property filters | 0.105 ms       | Fast at current scale, but filters `(properties->>'person_id')` and `(properties->>'week_number')::int` after the broad type scan. |

Exact command pattern:

```bash
/opt/homebrew/Cellar/libpq/18.3/bin/psql \
  "postgresql://ship:ship_dev_password@localhost:5432/ship_dev" \
  -c "EXPLAIN (ANALYZE, BUFFERS) SELECT ...;"
```
