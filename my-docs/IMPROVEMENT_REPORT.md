# Improvement Report

---

## Context

- Improvement date/time:
- Code state:
- Environment:
- Database:
- Runtime:
- Evidence:

---

## Category 1: Type Safety

### Source Requirement

> "Eliminate 25% of type safety violations. Every fix must preserve existing functionality (all tests still pass). Superficial fixes do not count. Replacing any with unknown without proper type narrowing is not an improvement. Each fix must include correct, meaningful types that reflect the actual data."

### Measurement Method


### Scorecard

| Metric | Baseline | Latest | Last Measured | Change | Required Change | Stretch Goal |
|--------|----------|--------|---------------|--------|-----------------|--------------|
| Total `any` types | 278 total / 94 production | | | | 25% total violation reduction | |
| Total type assertions (`as`) | 713 total / 504 production | | | | Meaningful reduction | |
| Total non-null assertions (`!`) | 348 total / 325 production | | | | Meaningful reduction | |
| Total `@ts-ignore` / `@ts-expect-error` | 1 total / 0 production | | | | No production suppressions | |
| Top 5 violation-dense files | `api/src/routes/weeks.ts` (85), `api/src/routes/projects.ts` (51), `api/src/routes/issues.ts` (49), `web/src/pages/UnifiedDocumentPage.tsx` (37), `api/src/db/seed.ts` (35) | | | | Highest-risk reductions must be real narrowing | |

### What Changed


### Evidence


---

## Category 2: Production Frontend Bundle Size

### Source Requirement

> "15% reduction in total production bundle size, or implement code splitting that reduces initial page load bundle by 20%. Provide before/after bundle analysis output. Removing functionality to shrink the bundle does not count."

### Measurement Method


### Scorecard

| Metric | Baseline | Latest | Last Measured | Change | Required Change | Stretch Goal |
|--------|----------|--------|---------------|--------|-----------------|--------------|
| Total production bundle size | 2,262.65 KB JS/CSS | | | | 15% reduction in total production bundle size | |
| Largest chunk | `assets/index-C2vAyoQ1.js` (2,025.10 KB) | | | | 20% reduction in initial page load bundle if using code splitting target | |
| Number of chunks | 262 JS/CSS chunks | | | | Before/after bundle analysis output | |
| Top 3 largest dependencies | `emoji-picker-react` (399.59 KB), `highlight.js` (377.92 KB), `yjs` (264.92 KB) | | | | No functionality removal | |
| Unused dependencies identified | `@tanstack/query-sync-storage-persister` | | | | Remove only if still confirmed unused | |

### What Changed


### Evidence


---

## Category 3: API Response Time

### Source Requirement

> "20% reduction in P95 response time on at least 2 endpoints. You must provide before/after benchmarks run under identical conditions (same data volume, same concurrency, same hardware). Document the root cause of each bottleneck."

### Measurement Method


### Scorecard

| Endpoint | Baseline P50 | Baseline P95 | Baseline P99 | Latest P50 | Latest P95 | Latest P99 | Last Measured | Change | Required Change | Stretch Goal |
|----------|--------------|--------------|--------------|------------|------------|------------|---------------|--------|-----------------|--------------|
| `GET /api/documents?type=wiki` | 10c: 7 ms; 25c: 17 ms; 50c: 25 ms | 10c: 21 ms; 25c: 42 ms; 50c: 65 ms | 10c: 23 ms; 25c: 46 ms; 50c: 71 ms | | | | | | 20% P95 reduction on at least 2 endpoints | |
| `GET /api/issues` | 10c: 7 ms; 25c: 14 ms; 50c: 29 ms | 10c: 22 ms; 25c: 35 ms; 50c: 66 ms | 10c: 25 ms; 25c: 38 ms; 50c: 72 ms | | | | | | 20% P95 reduction on at least 2 endpoints | |
| `GET /api/dashboard/my-week` | 10c: 5 ms; 25c: 12 ms; 50c: 16 ms | 10c: 21 ms; 25c: 32 ms; 50c: 34 ms | 10c: 26 ms; 25c: 34 ms; 50c: 36 ms | | | | | | Identical benchmark conditions | |
| `GET /api/projects` | 10c: 4 ms; 25c: 9 ms; 50c: 18 ms | 10c: 15 ms; 25c: 24 ms; 50c: 37 ms | 10c: 17 ms; 25c: 28 ms; 50c: 39 ms | | | | | | Identical benchmark conditions | |
| `GET /api/programs/:id/issues` | 10c: 4 ms; 25c: 9 ms; 50c: 19 ms | 10c: 16 ms; 25c: 26 ms; 50c: 38 ms | 10c: 18 ms; 25c: 28 ms; 50c: 40 ms | | | | | | Identical benchmark conditions | |

### What Changed


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


### Evidence


---

## Category 5: Test Coverage and Quality

### Source Requirement

> "Add meaningful tests for 3 previously untested critical paths, or fix 3 flaky tests with documented root cause analysis. 'Meaningful' means the test catches a real regression, not just asserting that a page loads. Each test must include a comment explaining what risk it mitigates."

### Measurement Method


### Scorecard

| Metric | Baseline | Latest | Last Measured | Change | Required Change | Stretch Goal |
|--------|----------|--------|---------------|--------|-----------------|--------------|
| Total tests | 1,471 executable tests across 99 files | | | | Add 3 meaningful tests or fix 3 flaky tests | |
| API unit tests | 451 pass / 0 fail / 0 flaky | | | | Existing tests still pass | |
| Web unit tests | 138 pass / 13 fail / 0 flaky | | | | Existing tests still pass | |
| E2E tests | 869 listed / not executed | | | | Meaningful tests catch real regressions | |
| Suite runtime | API unit: 10.76s; Web unit: 1.05s | | | | Document root cause if fixing flaky tests | |
| Code coverage | API: 40.34% statements, 33.44% branches, 40.9% functions, 40.52% lines; Web: not configured | | | | Risk-mitigating tests, not page-load assertions | |

### What Changed


### Evidence


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


### Evidence


---

## Category 7: Accessibility Compliance

### Source Requirement

> "Achieve a Lighthouse accessibility score improvement of 10+ points on the lowest-scoring page, or fix all Critical/Serious violations on the 3 most important pages. Provide before/after Lighthouse reports or axe scan output as evidence."

### Measurement Method


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
| Total Critical/Serious violations | Axe: 2 critical nodes and 40 serious nodes across scanned pages; Lighthouse: 6 page-failures across 4 unique issue types | | | | Fix all Critical/Serious violations on top 3 pages if using violation target | |
| Keyboard navigation completeness | Partial pass | | | | Existing keyboard behavior preserved or improved | |
| Screen reader usability | VoiceOver partial pass | | | | Existing screen reader behavior preserved or improved | |
| Color contrast failures | Axe: `/my-week` 21 serious nodes, `/projects` 16 serious nodes | | | | Critical/Serious violations fixed on selected pages | |
| Missing ARIA labels or roles | 2 pages with ARIA required-child failures: `/docs`, `/documents/:id`; `/login` lacks a main landmark | | | | Critical/Serious violations fixed on selected pages | |

### What Changed


### Evidence

