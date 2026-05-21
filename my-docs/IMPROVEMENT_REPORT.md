# 7Improvement Report

---

## Easy Wins Pass Summary

This pass captured quick, safe improvements from the audit work: contract drift fixes, repo/build hygiene, production bundle splitting, accessibility fixes, narrow type-safety cleanup, API test safety, CSRF JSON handling, comments visibility checks, and migration-runner error handling. The intentionally deferred items are still listed near the end so this report remains the current ledger for this work batch, not a final submission checklist.

## Second Easy-Wins Pass Summary

This pass harvested the next low-risk items from the audit ledger: typed route-level PostgreSQL row boundaries, removed easy editor/ProseMirror `any` usage, converted major route pages to lazy chunks, and reconciled stale discovery/doc status. The week route typing keeps canonical week properties distinct from legacy plan/review fields already read and written by existing endpoints, so the source-of-truth model is not widened by the type cleanup. It intentionally did not take on broad auth/request typing, security authorization findings, database performance work, or flaky-test repair.

## Structural Foundation Pass Summary

This pass tackled the cart-before-horse items from the audit: shared API boundary schemas, fewer duplicated document/property aliases in high-risk routes, transaction-aware association helpers, green web unit tests, exact inline comment mark removal, honest search documentation, corrected OpenAPI search/session contracts, and throttled session activity writes. Follow-up correctness review restored `project_id` issue filtering, hardened duplicate association sync, fixed the generated YAML writer, aligned inferred accountability OpenAPI with `weekly_retro`, and made `/auth/session` report the effective sliding inactivity expiry. It did not add real server-backed document search or a bootstrap endpoint; those remain deferred product/performance decisions.

## Submission-Gated Structural Pass Summary

This pass started from the remaining cart-before-horse work: fake-green rails, boundary contract drift, app-shell fanout, and command-palette search. Raw `pnpm test:e2e` now fails with guidance and the controlled runner uses the raw Playwright script internally. Shadow DB restore paths now fail closed instead of masking restore errors. Runtime boundary schemas now feed more OpenAPI schemas, with a focused contract drift test. The app has a read-only `/api/bootstrap` endpoint that hydrates existing React Query caches without replacing page-level APIs. Server-backed document search is title-only and used by the command palette only; `/docs` search remains client-side title filtering.

This report is a work ledger, not a final source-of-truth completion claim. Categories 3 and 4 remain intentionally incomplete until measured before/after improvements are made, and Category 5 now satisfies the full "3 meaningful tests or 3 flaky fixes" source requirement.

Durable choices from this pass are tracked in `my-docs/DECISION_LOG.md` so the rationale, alternatives, consequences, and evidence remain reviewable.

## Evidence-Runner And Trust Pass Summary

This pass added a repo-local evidence runner foundation, repeatable performance/query measurement scripts, a repeatable closeout axe runner, the third meaningful Category 5 regression, a stale E2E tree-selector fix, Backlinks offline/degraded behavior, and a narrow issue-boundary schema slice shared by runtime validation and OpenAPI. It intentionally does not claim Category 3 or 4 completion: the new scripts create the measurement rails, but before/after endpoint/query improvements still need to be captured under identical conditions. Category 6 is improved and manually observed, but still needs a saved screenshot/recording artifact before it should be claimed complete. Category 7 remains incomplete: the repeatable closeout axe scan clears `/docs`, but still finds serious color-contrast nodes on the selected document page and `/my-week`.

| Area | Target | Latest Result | Evidence |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type safety | Remove real `any` usage at API/Web boundaries | Shared boundary schemas added; high-risk route aliases now derive more from `@ship/shared`; previous AST `any` count remains 216 total / 32 production pending rerun | `pnpm type-check`, prior AST counter |
| Boundary contracts | Keep shared/runtime/OpenAPI document concepts aligned           | Added shared/runtime/OpenAPI/DB drift coverage for document and visibility values; OpenAPI regenerated after bootstrap/search schema additions                                                                | `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/bootstrap.test.ts src/schemas/document-boundary.test.ts src/routes/search.test.ts src/routes/documents-visibility.test.ts --config /dev/null`, OpenAPI YAML/JSON parse |
| Rails safety       | Remove fake-green execution paths                               | Raw E2E entrypoint now guides to `test:e2e:run`; DB-copy restore failures are no longer masked; API benchmark runner added for repeatable endpoint evidence                                                   | `pnpm test:e2e`, `pnpm test:e2e:run -- --list`, `node --check scripts/benchmark-api.mjs` |
| Bootstrap/search   | Reduce request fanout and avoid command-palette full-list fetch | Added `/api/bootstrap`; command palette now calls title-only `/api/search/documents`; `/docs` search unchanged | Focused API tests: 4 files passed, 43 tests passed; `pnpm --filter @ship/api type-check`; `pnpm --filter @ship/web type-check` |
| Evidence rails | Make submission proof repeatable and honest | Added `pnpm evidence:run`, `pnpm evidence:compare`, `pnpm perf:seed-audit-load`, `pnpm perf:query-count-api`, and `pnpm perf:explain`; final-review evidence run now fails the manifest when a nested claim fails | `pnpm evidence:run -- --phase final-review --run-id codex-final-review`; `pnpm evidence:compare codex-final-check codex-final-review`; `node --check scripts/{seed-audit-load,query-count-api,explain-performance}.mjs` |
| Bundle splitting   | Reduce initial entry chunk via route-level lazy loading         | Entry chunk is around 509.5 KB after route-level lazy loading; build hash varies by rebuild; 295 JS/CSS chunks emitted in the last full web build                                                             | `pnpm build:web`, dist asset byte count |
| Verification       | Preserve build/type correctness | Type-check, API build, and web build pass | `pnpm type-check`, `pnpm build:api`, `pnpm build:web` |
| Test state         | Restore trust in normal unit gates                              | Category 5 now has three meaningful regressions; full API and web unit suites pass; stale accessibility tree selector now passes its focused E2E rerun | `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test`, `pnpm --filter @ship/web test`, `E2E_RESULTS_DIR=test-results/a11y-tree-closeout pnpm test:e2e:run e2e/accessibility-remediation.spec.ts -g "navigating to nested document auto-expands tree ancestors"` |

