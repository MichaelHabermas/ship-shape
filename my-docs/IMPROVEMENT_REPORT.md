# Improvement Report

---

## Easy Wins Pass Summary

This pass captured quick, safe improvements from the audit work: contract drift fixes, repo/build hygiene, production bundle splitting, accessibility fixes, narrow type-safety cleanup, API test safety, CSRF JSON handling, comments visibility checks, and migration-runner error handling. The intentionally deferred items are still listed near the end so this report remains the current ledger for this work batch, not a final submission checklist.

---

## Context

- Improvement date/time: 2026-05-20 local
- Code state: easy-wins implementation pass, committed in current checkout
- Environment: local pnpm workspace
- Database: `ship_test_audit` for API unit verification; `ship_dev`/dev server for browser checks
- Runtime: API `http://localhost:3001`, web `http://localhost:5175`
- Evidence: `pnpm type-check`, `pnpm build:api`, `pnpm build:web`, API unit suite, axe scan, OpenAPI path inspection, ESLint JSON count

---

## Category 1: Type Safety

### Source Requirement

> "Eliminate 25% of type safety violations. Every fix must preserve existing functionality (all tests still pass). Superficial fixes do not count. Replacing any with unknown without proper type narrowing is not an improvement. Each fix must include correct, meaningful types that reflect the actual data."

### Measurement Method

Official before/after `any` counts use the TypeScript AST audit counter described in `AUDIT_REPORT.md`. ESLint JSON remains the worklist and fast feedback loop, filtered for production files by excluding tests and test helpers. Type-check remains the correctness gate.

### Scorecard

| Metric | Baseline | Latest | Last Measured | Change | Required Change | Stretch Goal |
|--------|----------|--------|---------------|--------|-----------------|--------------|
| Total `any` types | 278 total / 94 production | 267 total / 83 production | 2026-05-20 | -11 total / -11 production | 25% total violation reduction | |
| Total type assertions (`as`) | 713 total / 504 production | | | | Meaningful reduction | |
| Total non-null assertions (`!`) | 348 total / 325 production | | | | Meaningful reduction | |
| Total `@ts-ignore` / `@ts-expect-error` | 1 total / 0 production | | | | No production suppressions | |
| Top 5 violation-dense files | `api/src/routes/weeks.ts` (85), `api/src/routes/projects.ts` (51), `api/src/routes/issues.ts` (49), `web/src/pages/UnifiedDocumentPage.tsx` (37), `api/src/db/seed.ts` (35) | | | | Highest-risk reductions must be real narrowing | |

### What Changed

- Ran ESLint autofix for redundant assertions.
- Typed upload service JSON response boundaries in `web/src/services/upload.ts`.
- Changed narrow dynamic SQL parameter arrays from `any[]` to `unknown[]` where type-check accepted it cleanly. This is cleanup, not counted as the main meaningful type-safety win.

### Evidence

- `pnpm type-check`: pass.
- AST `any` count after pass: 267 total / 83 production.
- ESLint JSON count after pass: 6,440 total warnings; 4,952 production warnings.
- Production `any` count by official AST counter: 94 -> 83.

---

## Category 2: Production Frontend Bundle Size

### Source Requirement

> "15% reduction in total production bundle size, or implement code splitting that reduces initial page load bundle by 20%. Provide before/after bundle analysis output. Removing functionality to shrink the bundle does not count."

### Measurement Method

Production Vite build output plus `web/dist/assets` JS/CSS byte count.

### Scorecard

| Metric | Baseline | Latest | Last Measured | Change | Required Change | Stretch Goal |
|--------|----------|--------|---------------|--------|-----------------|--------------|
| Total production bundle size | 2,262.65 KB JS/CSS | 2,262.44 KB JS/CSS | 2026-05-20 | -0.21 KB | 15% reduction in total production bundle size | |
| Largest chunk | `assets/index-C2vAyoQ1.js` (2,025.10 KB) | `assets/index-Bru9KqDv.js` (1,802.32 KB) | 2026-05-20 | -222.78 KB / -11.0% | 20% reduction in initial page load bundle if using code splitting target | |
| Number of chunks | 262 JS/CSS chunks | | | | Before/after bundle analysis output | |
| Top 3 largest dependencies | `emoji-picker-react` (399.59 KB), `highlight.js` (377.92 KB), `yjs` (264.92 KB) | | | | No functionality removal | |
| Unused dependencies identified | `@tanstack/query-sync-storage-persister` | | | | Remove only if still confirmed unused | |

