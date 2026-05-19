# Audit Report

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
- Runtime flow URL note: the Issues list was reached directly at `http://localhost:5174/issues`; it was not obvious from the visible primary navigation during this pass.
- check if /file works...

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
3. Lazy-load `emoji-picker-react`; the picker should download only when the emoji popover opens.
4. Convert eager page imports in `web/src/main.tsx` to route-level `React.lazy` imports, especially admin, org chart, reviews, settings, and document-heavy pages.
5. Split the editor path so non-editor pages do not pay for TipTap, Yjs, ProseMirror, lowlight, or collaboration code on initial load.
6. Reduce syntax-highlighting weight by registering only needed languages or loading highlighting after the editor/code block is actually used.
7. Measure success with the same production build and bundle report, targeting at least a 20% reduction in the initial `assets/index-*.js` chunk without removing user-facing functionality.

---

## Category 3: API Response Time

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Authenticated API requests were benchmarked with the browser session cookie captured from Chrome DevTools. Cookie validity was confirmed with `curl`, returning `200 105338` for `GET /api/documents?type=wiki`.
- Flow 1, load main page (`/docs`): representative endpoint selected as `GET http://localhost:3000/api/documents?type=wiki`, because it is the main content payload for the documents page and the largest visible API response during page load.
- Benchmarks used `autocannon` for 15 seconds at 10, 25, and 50 connections, capped with `-R 50` to stay below the app's `1000/min` rate limit. An uncapped 10-connection run was discarded because it produced 454,536 non-2xx responses and immediately hit `429 Too Many Requests`.
- Flow 2, view a document (`/documents/df41d98b-f009-4230-bd39-3953ca5a6507`): the visible document-specific REST call was `GET /api/documents/:id/backlinks`. Hard reload did not expose a separate document-body REST request; document content appears to come from frontend state, cache, or the editor/collaboration path. The 50-connection backlinks run used `-R 40` after a `-R 50` attempt produced 9 non-2xx responses.
- Flow 3, list issues (`/issues`): the route was reached directly at `http://localhost:5174/issues` because the visible primary navigation did not make the route obvious. The UI did not visibly trigger `GET /api/issues` during the captured page-load pass, but `GET /api/issues` is the verified issue-list API endpoint and returned `200 102132` with the active session cookie.
- Flow 4, load sprint/week board (`/my-week`): representative endpoint selected as `GET http://localhost:3000/api/dashboard/my-week`, returning `200 1221` with the active session cookie. The 50-connection run used `-R 25` after a `-R 50` attempt produced 326 non-2xx responses.
- Flow 5, search content (`/docs` search box): no backend request fired when searching `audit`; the Docs page filters the already-loaded document list client-side. Code review found implemented backend search routes for `/api/search/mentions` and `/api/search/learnings`, but OpenAPI also documents `/api/search/documents`; verification returned `404 159` for `GET /api/search/documents?q=audit`.

**Baseline**