---

## Context

- Improvement date/time: 2026-05-20 local
- Code state: cumulative easy-wins, structural, and submission-gated foundation passes, modified in current checkout
- Environment: local pnpm workspace
- Database: `ship_test_audit` for API unit verification; disposable `ship_test_check_20260520` was also used while validating local PostgreSQL recovery; `ship_dev`/dev server for browser checks
- Runtime: API `http://localhost:3001`, web `http://localhost:5175`
- Evidence: `pnpm type-check`, `pnpm build:api`, `pnpm build:web`, AST type-safety count, production bundle output, web unit suite run, API unit suite run, OpenAPI generation

---

## Category 1: Type Safety

### Source Requirement

> "Eliminate 25% of type safety violations. Every fix must preserve existing functionality (all tests still pass). Superficial fixes do not count. Replacing any with unknown without proper type narrowing is not an improvement. Each fix must include correct, meaningful types that reflect the actual data."

### Measurement Method

Official before/after `any` counts use the TypeScript AST audit counter described in `AUDIT_REPORT.md`. ESLint JSON remains the worklist and fast feedback loop, filtered for production files by excluding tests and test helpers. Type-check remains the correctness gate.

### Scorecard

| Metric                                  | Baseline                                                                                                                                                                    | Latest                     | Last Measured | Change                                                                                                    | Required Change                                | Stretch Goal                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| Total `any` types                       | 278 total / 94 production                                                                                                                                                   | 216 total / 32 production  | 2026-05-20    | -62 total / -62 production; production subset clears 25%, repo-wide total is 22.3% and does not yet clear | 25% total violation reduction                  | 75% total violation reduction |
| Total type assertions (`as`)            | 713 total / 504 production                                                                                                                                                  | 638 total / 433 production | 2026-05-20    | -75 total / -71 production                                                                                | Meaningful reduction                           | 75% total violation reduction |
| Total non-null assertions (`!`)         | 348 total / 325 production                                                                                                                                                  | 348 total / 325 production | 2026-05-20    | No change                                                                                                 | Meaningful reduction                           | 75% total violation reduction |
| Total `@ts-ignore` / `@ts-expect-error` | 1 total / 0 production                                                                                                                                                      | 1 total / 0 production     | 2026-05-20    | No change                                                                                                 | No production suppressions                     |                               |
| Top 5 violation-dense files             | `api/src/routes/weeks.ts` (85), `api/src/routes/projects.ts` (51), `api/src/routes/issues.ts` (49), `web/src/pages/UnifiedDocumentPage.tsx` (37), `api/src/db/seed.ts` (35) |                            |               |                                                                                                           | Highest-risk reductions must be real narrowing |                               |

### What Changed

- Ran ESLint autofix for redundant assertions.
- Typed upload service JSON response boundaries in `web/src/services/upload.ts`.
- Changed narrow dynamic SQL parameter arrays from `any[]` to `unknown[]` where type-check accepted it cleanly. This is cleanup, not counted as the main meaningful type-safety win.
- Second pass typed local PostgreSQL row boundaries in route files, replaced the remaining `states as any` SQL parameter cast, and typed editor/ProseMirror helper callbacks with library types.
- Week/sprint route row typing now separates canonical week properties (`sprint_number`, `owner_id`) from legacy route fields that existing plan/review endpoints still read or write.
- Structural pass added API-local boundary schemas for shared document concepts, aligned issue priority/accountability enums, routed issue-list query parsing through Zod, made document association helpers transaction-capable, and moved high-risk route property aliases closer to `@ship/shared` types.
- Submission-gated pass exported boundary value tuples, reused runtime boundary schemas in OpenAPI for document, visibility, association, issue source/state/priority, and accountability concepts, and added a drift test across shared/runtime/OpenAPI/DB document values.
- Evidence-runner pass moved issue create/update request validation into shared runtime boundary schemas reused by OpenAPI, added `IssueProperties` property-key drift coverage, and kept the slice limited to issue boundary contracts.