### What Changed

- Dev-only lazy import for React Query Devtools.
- Lazy-loaded `emoji-picker-react` behind the emoji picker UI.
- Removed unused `@tanstack/query-sync-storage-persister` dependency after confirming no source/package imports.

### Evidence

- `pnpm build:web`: pass.
- Largest production entry chunk: 2,025.10 KB -> 1,802.32 KB.
- New emoji picker async chunk: 271.11 KB.
- `rg "ReactQueryDevtools|Open Tanstack query devtools" web/dist/assets`: no production bundle matches.

---

## Category 3: API Response Time

### Source Requirement

> "20% reduction in P95 response time on at least 2 endpoints. You must provide before/after benchmarks run under identical conditions (same data volume, same concurrency, same hardware). Document the root cause of each bottleneck."

### Measurement Method


### Scorecard

| Endpoint | Baseline P50 | Baseline P95 | Baseline P99 | Latest P50 | Latest P95 | Latest P99 | Last Measured | Change | Required Change | Stretch Goal |
|----------|--------------|--------------|--------------|------------|------------|------------|---------------|--------|-----------------|--------------|
| `GET /api/documents?type=wiki` | 10c: 8 ms; 25c: 8 ms; 50c: 9 ms | 10c: 11 ms; 25c: 10 ms; 50c: 11 ms | 10c: 12 ms; 25c: 11 ms; 50c: 15 ms | | | | | | 20% P95 reduction on at least 2 endpoints | |
| `GET /api/issues` | 10c: 10 ms; 25c: 9 ms; 50c: 9 ms | 10c: 13 ms; 25c: 11 ms; 50c: 11 ms | 10c: 19 ms; 25c: 15 ms; 50c: 19 ms | | | | | | 20% P95 reduction on at least 2 endpoints | |
| `GET /api/dashboard/my-week` | 10c: 9 ms; 25c: 9 ms; 50c: 11 ms | 10c: 12 ms; 25c: 11 ms; 50c: 13 ms | 10c: 13 ms; 25c: 15 ms; 50c: 14 ms | | | | | | Identical benchmark conditions | |
| `GET /api/projects` | 10c: 7 ms; 25c: 8 ms; 50c: 8 ms | 10c: 9 ms; 25c: 9 ms; 50c: 9 ms | 10c: 11 ms; 25c: 11 ms; 50c: 11 ms | | | | | | Identical benchmark conditions | |
| `GET /api/programs/:id/issues` | 10c: 7 ms; 25c: 7 ms; 50c: 8 ms | 10c: 9 ms; 25c: 9 ms; 50c: 9 ms | 10c: 10 ms; 25c: 10 ms; 50c: 11 ms | | | | | | Identical benchmark conditions | |

### What Changed

- Skipped for this pass. Existing local latencies were already low; quick fixes here would be fake precision without changing the bottleneck.

### Evidence


---

## Category 4: Database Query Efficiency

### Source Requirement

> "20% reduction in total query count on at least one user flow, or 50% improvement on the slowest query. Provide before/after EXPLAIN ANALYZE output. Document what was inefficient and why your change fixes it."

### Measurement Method


### Scorecard

| User Flow | Baseline Total Queries | Baseline Slowest Query | Baseline N+1 Detected? | Latest Total Queries | Latest Slowest Query | Latest N+1 Detected? | Last Measured | Change | Required Change | Stretch Goal |
|-----------|------------------------|------------------------|------------------------|----------------------|----------------------|----------------------|---------------|--------|-----------------|--------------|
| Load main page | 41 | 4.00 ms | No row-level N+1; repeated session/auth checks across 10 API calls | | | | | | 20% fewer queries on at least one flow | |
| View a document | 5 | 0.56 ms | No | | | | | | 50% improvement on slowest query if using query-time target | |
| List issues | 5 | 1.00 ms | No | | | | | | Before/after EXPLAIN ANALYZE output | |
| Load sprint board | 9 | 0.57 ms | No | | | | | | Before/after EXPLAIN ANALYZE output | |
| Search content | 0 | N/A | N/A; client-side filter only | | | | | | Document what was inefficient | |

### What Changed

- Skipped for this pass. Query count and slow-query work needs targeted EXPLAIN evidence and is not quick/easy/safe enough for this pass.