| Endpoint | P50 | P95 | P99 |
| -------- | --- | --- | --- |
| `GET /api/documents?type=wiki` at 10 connections | 7 ms | 21 ms (97.5th percentile proxy) | 23 ms |
| `GET /api/documents?type=wiki` at 25 connections | 17 ms | 42 ms (97.5th percentile proxy) | 46 ms |
| `GET /api/documents?type=wiki` at 50 connections | 25 ms | 65 ms (97.5th percentile proxy) | 71 ms |
| `GET /api/documents/:id/backlinks` at 10 connections | 3 ms | 13 ms (97.5th percentile proxy) | 17 ms |
| `GET /api/documents/:id/backlinks` at 25 connections | 8 ms | 23 ms (97.5th percentile proxy) | 25 ms |
| `GET /api/documents/:id/backlinks` at 50 connections | 13 ms | 28 ms (97.5th percentile proxy) | 31 ms |
| `GET /api/issues` at 10 connections | 7 ms | 22 ms (97.5th percentile proxy) | 25 ms |
| `GET /api/issues` at 25 connections | 14 ms | 35 ms (97.5th percentile proxy) | 38 ms |
| `GET /api/issues` at 50 connections | 29 ms | 66 ms (97.5th percentile proxy) | 72 ms |
| `GET /api/dashboard/my-week` at 10 connections | 5 ms | 21 ms (97.5th percentile proxy) | 26 ms |
| `GET /api/dashboard/my-week` at 25 connections | 12 ms | 32 ms (97.5th percentile proxy) | 34 ms |
| `GET /api/dashboard/my-week` at 50 connections | 16 ms | 34 ms (97.5th percentile proxy) | 36 ms |
| Search content flow | N/A | N/A | N/A |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Rate limiting makes naive concurrent benchmarks invalid. Uncapped `autocannon` immediately produced hundreds of thousands of non-2xx responses, and even capped 50-connection runs needed lower request rates on some endpoints. The API can be measured, but only with rate-aware tooling.
2. **High:** Search route documentation and implementation disagree. OpenAPI documents `GET /api/search/documents`, but the endpoint returns 404. The visible Docs search is client-side only, so there is no backend baseline for the required search-content flow.
3. **Medium:** Main list endpoints are fast under rate-capped local load but payload-heavy. `GET /api/documents?type=wiki` returns about 105 KB and reaches 71 ms P99 at 50 connections; `GET /api/issues` returns about 102 KB and reaches 72 ms P99.
4. **Medium:** Document-view measurement is incomplete from the REST layer. Hard reload of a document page exposed backlinks only; document body loading appears to happen through cached state, frontend state, or the editor/collaboration path, so REST-only benchmarking misses part of the user-visible document-load path.
5. **Low:** The sprint/week endpoint is small and stable when rate-capped. `GET /api/dashboard/my-week` returned about 1.2 KB and stayed at 36 ms P99 at 50 connections once the request rate was lowered.

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

**Baseline**

| User flow         | Total queries | Slowest query (ms) | N+1 detected? |
| ----------------- | ------------- | ------------------ | ------------- |
| Load main page    | 41 | 4.00 | No row-level N+1; repeated session/auth checks across 10 API calls |
| View a document   | 5 | 0.56 | No |
| List issues       | 5 | 1.00 | No |
| Load sprint board | 9 | 0.57 | No |
| Search content    | 0 | N/A | N/A; client-side filter only |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Main page load fans out into too many backend requests. The measured `/docs` hydration path made 10 API calls and 41 SQL queries before any user interaction.
2. **Medium:** Session/auth checks are repeated per API call. The main-page flow executed 10 session lookups and 10 session `last_activity` updates, adding write pressure and noise to every multi-request page load.
3. **Medium:** The largest list endpoints are single-query but payload-heavy. `GET /api/issues` and `GET /api/documents?type=wiki` did not show row-level N+1 behavior, but they return full lists with large response bodies.
4. **Medium:** The sprint/week board uses 9 queries for a small response. No N+1 was confirmed, but the query count is high relative to the 1.2 KB payload.
5. **Low:** Docs search uses no database query because it filters client-side. That is efficient for the current loaded list, but it cannot become true full-content search without a real backend endpoint.

**Remediation Plan**

1. Reduce page-load API fanout before tuning individual SQL. Bundle related bootstrap data or rely more consistently on React Query cache hydration.
2. Avoid updating session `last_activity` on every single request in bursty page loads; throttle or coalesce the write while preserving the 15-minute inactivity policy.
3. Add pagination or server-side limits for document and issue lists before the audit-load dataset grows further.
4. Add a real document-search endpoint or remove the documented `/api/search/documents` route from OpenAPI.
5. Keep the query-count harness or replace it with proper Postgres query stats in dev, so future improvements can be checked with the same five flows.

---