### Evidence

- `pnpm type-check`: pass.
- AST `any` count after second pass: 216 total / 32 production.
- AST `as` count after second pass: 638 total / 433 production.
- AST non-null assertion count after second pass: 348 total / 325 production.
- ESLint JSON was not rerun in the second pass; AST counts remain the official measurement.
- Production `any` count by official AST counter: 94 -> 32.
- `pnpm type-check`: pass after structural boundary changes.
- `pnpm --filter @ship/api exec vitest run src/schemas/document-boundary.test.ts --config /dev/null`: 2 tests passed.
- Focused integration rerun with local PostgreSQL access: `pnpm --filter @ship/api exec vitest run src/schemas/document-boundary.test.ts src/routes/search.test.ts src/routes/documents-visibility.test.ts --config /dev/null`: 3 files passed, 41 tests passed.
- Post-reset focused route/contract rerun against a temporary disposable Postgres container: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/bootstrap.test.ts src/schemas/document-boundary.test.ts src/routes/search.test.ts src/routes/documents-visibility.test.ts --config /dev/null`: 4 files passed, 43 tests passed.
- Evidence-runner focused boundary rerun: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/issues.test.ts src/routes/documents-visibility.test.ts src/schemas/document-boundary.test.ts`: 3 files passed, 51 tests passed.
- `pnpm --filter @ship/api type-check`: pass.

---

## Category 2: Production Frontend Bundle Size

### Source Requirement

> "15% reduction in total production bundle size, or implement code splitting that reduces initial page load bundle by 20%. Provide before/after bundle analysis output. Removing functionality to shrink the bundle does not count."

### Measurement Method

Production Vite build output plus `web/dist/assets` JS/CSS byte count. Source-complete bundle evidence still needs a committed treemap or equivalent before/after bundle analysis artifact.

### Scorecard

| Metric                         | Baseline                                                                        | Latest                                       | Last Measured | Change                                        | Required Change                                                          | Stretch Goal |
| ------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------- | ------------- | --------------------------------------------- | ------------------------------------------------------------------------ | ------------ |
| Total production bundle size   | 2,262.65 KB JS/CSS                                                              | 2,271.41 KB JS/CSS                           | 2026-05-20    | +8.76 KB                                      | 15% reduction in total production bundle size                            |              |
| Largest chunk                  | `assets/index-C2vAyoQ1.js` (2,025.10 KB)                                        | `assets/PropertyRow-CjRuJvKg.js` (836.63 KB) | 2026-05-20    | -1,188.47 KB / -58.7% largest-chunk reduction | 20% reduction in initial page load bundle if using code splitting target |              |
| Initial entry chunk            | `assets/index-C2vAyoQ1.js` (2,025.10 KB)                                        | `assets/index-CQekVCcO.js` (509.53 KB)       | 2026-05-20    | -1,515.57 KB / -74.8%                         | 20% reduction in initial page load bundle                                |              |
| Number of chunks               | 262 JS/CSS chunks                                                               | 295 JS/CSS chunks                            | 2026-05-20    | +33 chunks                                    | Before/after bundle analysis output                                      |              |
| Top 3 largest dependencies     | `emoji-picker-react` (399.59 KB), `highlight.js` (377.92 KB), `yjs` (264.92 KB) |                                              |               |                                               | No functionality removal                                                 |              |
| Unused dependencies identified | `@tanstack/query-sync-storage-persister`                                        |                                              |               |                                               | Remove only if still confirmed unused                                    |              |

### What Changed

- Dev-only lazy import for React Query Devtools.
- Lazy-loaded `emoji-picker-react` behind the emoji picker UI.
- Removed unused `@tanstack/query-sync-storage-persister` dependency after confirming no source/package imports.
- Second pass lazy-loaded major leaf route pages from `web/src/main.tsx` while keeping providers, guards, redirects, and `AppLayout` eager.

### Evidence

- `pnpm build:web`: pass.
- Largest production entry chunk: 2,025.10 KB -> 509.53 KB.
- New emoji picker async chunk: 271.11 KB.
- Route-level lazy chunks now include `UnifiedDocumentPage-CSRnSbAM.js` (133.22 KB), `ReviewsPage-FqsUksAC.js` (28.39 KB), `TeamMode-lSiJNvGc.js` (21.76 KB), and other route-specific page chunks.
- `rg "ReactQueryDevtools|Open Tanstack query devtools" web/dist/assets`: no production bundle matches.

---

## Category 3: API Response Time

### Source Requirement

> "20% reduction in P95 response time on at least 2 endpoints. You must provide before/after benchmarks run under identical conditions (same data volume, same concurrency, same hardware). Document the root cause of each bottleneck."

### Measurement Method

### Scorecard