### Evidence


---

## Category 5: Test Coverage and Quality

### Source Requirement

> "Add meaningful tests for 3 previously untested critical paths, or fix 3 flaky tests with documented root cause analysis. 'Meaningful' means the test catches a real regression, not just asserting that a page loads. Each test must include a comment explaining what risk it mitigates."

### Measurement Method


### Scorecard

| Metric | Baseline | Latest | Last Measured | Change | Required Change | Stretch Goal |
|--------|----------|--------|---------------|--------|-----------------|--------------|
| Total tests | 1,471 executable tests across 115 files | | | | Add 3 meaningful tests or fix 3 flaky tests | |
| API unit tests | 451 pass / 0 fail / 0 flaky | | | | Existing tests still pass | |
| Web unit tests | 138 pass / 13 fail / 0 flaky | | | | Existing tests still pass | |
| E2E tests | 869 listed / not executed | | | | Meaningful tests catch real regressions | |
| Suite runtime | API unit: 10.76s; Web unit: 1.05s | | | | Document root cause if fixing flaky tests | |
| Code coverage | API: 40.34% statements, 33.44% branches, 40.9% functions, 40.52% lines; Web: not configured | | | | Risk-mitigating tests, not page-load assertions | |

### What Changed

- Added a destructive-test-DB guard in API test setup so truncation only runs against disposable database names such as `ship_test_audit`, unless explicitly overridden.

### Evidence

- `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test`: 28 files passed, 451 tests passed.
- Live-fire verification against a real dev DB was not run; the reviewer blocked it as unsafe because a broken guard could wipe real dev data.

---

## Category 6: Runtime Error and Edge Case Handling

### Source Requirement

> "Fix 3 error handling gaps. At least one must involve a real user-facing data loss or confusion scenario (not just a missing loading spinner). Each fix requires reproduction steps, before/after behavior, and a screenshot or recording."

### Measurement Method


### Scorecard

| Metric | Baseline | Latest | Last Measured | Change | Required Change | Stretch Goal |
|--------|----------|--------|---------------|--------|-----------------|--------------|
| Console errors during normal usage | 0 across `/docs`, `/issues`, `/my-week`, and `/projects` after clearing Console | | | | Fix 3 error handling gaps | |
| Unhandled promise rejections (server) | No process-level `unhandledRejection` / `uncaughtException` handlers found | | | | At least 1 real user-facing data loss or confusion scenario | |
| Network disconnect recovery | Partial | | | | Reproduction steps | |
| Missing error boundaries | Partial boundary only | | | | Before/after behavior | |
| Silent failures identified | Backlinks fetch failures are console-only during disconnect | | | | Screenshot or recording | |
| Malformed input handling | Mixed | | | | Screenshot or recording | |
| Concurrent same-document editing | Pass for checked editor-body case | | | | Existing behavior preserved | |
| 3G throttled behavior | Partial pass | | | | Existing behavior preserved | |

### What Changed

- CSRF failures now return JSON 403 instead of falling through to Express HTML/error output. This is the Category 6 fix with direct before/after API evidence.
- Comments routes now check document visibility before listing, creating, updating, or deleting comments. This is tracked as an authorization/safety fix, not as proof toward the Category 6 user-facing error-handling target.
- Migration bootstrap still tolerates `schema.sql` "already exists" during initial setup, but numbered migration failures no longer get broadly swallowed. This is tracked as operational safety, not as proof toward the Category 6 user-facing error-handling target.

### Evidence

- API unit suite: 28 files passed, 451 tests passed.
- Missing-CSRF probe against local API returned `403`, `content-type: application/json; charset=utf-8`, body `{"error":"Invalid or missing CSRF token"}`.

---

## Category 7: Accessibility Compliance

### Source Requirement

> "Achieve a Lighthouse accessibility score improvement of 10+ points on the lowest-scoring page, or fix all Critical/Serious violations on the 3 most important pages. Provide before/after Lighthouse reports or axe scan output as evidence."

### Measurement Method

Targeted axe scan using `@axe-core/playwright` against local dev pages after login where needed.

### Scorecard