## Category 5: Test Coverage and Quality

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Test inventory was measured by scanning `api/src`, `web/src`, `shared/src`, and `e2e` for `*.test.ts(x)` and `*.spec.ts(x)` files, then counting declared `test(...)` / `it(...)` cases.[^3]
- Web unit tests were run with `pnpm --filter @ship/web exec vitest run`.
- API unit tests were run with `pnpm --filter @ship/api exec vitest run` against the sidecar benchmark database (`ship_test_audit`) to avoid truncating local application data.[^4]
- E2E test count was measured with `npx playwright test --list` from the `e2e/` directory, which enumerates every test the runner would execute.[^5]
- Flaky test detection: both API and web suites were run 3× each; any test that changed pass/fail status across runs was flagged as flaky.
- API code coverage was measured by temporarily installing `@vitest/coverage-v8@4.0.17` (matching the project's `vitest@4.0.17`) and running `pnpm --filter @ship/api exec vitest run --coverage` against `ship_test_audit`. The dependency was removed after measurement.
- Web coverage was checked in `web/vitest.config.ts`; no coverage provider is configured.

**Baseline**

| Metric                            | Value                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Total tests                       | 1,471 executable tests across 99 files (451 API in 28 files, 151 web in 16 files, 869 E2E in 71 files)                   |
| Pass / Fail / Flaky               | API unit: 451 / 0 / 0; Web unit: 138 / 13 / 0; E2E: not executed (inventory only)                                        |
| Suite runtime                     | API unit: 10.76s; Web unit: 1.05s                                                                                        |
| Critical flows with zero coverage | None obvious by file inventory for document CRUD, auth, collaboration, issues, weeks, search, accessibility, or security |
| Code coverage % (if measured)     | API: 40.34% statements, 33.44% branches, 40.9% functions, 40.52% lines; Web: not configured                              |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Web unit tests are failing: 13 of 151 failed, in `document-tabs.test.ts` (9), `DetailsExtension.test.ts` (3), and `useSessionTimeout.test.ts` (1). These are assertion mismatches against changed implementation (e.g., tab configs, TipTap extension content schema), not environmental failures.
2. **High:** API code coverage is 40% across the board. Route files for `programs.ts` (5%), `dashboard.ts` (2%), `weekly-plans.ts` (5%), and `comments.ts` (9%) have near-zero coverage despite being production endpoints.
3. **Medium:** Web has no coverage measurement configured. `web/vitest.config.ts` has no `coverage` block; adding `@vitest/coverage-v8` with a `provider: 'v8'` config would enable it.
4. **Medium:** API test safety requires the sidecar benchmark database. `api/src/test/setup.ts` runs `TRUNCATE ... CASCADE` on `documents`, `users`, `workspaces`, `audit_logs`, and other tables. Running `pnpm test` from root will destroy local development data unless `DATABASE_URL` points to `ship_test_audit` or another disposable database.
5. **Low:** No flaky tests detected across 3 repeated runs of both API and web suites.

**Remediation Plan**

Restore trust in the test system before expanding it.

1. Fix the 13 failing web unit tests so both API and web unit suites are green.
2. Add a hard safety guard to API test setup so destructive truncation only runs against an explicit disposable test database.
3. Add web coverage reporting with `@vitest/coverage-v8`, but start with measurement only, not strict thresholds.
4. Add three meaningful tests for high-risk, low-coverage behavior: workspace isolation, document association correctness, and weekly plan/comment/dashboard route behavior.
5. Add a lightweight test-quality gate for fake confidence: no `.only`, no TODO-only tests, no conditional skips for missing seed data, and `test.fixme()` for intentionally unfinished tests.
6. Use coverage to choose blind spots, not as the goal. Success is green tests plus regression coverage for real product risks.

---

## Category 6: Runtime Error and Edge Case Handling

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Static error-handling coverage was checked with `rg` for React error boundaries, global browser error/rejection handlers, Node `unhandledRejection` / `uncaughtException` handlers, and API `catch` blocks.
- Runtime console baseline uses the authenticated browser session on the same audit-scale `ship_dev` data set.

**Baseline**

| Metric                                | Value                 |
| ------------------------------------- | --------------------- |
| Console errors during normal usage    | 0 across `/docs`, `/issues`, `/my-week`, and `/projects` after clearing Console |
| Unhandled promise rejections (server) | No process-level `unhandledRejection` / `uncaughtException` handlers found |
| Network disconnect recovery           | Partial: document page stays rendered; offline mode repeatedly logs `BacklinksPanel.tsx` fetch failures; errors stop after returning to `No throttling`, but no visible offline/reconnected state appears |
| Missing error boundaries              | Partial boundary only: main `<Outlet />` wrapped; providers, sidebars, command palette, realtime/auth layers not wrapped |
| Silent failures identified            | Backlinks fetch failures are console-only during disconnect; no visible user feedback |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Network disconnects create console-only failures. `BacklinksPanel.tsx` repeatedly logs `Failed to fetch` while offline, but the user sees no offline state, retry status, or degraded-mode message.
2. **High:** Server process-level failure handling is missing. No `process.on('unhandledRejection')` or `process.on('uncaughtException')` handler was found, so unexpected async failures may be logged inconsistently or terminate without a controlled shutdown path.
3. **Medium:** Error boundaries are incomplete. The main `<Outlet />` is wrapped, but providers, auth/realtime layers, sidebars, command palette, and properties portal are outside the boundary.
4. **Medium:** API routes mostly catch and return JSON 500s, but error handling is duplicated per route instead of centralized. This increases the chance of inconsistent messages/statuses as routes grow.
5. **Low:** Normal authenticated navigation was quiet. `/docs`, `/issues`, `/my-week`, and `/projects` produced 0 console errors after clearing Console.

**Remediation Plan**

1. Add visible offline/degraded states for polling panels and realtime features, starting with `BacklinksPanel`.
2. Add process-level `unhandledRejection` and `uncaughtException` handlers with structured logging and graceful shutdown behavior.
3. Move error boundaries higher or add separate boundaries around providers/sidebar/realtime surfaces so one crash cannot blank major app chrome.
4. Add centralized Express error middleware and route helpers so thrown errors become consistent JSON responses.
5. Keep the normal-navigation console check as a regression smoke test after fixes.

---

## Category 7: Accessibility Compliance

**Methodology (Describe how you measured it (tools, commands, methodology))**

- Lighthouse Accessibility audits were run in Chrome DevTools, Desktop navigation mode, Accessibility category only, against authenticated local pages on `http://localhost:5174`.
- Audited pages: `/docs`, `/documents/df41d98b-f009-4230-bd39-3953ca5a6507`, `/issues`, `/my-week`, and `/projects`.
- Lighthouse version: 13.0.2; Chromium: 148.0.0.0; run date: 2026-05-19. Lighthouse warned that IndexedDB data may affect loading performance, but this does not affect the accessibility score.

**Baseline**

| Metric                                    | Value                   |
| ----------------------------------------- | ----------------------- |
| Lighthouse accessibility score (per page) | `/docs`: 91; `/documents/:id`: 91; `/issues`: 100; `/my-week`: 96; `/projects`: 100 |
| Total Critical/Serious violations         | Automated failures: 5 page-failures across 3 unique issue types |
| Keyboard navigation completeness          | Partial/mostly pass: `/docs` first 10 Tab stops had visible focus and logical order; no obvious unreachable control; no confirmed trap |
| Color contrast failures                   | 1 page: `/my-week` |
| Missing ARIA labels or roles              | 2 pages with ARIA required-child failures: `/docs`, `/documents/:id` |

**Findings** Identify the specific weaknesses or opportunities you found, and Rank the severity or impact of each finding.

1. **High:** Document list/document editor pages have structural accessibility defects. `/docs` and `/documents/:id` both fail Lighthouse checks for ARIA required children and invalid list-item structure.
2. **Medium:** `/my-week` has a color contrast failure, likely in muted/due/status text on the dark UI.
3. **Medium:** Keyboard navigation passed the first smoke check but is not fully proven. The first 10 Tab stops on `/docs` had visible focus and logical order, but modals, command palette, editor controls, and sidebars still need targeted manual checks.
4. **Low:** `/issues` and `/projects` scored 100 in Lighthouse accessibility with no automated failures.
5. **Low:** Lighthouse reports 10 manual checks per page, so automated scores do not cover purpose/state clarity, focus management after dynamic updates, or custom-control semantics.

**Remediation Plan**

1. Fix the shared document tree/list markup first, because the same ARIA/list failures hit both `/docs` and `/documents/:id`.
2. Audit custom list/menu/tree components for correct parent/child roles and valid HTML list structure.
3. Fix the `/my-week` contrast failure by identifying the exact failing foreground/background pair in Lighthouse details.
4. Add a focused keyboard checklist for command palette, New Document, document tree expand/collapse, editor focus, properties sidebar controls, and action-item modal.
5. Re-run Lighthouse on the same five pages after fixes and require no automated failures before claiming accessibility improvement.

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