| Endpoint                       | Baseline P50                     | Baseline P95                       | Baseline P99                       | Latest P50 | Latest P95 | Latest P99 | Last Measured | Change | Required Change                           | Stretch Goal |
| ------------------------------ | -------------------------------- | ---------------------------------- | ---------------------------------- | ---------- | ---------- | ---------- | ------------- | ------ | ----------------------------------------- | ------------ |
| `GET /api/documents?type=wiki` | 10c: 8 ms; 25c: 8 ms; 50c: 9 ms  | 10c: 11 ms; 25c: 10 ms; 50c: 11 ms | 10c: 12 ms; 25c: 11 ms; 50c: 15 ms |            |            |            |               |        | 20% P95 reduction on at least 2 endpoints |              |
| `GET /api/issues`              | 10c: 10 ms; 25c: 9 ms; 50c: 9 ms | 10c: 13 ms; 25c: 11 ms; 50c: 11 ms | 10c: 19 ms; 25c: 15 ms; 50c: 19 ms |            |            |            |               |        | 20% P95 reduction on at least 2 endpoints |              |
| `GET /api/dashboard/my-week`   | 10c: 9 ms; 25c: 9 ms; 50c: 11 ms | 10c: 12 ms; 25c: 11 ms; 50c: 13 ms | 10c: 13 ms; 25c: 15 ms; 50c: 14 ms |            |            |            |               |        | Identical benchmark conditions            |              |
| `GET /api/projects`            | 10c: 7 ms; 25c: 8 ms; 50c: 8 ms  | 10c: 9 ms; 25c: 9 ms; 50c: 9 ms    | 10c: 11 ms; 25c: 11 ms; 50c: 11 ms |            |            |            |               |        | Identical benchmark conditions            |              |
| `GET /api/programs/:id/issues` | 10c: 7 ms; 25c: 7 ms; 50c: 8 ms  | 10c: 9 ms; 25c: 9 ms; 50c: 9 ms    | 10c: 10 ms; 25c: 10 ms; 50c: 11 ms |            |            |            |               |        | Identical benchmark conditions            |              |

### What Changed

- Added `scripts/benchmark-api.mjs` and `pnpm benchmark:api` to make repeated API timing evidence reproducible across fixed auth, endpoint set, concurrency matrix, duration, rate cap, and JSON output.
- Added `/api/bootstrap` to combine app-shell data already fetched by current providers. This is a fanout reduction candidate, not yet a claimed P95 win.
- Added `pnpm evidence:run` / `pnpm evidence:compare` so API benchmark output can be captured with repo metadata, environment, claims, and artifact paths.

### Evidence

- `node --check scripts/benchmark-api.mjs`: pass.
- `pnpm evidence:run -- --phase closeout --run-id closeout-check`: completed and writes `my-docs/evidence-runs/closeout-check/`; the manifest is correctly failed because the nested `openapi.prettier.json` claim is failed, while incomplete proof lanes remain `not_measured`.
- Before/after benchmark output for the new bootstrap path is still `TBD`; do not claim Category 3 completion from this pass.

---

## Category 4: Database Query Efficiency

### Source Requirement

> "20% reduction in total query count on at least one user flow, or 50% improvement on the slowest query. Provide before/after EXPLAIN ANALYZE output. Document what was inefficient and why your change fixes it."

### Measurement Method

### Scorecard

| User Flow         | Baseline Total Queries | Baseline Slowest Query | Baseline N+1 Detected?                                             | Latest Total Queries | Latest Slowest Query | Latest N+1 Detected? | Last Measured | Change | Required Change                                             | Stretch Goal |
| ----------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------ | -------------------- | -------------------- | -------------------- | ------------- | ------ | ----------------------------------------------------------- | ------------ |
| Load main page    | 41                     | 4.00 ms                | No row-level N+1; repeated session/auth checks across 10 API calls |                      |                      |                      |               |        | 20% fewer queries on at least one flow                      |              |
| View a document   | 5                      | 0.56 ms                | No                                                                 |                      |                      |                      |               |        | 50% improvement on slowest query if using query-time target |              |
| List issues       | 5                      | 1.00 ms                | No                                                                 |                      |                      |                      |               |        | Before/after EXPLAIN ANALYZE output                         |              |
| Load sprint board | 9                      | 0.57 ms                | No                                                                 |                      |                      |                      |               |        | Before/after EXPLAIN ANALYZE output                         |              |
| Search content    | 0                      | N/A                    | N/A; client-side filter only                                       |                      |                      |                      |               |        | Document what was inefficient                               |              |

### What Changed

- Added `/api/bootstrap` and React Query cache seeding for current app-shell providers: auth/session payload, wiki documents, programs, projects, issues, standup status, and action items.
- The command palette now queries title-only `/api/search/documents` on demand instead of fetching the full documents list for palette search.
- Added `pnpm perf:seed-audit-load`, `pnpm perf:query-count-api`, and `pnpm perf:explain` to make audit-scale data setup, query-count capture, and EXPLAIN capture repeatable. The seed rail tops up the source-required scale shape: 500+ documents, 100+ issues, 20+ users, and 10+ sprints.
- Query-count and slow-query scorecard values remain `TBD` until the before/after harness is rerun against the same data volume and browser flow.