| Metric | Baseline | Latest | Last Measured | Change | Required Change | Stretch Goal |
|--------|----------|--------|---------------|--------|-----------------|--------------|
| Lighthouse accessibility score: `/login` | 98 | | | | 10+ point improvement on lowest-scoring page, or all Critical/Serious fixed on top 3 pages | |
| Lighthouse accessibility score: `/docs` | 91 | | | | Before/after Lighthouse reports or axe scan output | |
| Lighthouse accessibility score: `/documents/:id` | 91 | | | | Before/after Lighthouse reports or axe scan output | |
| Lighthouse accessibility score: `/issues` | 100 | | | | Before/after Lighthouse reports or axe scan output | |
| Lighthouse accessibility score: `/documents/:programId/issues` | 100 | | | | Before/after Lighthouse reports or axe scan output | |
| Lighthouse accessibility score: `/my-week` | 96 | | | | Before/after Lighthouse reports or axe scan output | |
| Lighthouse accessibility score: `/projects` | 100 | | | | Before/after Lighthouse reports or axe scan output | |
| Total Critical/Serious violations | Axe: 2 critical nodes and 40 serious nodes across scanned pages; Lighthouse: 6 page-failures across 4 unique issue types | Axe: 0 violations on `/login`, `/docs`, `/my-week`, `/projects` targeted scan | 2026-05-20 | Fixed targeted Critical/Serious set | Fix all Critical/Serious violations on top 3 pages if using violation target | |
| Keyboard navigation completeness | Partial pass | | | | Existing keyboard behavior preserved or improved | |
| Screen reader usability | VoiceOver partial pass | | | | Existing screen reader behavior preserved or improved | |
| Color contrast failures | Axe: `/my-week` 21 serious nodes, `/projects` 16 serious nodes | 0 on targeted rescan of `/my-week` and `/projects` | 2026-05-20 | Fixed | Critical/Serious violations fixed on selected pages | |
| Missing ARIA labels or roles | 2 pages with ARIA required-child failures: `/docs`, `/documents/:id`; `/login` lacks a main landmark | 0 on targeted rescan of `/login` and `/docs` | 2026-05-20 | Fixed targeted pages | Critical/Serious violations fixed on selected pages | |

### What Changed

- Added a `main` landmark to `/login`.
- Fixed contrast on `/my-week`, `/projects`, and shared filter-tab count badges.
- Fixed document tree semantics so `tree` containers expose direct `treeitem` children through presentational list wrappers.

### Evidence

- Axe scan output: `/login`, `/docs`, `/my-week`, `/projects` all returned `violations: []`; `/documents/:id` still needs a targeted rerun before claiming full coverage of the original document-page finding.
- Manual browser snapshots confirmed `/docs` exposes tree/treeitem semantics and `/my-week` + `/projects` render after the contrast changes.

---

## Additional Contract And Hygiene Wins

- Fixed Comments OpenAPI paths so generated contracts no longer double-prefix `/api`.
- Removed the advertised but unmounted `/search/documents` OpenAPI route instead of pretending full-text search exists.
- Regenerated `api/openapi.yaml` and `api/openapi.json`.
- Removed tracked generated/deployment debris: old deploy zips, Terraform plan binary, dev service worker output, and disposable progress/deployment notes.
- Added ignore rules for `deploy-api-*.zip` and `terraform/**/tfplan`.
- API build now cleans `api/dist` first and excludes source tests from production build output.
- Clarified `scripts/check-api-coverage.sh` as a staged heuristic, not real coverage.

### Evidence

- OpenAPI path inspection: comments paths now appear as `/documents/{id}/comments` and `/comments/{id}`; no `/api/documents/{id}/comments`, `/api/comments/{id}`, or `/search/documents` matches remain.
- `pnpm build:api`: pass.
- `find api/dist -path '*test*' -o -path '*__tests__*'`: no output.
- `./scripts/check-api-coverage.sh --staged`: pass; no staged JS/TS files to scan.
- `git diff --check`: pass.

---

## Deferred Or Skipped

- Real document full-text search: skipped; false OpenAPI contract removed instead.
- API latency/query optimization: skipped; needs benchmark/EXPLAIN-driven work, not quick fixes.
- Setup initialize race lock/transaction: deferred; security-sensitive.
- Super-admin API token policy and API-token docs/UI: deferred pending policy decision.
- Association/context visibility leaks: deferred; broader query surface than this pass.
- Route row-mapper typing: deferred; real type-safety work, but not quick if done honestly.
- Process-level unhandled rejection handlers: skipped; easy to add badly without shutdown semantics.