### Evidence

- `GET /api/bootstrap` has focused route coverage for auth, response shape, and project status inference.
- `/api/search/documents` has focused route coverage for auth, title-only behavior, type filtering, limits, and visibility.
- Focused route/contract rerun against a temporary disposable Postgres container: 4 files passed, 43 tests passed.
- Measurement script syntax checks passed: `node --check scripts/seed-audit-load.mjs`, `node --check scripts/query-count-api.mjs`, and `node --check scripts/explain-performance.mjs`.
- Closeout rail outputs were produced: `test-results/perf/query-count-api-2026-05-20T23-37-27-346Z.json` and `test-results/perf/explain-performance-2026-05-20T23-37-37-930Z.json`.
- Before/after query-count output and `EXPLAIN ANALYZE` evidence are still `TBD`; do not claim Category 4 completion from this pass.

---

## Category 5: Test Coverage and Quality

### Source Requirement

> "Add meaningful tests for 3 previously untested critical paths, or fix 3 flaky tests with documented root cause analysis. 'Meaningful' means the test catches a real regression, not just asserting that a page loads. Each test must include a comment explaining what risk it mitigates."

### Measurement Method

### Scorecard

| Metric         | Baseline                                                                                    | Latest                                                       | Last Measured | Change                                                                                                                           | Required Change                                 | Stretch Goal |
| -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------ |
| Unit tests     | API baseline: 451 pass / 0 fail; Web baseline: 138 pass / 13 fail                           | API: 466 pass; Web: 154 pass | 2026-05-20    | Category 5 now has three meaningful regressions: overlapping comment marks, project issue filtering, and private document comment visibility | Add 3 meaningful tests or fix 3 flaky tests     |              |
| API unit tests | 451 pass / flaky status not fully assessed                                                  | 466 pass; flakiness not fully assessed | 2026-05-20    | Added private document comment visibility regression and risk comment for project issue-filter coverage | Existing tests still pass                       |              |
| Web unit tests | 138 pass / 13 fail / flaky status not fully assessed                                        | 155 pass; flakiness not fully assessed | 2026-05-20    | Added `BacklinksPanel.test.tsx`; existing `CommentMark.test.ts` remains the inline-comment regression | Existing tests still pass                       |              |
| E2E tests      | 869 listed / not executed                                                                   | 862 pass / 1 fail / 6 flaky                                  | 2026-05-20    | First full safe-run baseline captured; no app-behavior changes in the E2E runner work                                            | Meaningful tests catch real regressions         |              |
| Suite runtime  | API unit: 10.76s; Web unit: 1.05s                                                           | API unit: 11.18s; Web unit: 1.24s; E2E: 6.6m                 | 2026-05-20    | Comparable unit runtime; first full safe-run E2E runtime captured                                                                | Document root cause if fixing flaky tests       |              |
| Code coverage  | API: 40.34% statements, 33.44% branches, 40.9% functions, 40.52% lines; Web: not configured |                                                              |               |                                                                                                                                  | Risk-mitigating tests, not page-load assertions |              |

### What Changed

- Added a destructive-test-DB guard in API test setup so truncation only runs against disposable database names such as `ship_test_audit`, unless explicitly overridden.
- Fixed stale web unit tests for document tab contracts, DetailsExtension child nodes, and CSRF-aware session extension.
- Fixed inline comment cancellation by removing the exact `commentMark` instance for the requested `commentId`, with a focused overlapping-mark unit regression.
- Added the required risk comment to the project issue-filter regression.
- Added private document comment visibility regression coverage: document-scoped comments return `404` to a non-creator workspace member, preserving the private document existence boundary.
- Fixed the known E2E accessibility tree selector to locate nested documents through the sidebar ARIA tree/group structure. This is test-trust cleanup, not counted as Category 5.
- Category 5 now satisfies the source requirement through three meaningful regressions: overlapping comment-mark removal, project issue filtering through document associations, and private document comment visibility.

### Evidence

- `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test`: 28 files passed, 452 tests passed.
- Live-fire verification against a real dev DB was not run; the reviewer blocked it as unsafe because a broken guard could wipe real dev data.
- Historical second-pass API verification initially failed while local PostgreSQL was down. After starting the local PostgreSQL service, `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test` passed with 28 files and 451 tests. Current API verification after the project-filter regression test is 452 passing tests.
- Migration command caveat resolved for the currently observed schema/migration split-brain: `010_oauth_state.sql`, `025_prevent_circular_parent.sql`, `033_sprint_to_week_rename.sql`, and `035_add_comments.sql` are now idempotent enough for `schema.sql` + numbered migrations to complete on the Docker-backed `ship_dev` and sidecar `ship_test_audit` databases.
- `pnpm --filter @ship/web test`: 17 files passed, 152 tests passed.
- `pnpm --filter @ship/web exec vitest run web/src/lib/document-tabs.test.ts web/src/components/editor/DetailsExtension.test.ts web/src/hooks/useSessionTimeout.test.ts web/src/components/editor/CommentMark.test.ts`: 4 files passed, 67 tests passed.
- Correctness review targeted API rerun: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/issues.test.ts src/routes/associations-regression.test.ts src/routes/auth.test.ts`: 3 files passed, 50 tests passed.
- Correctness review targeted web rerun: `pnpm --filter @ship/web exec vitest run src/components/editor/CommentMark.test.ts src/hooks/useSessionTimeout.test.ts src/components/editor/DetailsExtension.test.ts src/lib/document-tabs.test.ts`: 4 files passed, 67 tests passed. Existing React `act(...)` warnings remain in `useSessionTimeout.test.ts`.
- `ruby -e "require 'yaml'; YAML.load_file('/Users/michaelhabermas/repos/GAI/ship-shape/api/openapi.yaml')"`: generated OpenAPI YAML parses after fixing the local YAML writer.
- Final API rerun after correctness fixes: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test`: 28 files passed, 452 tests passed.
- Focused inline-comment E2E rerun was not rerun during closeout; unit-level inline comment regression remains covered by `CommentMark.test.ts`, and the closeout E2E slot was used for the stale accessibility tree selector proof.
- Separate full E2E baseline: `E2E_RESULTS_DIR=test-results/full-run pnpm test:e2e:run` completed in 6.6 minutes with 862 passed, 1 failed, and 6 flaky. The hard failure was `e2e/accessibility-remediation.spec.ts` / "navigating to nested document auto-expands tree ancestors"; screenshot and accessibility snapshot showed seeded nested documents visible in the sidebar, while the assertion searched for a nested `ul` under the expanded item. Current tree semantics expose nested items through ARIA `group` structure, so this is likely a stale test-shape/selector issue rather than evidence that the runner work regressed product behavior.
- Evidence-runner focused API rerun after adding the private comment visibility regression: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/issues.test.ts src/routes/documents-visibility.test.ts src/schemas/document-boundary.test.ts`: 3 files passed, 51 tests passed. Initial sandboxed attempt failed with `EPERM` connecting to local PostgreSQL; the approved local-Postgres rerun passed.
- Evidence-runner focused web rerun: `pnpm --filter @ship/web exec vitest run src/components/editor/BacklinksPanel.test.tsx src/components/editor/CommentMark.test.ts`: 2 files passed, 4 tests passed.
- Full API suite rerun: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test`: 30 files passed, 466 tests passed.
- Full web suite rerun: `pnpm --filter @ship/web test`: 18 files passed, 155 tests passed. Existing React `act(...)` warnings remain in `useSessionTimeout.test.ts`.
- Focused E2E rerun for the tree selector passed: `E2E_RESULTS_DIR=test-results/a11y-tree-closeout pnpm test:e2e:run e2e/accessibility-remediation.spec.ts -g "navigating to nested document auto-expands tree ancestors"`: 1 passed / 0 failed.

---

## Category 6: Runtime Error and Edge Case Handling

### Source Requirement

> "Fix 3 error handling gaps. At least one must involve a real user-facing data loss or confusion scenario (not just a missing loading spinner). Each fix requires reproduction steps, before/after behavior, and a screenshot or recording."

### Measurement Method

### Scorecard

| Metric                                | Baseline                                                                        | Latest | Last Measured | Change | Required Change                                             | Stretch Goal |
| ------------------------------------- | ------------------------------------------------------------------------------- | ------ | ------------- | ------ | ----------------------------------------------------------- | ------------ |
| Console errors during normal usage    | 0 across `/docs`, `/issues`, `/my-week`, and `/projects` after clearing Console |        |               |        | Fix 3 error handling gaps                                   |              |
| Unhandled promise rejections (server) | No process-level `unhandledRejection` / `uncaughtException` handlers found      |        |               |        | At least 1 real user-facing data loss or confusion scenario |              |
| Network disconnect recovery           | Partial                                                                         |        |               |        | Reproduction steps                                          |              |
| Missing error boundaries              | Partial boundary only                                                           |        |               |        | Before/after behavior                                       |              |
| Silent failures identified            | Backlinks fetch failures are console-only during disconnect                     |        |               |        | Screenshot or recording                                     |              |
| Malformed input handling              | Mixed                                                                           |        |               |        | Screenshot or recording                                     |              |
| Concurrent same-document editing      | Pass for checked editor-body case                                               |        |               |        | Existing behavior preserved                                 |              |
| 3G throttled behavior                 | Partial pass                                                                    |        |               |        | Existing behavior preserved                                 |              |

### What Changed

- CSRF failures now return JSON 403 instead of falling through to Express HTML/error output. This is the Category 6 fix with direct before/after API evidence.
- Comments routes now check document visibility before listing, creating, updating, or deleting comments. This is tracked as an authorization/safety fix, not as proof toward the Category 6 user-facing error-handling target.
- Migration bootstrap still tolerates `schema.sql` "already exists" during initial setup, but numbered migration failures no longer get broadly swallowed. This is tracked as operational safety, not as proof toward the Category 6 user-facing error-handling target.
- Session activity writes are now throttled server-side: authenticated requests still validate inactivity against stored `last_activity`, but only update `last_activity` and refresh the cookie after the 60-second activity threshold.
- Backlinks now preserve the last successful result during fetch failures, show a visible offline/stale status with `role="status"` and `aria-live="polite"`, pause polling while offline, retry immediately when the browser returns online, and avoid repeated console-error spam.

### Evidence

- API unit suite: 28 files passed, 452 tests passed in the current post-correctness run.
- Missing-CSRF probe against local API returned `403`, `content-type: application/json; charset=utf-8`, body `{"error":"Invalid or missing CSRF token"}`.
- `pnpm --filter @ship/web exec vitest run src/components/editor/BacklinksPanel.test.tsx src/components/editor/CommentMark.test.ts`: 2 files passed, 4 tests passed.
- Category 6 still needs the required before/after screenshot or recording evidence before completion should be claimed.

---

## Category 7: Accessibility Compliance

### Source Requirement

> "Achieve a Lighthouse accessibility score improvement of 10+ points on the lowest-scoring page, or fix all Critical/Serious violations on the 3 most important pages. Provide before/after Lighthouse reports or axe scan output as evidence."

### Measurement Method

Targeted axe scan using `@axe-core/playwright` against local dev pages after login where needed.

### Scorecard

| Metric                                                         | Baseline                                                                                                                 | Latest                                                                                                        | Last Measured | Change                  | Required Change                                                                                | Stretch Goal |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| Lighthouse accessibility score: `/login`                       | 98                                                                                                                       |                                                                                                               |               |                         | 10+ point improvement on lowest-scoring page, or all Critical/Serious fixed on top 3 pages     |              |
| Lighthouse accessibility score: `/docs`                        | 91                                                                                                                       |                                                                                                               |               |                         | Before/after Lighthouse reports or axe scan output                                             |              |
| Lighthouse accessibility score: `/documents/:id`               | 91                                                                                                                       |                                                                                                               |               |                         | Before/after Lighthouse reports or axe scan output                                             |              |
| Lighthouse accessibility score: `/issues`                      | 100                                                                                                                      |                                                                                                               |               |                         | Before/after Lighthouse reports or axe scan output                                             |              |
| Lighthouse accessibility score: `/documents/:programId/issues` | 100                                                                                                                      |                                                                                                               |               |                         | Before/after Lighthouse reports or axe scan output                                             |              |
| Lighthouse accessibility score: `/my-week`                     | 96                                                                                                                       |                                                                                                               |               |                         | Before/after Lighthouse reports or axe scan output                                             |              |
| Lighthouse accessibility score: `/projects`                    | 100                                                                                                                      |                                                                                                               |               |                         | Before/after Lighthouse reports or axe scan output                                             |              |
| Total Critical/Serious violations                              | Axe: 2 critical nodes and 40 serious nodes across scanned pages; Lighthouse: 6 page-failures across 4 unique issue types | `pnpm a11y:closeout`: `/docs` 0, selected `/documents/:id` 1 serious `color-contrast` node, `/my-week` 1 serious `color-contrast` violation across 10 nodes | 2026-05-20    | Improved but still fails | Fix all Critical/Serious violations on explicitly chosen top 3 pages if using violation target |              |
| Keyboard navigation completeness                               | Partial pass                                                                                                             |                                                                                                               |               |                         | Existing keyboard behavior preserved or improved                                               |              |
| Screen reader usability                                        | VoiceOver partial pass                                                                                                   |                                                                                                               |               |                         | Existing screen reader behavior preserved or improved                                          |              |
| Color contrast failures                                        | Axe: `/my-week` 21 serious nodes, `/projects` 16 serious nodes                                                           | `pnpm a11y:closeout`: selected document page has 1 serious badge contrast node; `/my-week` still has 10 serious color-contrast nodes | 2026-05-20    | Improved but not fixed  | Critical/Serious violations fixed on selected pages                                            |              |
| Missing ARIA labels or roles                                   | 2 pages with ARIA required-child failures: `/docs`, `/documents/:id`; `/login` lacks a main landmark                     | 0 on closeout axe scan of `/docs` and `/documents/:id`                                                        | 2026-05-20    | Fixed targeted pages    | Critical/Serious violations fixed on selected pages                                            |              |

### What Changed

- Added a `main` landmark to `/login`.
- Fixed contrast on `/my-week`, `/projects`, and shared filter-tab count badges.
- Fixed document tree semantics so `tree` containers expose direct `treeitem` children through presentational list wrappers.
- Fixed the stale E2E selector for nested document auto-expand to use the sidebar ARIA tree and nested `role="group"` structure instead of assuming the group is inside the `treeitem` element.

### Evidence

- Repeatable closeout axe output: `pnpm a11y:closeout` writes `test-results/a11y-closeout/axe-summary.json` and screenshots for `/docs`, a real `/documents/:id`, and `/my-week`. Current output shows `/docs` at 0 violations, the selected document page with 1 serious badge contrast node, and `/my-week` with 1 serious `color-contrast` violation across 10 nodes. The script supports `-- --fail-on-serious` once these pages are expected to block on violations.
- Focused E2E verification for the updated selector passed: `E2E_RESULTS_DIR=test-results/a11y-tree-closeout pnpm test:e2e:run e2e/accessibility-remediation.spec.ts -g "navigating to nested document auto-expands tree ancestors"`: 1 passed / 0 failed.
- Lighthouse was not rerun because `lighthouse` is not installed in the repo-local toolchain (`pnpm exec lighthouse --version` returns command not found).
- Manual closeout found Backlinks behavior working as intended after creating a real mention: the target document showed the source document as a backlink, offline mode retained that saved backlink with an explicit stale status, reconnect cleared the stale state, and clicking the backlink navigated back to the source.
- Manual closeout also found non-blocking but real keyboard/a11y debt: Action Items modal focus is trapped and Escape works, but the close button is skipped or invisible in tab flow and row focus stops are visually unclear; the docs tree has visible focus and Enter expand/collapse, but arrow-key tree navigation is not implemented.
- Manual closeout surfaced a Radix warning from `SessionTimeoutModal`, not Action Items. The fix lets Radix own the dialog title/description ids and adds a focused regression test that fails if `DialogContent` title/description warnings return.

---

## Additional Contract And Hygiene Wins

- Fixed Comments OpenAPI paths so generated contracts no longer double-prefix `/api`.
- Removed the advertised but unmounted `/search/documents` OpenAPI route instead of pretending full-text search exists.
- Fixed `/search/learnings` OpenAPI response shape to `{ learnings, total }`.
- Fixed `/auth/session` OpenAPI response shape to the timeout-tracking payload actually returned by the route.
- Updated canonical docs to state that `/docs` search is client-side title filtering; real server-backed document search remains deferred.
- Regenerated `api/openapi.yaml` and `api/openapi.json`.
- Removed tracked generated/deployment debris: old deploy zips, Terraform plan binary, dev service worker output, and disposable progress/deployment notes.
- Added ignore rules for `deploy-api-*.zip` and `terraform/**/tfplan`.
- API build now cleans `api/dist` first and excludes source tests from production build output.
- Clarified `scripts/check-api-coverage.sh` as a staged heuristic, not real coverage.
- Added evidence-runner package scripts and repeatable performance/query measurement scripts.
- Added `.gitignore` exceptions so `scripts/evidence/**` is tracked despite the broad local `evidence/` screenshot ignore rule.

### Evidence

- OpenAPI path inspection: comments paths now appear as `/documents/{id}/comments` and `/comments/{id}`; no `/api/documents/{id}/comments`, `/api/comments/{id}`, or `/search/documents` matches remain.
- Submission-gated follow-up changed `/api/search/documents` from a removed false full-text contract into a real title-only command-palette endpoint; full-text document search remains deferred.
- OpenAPI YAML now parses and passes `pnpm exec prettier --check api/openapi.yaml` after fixing the generator's multiline YAML output.
- Docker-backed migration rerun: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_dev pnpm --filter @ship/api db:migrate` passes.
- Sidecar DB migration rerun: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api db:migrate` passes.
- `pnpm build:api`: pass.
- `find api/dist -path '*test*' -o -path '*__tests__*'`: no output.
- `./scripts/check-api-coverage.sh --staged`: pass; no staged JS/TS files to scan.
- `git diff --check`: pass.
- `pnpm evidence:run -- --phase closeout --run-id closeout-check`: completed; the manifest is correctly failed because the nested `openapi.prettier.json` claim is failed, while incomplete proof lanes remain `not_measured`.
- `pnpm evidence:compare codex-final-review closeout-check`: pass.
- `node --check scripts/evidence/run.mjs`, `node --check scripts/evidence/compare.mjs`, `node --check scripts/seed-audit-load.mjs`, `node --check scripts/query-count-api.mjs`, and `node --check scripts/explain-performance.mjs`: pass.

---

## Deferred Or Skipped

- Real document full-text search: skipped; command-palette title-only `/api/search/documents` is implemented, but content search remains a separate product decision.
- Bootstrap endpoint for app-shell hydration: implemented as foundation; request/query-count scripts now exist, but before/after query-count measurement is still `TBD`.
- API latency/query optimization: skipped; needs benchmark/EXPLAIN-driven work, not quick fixes.
- Setup initialize race lock/transaction: deferred; security-sensitive.
- Super-admin API token policy and API-token docs/UI: deferred pending policy decision.
- Association/context visibility leaks: deferred; broader query surface than this pass.
- Full route row-mapper typing: partially started for high-risk routes; broader dashboard/comments/auth route typing deferred.
- Process-level unhandled rejection handlers: skipped; easy to add badly without shutdown semantics.
- Category 6 screenshot/recording evidence: deferred; Backlinks behavior has unit coverage but not the required runtime artifact.
- Category 7 final completion: deferred because `pnpm a11y:closeout` still finds serious color-contrast violations on the selected document page and `/my-week`, and Lighthouse is not installed in the repo-local toolchain.
