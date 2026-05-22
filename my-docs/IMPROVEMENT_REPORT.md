# Improvement Report

---

## Architecture Deepening Pass Summary (2026-05-21)

Structural pass implementing all eight architecture-deepening clusters (seven product seams + E2E fixture harness). No git commits in this pass; verification below.

| Cluster | Deliverable | Category tie-in |
|---------|-------------|-----------------|
| #6 Associations | `syncAssociationOfType*`, `syncProgramAssociation`; issues/projects migrated | Category 5 — regression suite still passes (485 API tests) |
| #3 Document types | `shared/src/document-view.ts`; `UnifiedEditor` + partial `PropertiesPanel` | Category 1 — fewer duplicated web interfaces |
| HM E2E fixtures | `e2e/fixtures/app.ts`; backlinks, mentions, check-aria migrated | Category 5 — check-aria no longer silent-skips |
| #2 Plan shared | `shared/src/content-extract.ts`; API re-export; Editor uses shared | Category 5 — `shared-content-boundary.test.ts` |
| #7 Repo slice | `documents-repository.ts`, `getDocumentTypeById` for collab | Foundation for Cat 3/4 — claims `TBD` |
| #5 Yjs codec | `document-content-codec.ts` + unit tests | Category 5 |
| #4 Mentions/links | `shared/src/document-mentions.ts`; API JSON→links integration test | Category 5 |
| #1 Collab protocol | `shared/src/collab-protocol.ts`; canonical server rooms | Category 6 — prevents cross-prefix data fork |

Evidence: `pnpm type-check` pass; `DATABASE_URL=…/ship_test_audit pnpm --filter @ship/api test` 33 files / 485 tests pass; `pnpm --filter @ship/web test` 158 pass. E2E targeted runs were not re-benchmarked in this pass; current E2E runner requires Docker except for `--list`. D020–D024 in `DECISION_LOG.md`.

---

## Architecture Follow-up Pass Summary (2026-05-21)

Completes deferred slices F1–F7 from the deepening pass: collab E2E proof, `useCollabSession`, server codec wiring, repository expansion, OpenAPI hook pilot, E2E fixtures, and doc updates. No git commits.

| ID | Deliverable | Evidence |
|----|-------------|----------|
| F1 | Collab E2E: `document-isolation` + `content-caching` | **7/7 pass** — `E2E_RESULTS_DIR=test-results/arch-followup-collab PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/document-isolation.spec.ts e2e/content-caching.spec.ts` |
| F2 | `useCollabSession` + shared `COLLAB_*` | `web/src/hooks/useCollabSession.ts`; slimmed `Editor.tsx`; `useCollabSession.test.ts` (7 tests: mocks, clear-cache msg `3`, close `4101`, stable callbacks) |
| F3 | `getOrCreateDoc` → `resolveInitialContent` | `api/src/collaboration/index.ts`; codec string/XML parsing; collab + codec vitest **53 pass** |
| F4 | `listIssuesMetadata` + route wiring | `documents-repository.ts`; `issues.ts` list; `documents.ts` PATCH content → `updateDocumentContent` |
| F5 | OpenAPI contract | Full route registration **195/195**; `pnpm openapi:check:strict` in pre-commit; `expectOpenApiResponse` on auth/setup/workspaces/files/feedback/bootstrap; `defineRoute` pilot on setup |
| F6 | Perf benchmarks | **TBD** — `pnpm benchmark:api` defaults to `http://localhost:3000`; non-3000 dev runs need `API_BASE_URL` set. Prior artifacts in `test-results/benchmarks/api-2026-05-21T03-11-53-590Z.json` |
| F7 | E2E fixtures | `authenticatedPage`, `createIssueDoc`, `gotoIssues`, `openFirstIssueFromList`; collab specs use `login` from `app.ts` |

Category mapping (honest): F1/F2 **support** Cat 5/6 infrastructure but do **not** close GFA Cat 1/5/6 gates alone; F3/F7 → Cat 5 structural tests; F4 → Cat 4 indirect (SQL relocation, no new benchmark); F5 → typed-client pilot only (not 25% `any` reduction); F6 → Cat 3/4 **TBD** until API server + rerun.

D025–D028 in `DECISION_LOG.md`.

---

## Architecture Follow-up Verification Pass (2026-05-21)

Multi-agent audit (collab parity, SQL relocation, SOLID/F2d, philosophy + GFA alignment) followed by orchestrator fixes and full re-gates.

| Audit area | Initial verdict | Fix applied |
|------------|-----------------|-------------|
| Collab `getOrCreateDoc` empty `content: []` | Minor regression (`content.length` guard) | Use `Array.isArray(resolved.docJson.content)` |
| Collab close codes / message types | Drift risk (literals `4101` etc.) | Import all `COLLAB_*` from `@ship/shared` on server |
| `useCollabSession` callback deps | Medium — full session teardown on parent re-render | Ref-stable `onBack` / `onDocumentConverted` |
| WS `message` listener | Medium — leak on reconnect | `removeEventListener` in cleanup; attach on `connected` |
| F2d unit tests | **Not satisfied** (constants only) | 7 behavioral tests with mocked `y-websocket` / `y-indexeddb` |
| `listIssuesMetadata` / `updateDocumentContent` | **PASS** — logic-equivalent | None |
| GFA category over-claims in deepening table | Misleading Cat 1/6 tie-ins | Wording corrected above |
| F7 `content-caching` duplicate login | Partial fixture adoption | All describes use `login` from `app.ts` |

**Post-fix verification:**

| Gate | Result |
|------|--------|
| `pnpm type-check` | Pass |
| API tests (`ship_test_audit`) | **489** pass |
| Web tests | **165** pass (includes 7 `useCollabSession` tests) |
| Collab + codec vitest | **55** pass |
| Collab E2E | **7/7** — `test-results/arch-verify-collab/` |
| `pnpm benchmark:api` | **TBD** — API was not reachable at the default `http://localhost:3000` during verify |

Philosophy: no new content tables; Editor canonical; hook owns transport (soft caveat: `alert` in hook matches prior Editor pattern).

---

## Medium-Risk Dependency Cleanup Pass Summary

This pass ran in a clean worktree from `master` (`bb36575012bd4ef1375aa5427cfc100de89264fc`) on `codex/dependency-security-cleanup`. It upgraded medium/low-risk dependencies without crossing the excluded migration lines: no React 19, TipTap 3, Zod 4, Tailwind 4, TypeScript 6, Vite 8, `@vitejs/plugin-react@6`, `y-websocket@3`, Node baseline change, or Express 5 app migration.

The pass reduced `pnpm audit` from known Vite/Rollup/Testcontainers/SVGO/uuid and later transitive advisories to zero reported advisories as of 2026-05-21. The final implementation also added pnpm overrides for patched transitive versions that package parents did not otherwise resolve: `flatted@3.4.2`, `markdown-it@14.1.1`, `qs@6.15.2`, `yaml@2.9.0`, and scoped `picomatch` overrides that keep legacy chokidar consumers on `picomatch@2.3.2` while moving Vite/Vitest/tinyglobby paths to `picomatch@4.0.4`.

### Dependency Changes

- API/runtime: `dotenv` 16.4.7 -> `^17.4.2`, `express` 4.21/4.22.1 -> 4.22.2, `uuid` 11.0.3 -> 11.1.1.
- Web/runtime: `emoji-picker-react` 4.16.1 -> 4.19.1, `react-router-dom` 7.1.1/7.12.x -> 7.15.1, `tailwind-merge` 2.6.0 -> 3.6.0.
- Build/test tooling: Vite stays on 6 (`^6.4.2`), `vite-plugin-svgr` 5.2.0, `autoprefixer` 10.5.0, `jsdom` remains on 27.4.0 to preserve the declared Node floor, root `@types/node` is pinned to the Node 22 type line, `@playwright/test` 1.60.0, Testcontainers packages 12.0.0, `@types/dockerode` 4.0.1, `@types/supertest` 7.2.0.

### Verification

- `pnpm install --frozen-lockfile`: pass.
- `pnpm audit --prod --audit-level low`: 0 advisories.
- `pnpm audit --audit-level low`: 0 advisories.
- `pnpm type-check`: pass.
- `pnpm lint`: pass with existing warning volume, 0 errors / 5452 warnings.
- `pnpm build`: pass; existing Vite chunk-size warnings remain.
- Disposable DB `ship_shape_dep_cleanup_test`: migration pass, 43 migrations applied.
- `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_shape_dep_cleanup_test pnpm test`: 30 files / 477 tests passed.
- `pnpm --filter @ship/web test`: 19 files / 158 tests passed; expected hook-error assertion output still prints during the suite.
- `pnpm --filter @ship/api openapi:generate`: pass; no tracked OpenAPI diff.
- `E2E_RESULTS_DIR=test-results/dep-cleanup-smoke PLAYWRIGHT_WORKERS=2 pnpm test:e2e:smoke`: 27/27 passed.
- `E2E_RESULTS_DIR=test-results/dep-cleanup-icons PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/icons.spec.ts`: 1/1 passed.
- `E2E_RESULTS_DIR=test-results/dep-cleanup-isolation PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/spike-isolated.spec.ts`: 4/4 passed; wrapper printed a stale failure-log path despite exit 0.
- Full E2E did not pass: `E2E_RESULTS_DIR=test-results/dep-cleanup-full PLAYWRIGHT_WORKERS=2 pnpm test:e2e:run` ended 811 passed / 7 hard failed / 5 flaky / 47 did not run in the Playwright log; the progress summary counted flaky tests as passed. A clean-master baseline rerun of the same failing spec files previously produced overlapping failures, so the broad-suite failures were not unique to this dependency branch, but the old comparison worktree path is no longer present on this machine.
- Post-audit correction rerun after scoping `picomatch`, keeping `jsdom` on 27.4.0, and pinning root Node types: `pnpm type-check`, `pnpm build`, API unit tests, web unit tests, `pnpm audit --audit-level low`, `pnpm audit --prod --audit-level low`, E2E smoke, E2E icons, and isolated Testcontainers E2E all passed.

### Full E2E Failure Notes

Dependency branch full-suite failure logs included accessibility target-size/listbox checks, duplicate locator strictness in project-week tests, stale-data button timeouts, inline-comment highlight removal, session-timeout Radix id selector escaping, feedback row lookup, and week UX selection. Clean-master comparison reproduced overlapping failures in the same spec group, especially accessibility remediation, inline comments, project weeks, and session timeout; the extra hard dependency-branch failure in `program-mode-week-ux.spec.ts` remains inconclusive. Treat the targeted dependency-sensitive E2E checks as the pass signal for this dependency cleanup; do not claim the full suite is green.

## Easy Wins Pass Summary

This pass captured quick, safe improvements from the audit work: contract drift fixes, repo/build hygiene, production bundle splitting, accessibility fixes, narrow type-safety cleanup, API test safety, CSRF JSON handling, comments visibility checks, and migration-runner error handling. The intentionally deferred items are still listed near the end so this report remains the current ledger for this work batch, not a final submission checklist.

## Second Easy-Wins Pass Summary

This pass harvested the next low-risk items from the audit ledger: typed route-level PostgreSQL row boundaries, removed easy editor/ProseMirror `any` usage, converted major route pages to lazy chunks, and reconciled stale discovery/doc status. The week route typing keeps canonical week properties distinct from legacy plan/review fields already read and written by existing endpoints, so the source-of-truth model is not widened by the type cleanup. It intentionally did not take on broad auth/request typing, security authorization findings, database performance work, or flaky-test repair.

## Structural Foundation Pass Summary

This pass tackled the cart-before-horse items from the audit: shared API boundary schemas, fewer duplicated document/property aliases in high-risk routes, transaction-aware association helpers, green web unit tests, exact inline comment mark removal, honest search documentation, corrected OpenAPI search/session contracts, and throttled session activity writes. Follow-up correctness review restored `project_id` issue filtering, hardened duplicate association sync, fixed the generated YAML writer, aligned inferred accountability OpenAPI with `weekly_retro`, and made `/auth/session` report the effective sliding inactivity expiry. It did not add real server-backed document search or a bootstrap endpoint; those remain deferred product/performance decisions.

## Submission-Gated Structural Pass Summary

This pass started from the remaining cart-before-horse work: fake-green rails, boundary contract drift, app-shell fanout, and command-palette search. Raw `pnpm test:e2e` now fails with guidance and the controlled runner uses the raw Playwright script internally. Shadow DB restore paths now fail closed instead of masking restore errors. Runtime boundary schemas now feed more OpenAPI schemas, with a focused contract drift test. The app has a read-only `/api/bootstrap` endpoint that hydrates existing React Query caches without replacing page-level APIs. Server-backed document search is title-only and used by the command palette only; `/docs` search remains client-side title filtering.

This report is a work ledger, not a final source-of-truth completion claim. At this pass, Categories 3 and 4 remained intentionally incomplete until measured before/after improvements were made; later sections record the partial Category 3 benchmark evidence and Category 4 flow-level query-count proof. Category 5 now satisfies the full "3 meaningful tests or 3 flaky fixes" source requirement.

Durable choices from this pass are tracked in `my-docs/DECISION_LOG.md` so the rationale, alternatives, consequences, and evidence remain reviewable.

## Evidence-Runner And Trust Pass Summary

This pass added a repo-local evidence runner foundation, repeatable performance/query measurement scripts, a repeatable closeout axe runner, the third meaningful Category 5 regression, a stale E2E tree-selector fix, Backlinks offline/degraded behavior, and a narrow issue-boundary schema slice shared by runtime validation and OpenAPI. At this point it intentionally did not claim Category 3 or 4 completion: the new scripts created the measurement rails, but before/after endpoint/query improvements still needed to be captured under identical conditions. Category 6 is improved and manually observed, but still needs a saved screenshot/recording artifact before it should be claimed complete. Category 7 closeout now clears the repeatable axe gate for `/docs`, the selected document page, and `/my-week`.

## Category 6 Runtime Evidence Pass Summary

This pass tightened `e2e/error-handling.spec.ts` so the runtime-error scenarios can now produce named Playwright screenshots and assert more than page visibility: API interception happened, CSRF failures stayed JSON-shaped, edited text remained present after failure/offline paths, nonblank fallback UI rendered, and no uncaught browser `pageerror` occurred. After the existing Docker PostgreSQL container was started, the focused runtime run passed with 8 tests and wrote screenshots under `test-results/category-6-runtime-evidence-final2/playwright/`.

## Category 3/4 Performance Evidence Pass Summary

This pass extended `pnpm perf:query-count-api` from endpoint-only capture to flow-level evidence for old protected docs startup fanout versus current `/api/bootstrap`. The 2026-05-21 run against `ship_dev` measured old startup fanout at 7 requests, 33 SQL queries, 984,044 response bytes, and 32 ms total elapsed; current bootstrap measured 1 request, 24 SQL queries, 984,123 response bytes, and 17 ms elapsed. That is a 27.3% query-count reduction and 85.7% request-count reduction for the app-shell flow. A later Category 3 projection pass reduced issue-list/bootstrap payload bytes, but bootstrap P95 still needs more proof before Category 3 is closed.

## Full-Content Search Product Pass Summary

This pass implemented real document content search as its own product surface. `/api/search/documents` remains title-only for command-palette lookup, while new `/api/search/content` searches a derived Postgres full-text index with visibility filtering before limit, archived/deleted exclusion, rank, snippet, type filtering, selected property weighting, REST/collaboration index refresh, and OpenAPI coverage. `/docs` now calls the content-search endpoint and renders ranked snippets instead of filtering loaded document titles on the client. Search performance/evidence rails now include deterministic content-search seed terms, benchmark endpoints, query-count coverage, EXPLAIN coverage, and `pnpm --filter @ship/api search:reindex` for backfill/repair. Initial blocked checks were resolved by starting the existing Docker Postgres container. Current passing checks include API/web type-check, focused DB-backed search tests, BacklinksPanel web tests, API build, OpenAPI generation, content-search seed/query-count/EXPLAIN/benchmark evidence, Category 6 Playwright runtime evidence, and `git diff --check`.

| Area | Target | Latest Result | Evidence |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type safety | Remove real `any` usage at API/Web boundaries | Shared boundary schemas added; high-risk route aliases now derive more from `@ship/shared`; current AST scan is 102 total / 12 production `any` nodes | `pnpm type-check`, AST counter rerun |
| Boundary contracts | Keep shared/runtime/OpenAPI document concepts aligned           | Added shared/runtime/OpenAPI/DB drift coverage for document and visibility values; OpenAPI regenerated after bootstrap/search schema additions                                                                | `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/bootstrap.test.ts src/schemas/document-boundary.test.ts src/routes/search.test.ts src/routes/documents-visibility.test.ts --config /dev/null`, OpenAPI YAML/JSON parse |
| Rails safety       | Remove fake-green execution paths                               | Raw E2E entrypoint now guides to `test:e2e:run`; DB-copy restore failures are no longer masked; API benchmark runner added for repeatable endpoint evidence                                                   | `pnpm test:e2e`, `pnpm test:e2e:run -- --list`, `node --check scripts/benchmark-api.mjs` |
| Bootstrap/search   | Reduce request fanout and add real document content search | Added `/api/bootstrap`; command palette still calls title-only `/api/search/documents`; `/docs` now calls full-content `/api/search/content` backed by `document_search_index` | `DATABASE_URL=postgresql://ship:ship_dev_password@127.0.0.1:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/search.test.ts --config /dev/null`: 1 file / 26 tests passed; `test-results/perf/query-count-api-2026-05-21T15-33-21-438Z.json`; `test-results/perf/explain-performance-2026-05-21T15-33-25-144Z.json`; `test-results/benchmarks/content-search-api-2026-05-21T15-35-00.json` |
| Evidence rails | Make submission proof repeatable and honest | Added `pnpm evidence:run`, `pnpm evidence:compare`, `pnpm perf:seed-audit-load`, `pnpm perf:query-count-api`, and `pnpm perf:explain`; final-review evidence run now fails the manifest when a nested claim fails | `pnpm evidence:run -- --phase final-review --run-id codex-final-review`; `pnpm evidence:compare codex-final-check codex-final-review`; `node --check scripts/{seed-audit-load,query-count-api,explain-performance}.mjs` |
| Bundle splitting   | Reduce initial entry chunk via route-level lazy loading         | Entry chunk is around 517.8 KB after route-level lazy loading; build hash varies by rebuild; 295 JS/CSS chunks emitted in the last checked web build                                                             | `pnpm build:web`, dist asset byte count |
| Verification       | Preserve build/type correctness | Type-check, API build, and web build pass | `pnpm type-check`, `pnpm build:api`, `pnpm build:web` |
| Test state         | Restore trust in normal unit gates                              | Category 5 now has three meaningful regressions; full API and web unit suites pass; stale accessibility tree selector now passes its focused E2E rerun | `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test`, `pnpm --filter @ship/web test`, `E2E_RESULTS_DIR=test-results/a11y-tree-closeout pnpm test:e2e:run e2e/accessibility-remediation.spec.ts -g "navigating to nested document auto-expands tree ancestors"` |

---

## Context

- Improvement date/time: 2026-05-20 local
- Code state: cumulative easy-wins, structural, and submission-gated foundation passes, modified in current checkout
- Environment: local pnpm workspace
- Database: `ship_test_audit` for API unit verification; disposable `ship_test_check_20260520` was also used while validating local PostgreSQL recovery; `ship_dev`/dev server for browser checks
- Runtime used for the recorded evidence: API `http://localhost:3001`, web `http://localhost:5175`. `pnpm benchmark:api` defaults to `http://localhost:3000`; set `API_BASE_URL` for other API ports.
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
| Total `any` types                       | 278 total / 94 production                                                                                                                                                   | 102 total / 12 production  | 2026-05-21    | -176 total / -82 production; total and production subsets clear 25%      | 25% total violation reduction                  | 75% total violation reduction |
| Total type assertions (`as`)            | 713 total / 504 production                                                                                                                                                  | 552 total / 452 production | 2026-05-21    | -161 total / -52 production                                                                                | Meaningful reduction                           | 75% total violation reduction |
| Total non-null assertions (`!`)         | 348 total / 325 production                                                                                                                                                  | 286 total / 253 production | 2026-05-21    | -62 total / -72 production                                                                                | Meaningful reduction                           | 75% total violation reduction |
| Total `@ts-ignore` / `@ts-expect-error` | 1 total / 0 production                                                                                                                                                      | 1 total / 0 production     | 2026-05-21    | No change                                                                                                 | No production suppressions                     |                               |
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
- Easy-sweep pass removed local `any` usage from Yjs/TipTap conversion and feedback/content-history boundaries, replaced guarded non-null assertions with explicit guards or existing authenticated-route context, normalized a few request/header/query reads, and cleared `@typescript-eslint/no-unused-vars` across `web/src`, `api/src`, and `shared/src`.

### Evidence

- `pnpm type-check`: pass.
- Historical AST count after second pass: `any` 216 total / 32 production, `as` 638 total / 433 production, non-null 348 total / 325 production.
- ESLint JSON has since been rerun; AST counts remain the official measurement.
- Production `any` count by official AST counter: 94 -> 12.
- `pnpm type-check`: pass after structural boundary changes.
- `pnpm --filter @ship/api exec vitest run src/schemas/document-boundary.test.ts --config /dev/null`: 2 tests passed.
- Focused integration rerun with local PostgreSQL access: `pnpm --filter @ship/api exec vitest run src/schemas/document-boundary.test.ts src/routes/search.test.ts src/routes/documents-visibility.test.ts --config /dev/null`: 3 files passed, 41 tests passed.
- Post-reset focused route/contract rerun against a temporary disposable Postgres container: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/bootstrap.test.ts src/schemas/document-boundary.test.ts src/routes/search.test.ts src/routes/documents-visibility.test.ts --config /dev/null`: 4 files passed, 43 tests passed.
- Evidence-runner focused boundary rerun: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/issues.test.ts src/routes/documents-visibility.test.ts src/schemas/document-boundary.test.ts`: 3 files passed, 51 tests passed.
- `pnpm --filter @ship/api type-check`: pass.
- 2026-05-21 | official AST counter | `web/src`, `api/src`, `shared/src`, `e2e`; production excludes tests | `any` 230/32 -> 210/12, `as` 653/449 -> 649/445, non-null 356/323 -> 306/273 | pass | measured with the `AUDIT_REPORT.md` TypeScript AST counter.
- 2026-05-21 | `pnpm exec eslint web/src api/src shared/src --ext .ts,.tsx --format json` | source worklist | 5723 total / 4119 production warnings -> 5380 total / 3818 production warnings; `no-unused-vars` 92 total / 78 production -> 0 | pass with warnings only | `/private/tmp/ship-shape-eslint-final2.json`.
- 2026-05-21 | `pnpm type-check` | all workspaces | pass -> pass | pass | shared, API, and web type-checks completed.
- 2026-05-21 | `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/workspaces.test.ts src/routes/backlinks.test.ts src/routes/auth.test.ts src/__tests__/extractHypothesis.test.ts src/__tests__/auth.test.ts` | focused touched API behavior | blocked in sandbox, then 5 files / 109 tests passed with local PostgreSQL approval | pass | disposable `ship_test_audit` database.

---

## Category 2: Production Frontend Bundle Size

### Source Requirement

> "15% reduction in total production bundle size, or implement code splitting that reduces initial page load bundle by 20%. Provide before/after bundle analysis output. Removing functionality to shrink the bundle does not count."

### Measurement Method

Production Vite build output plus `web/dist/assets` JS/CSS byte count. Source-complete bundle evidence still needs a committed treemap or equivalent before/after bundle analysis artifact.

### Scorecard

| Metric                         | Baseline                                                                        | Latest                                       | Last Measured | Change                                        | Required Change                                                          | Stretch Goal |
| ------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------- | ------------- | --------------------------------------------- | ------------------------------------------------------------------------ | ------------ |
| Total production bundle size   | 2,262.65 KB JS/CSS                                                              | 2,337.76 KB JS/CSS                           | 2026-05-21    | +75.11 KB                                     | 15% reduction in total production bundle size                            |              |
| Largest chunk                  | `assets/index-C2vAyoQ1.js` (2,025.10 KB)                                        | largest built chunk about 817.62 KB          | 2026-05-21    | about -1,207.48 KB / -59.6% largest-chunk reduction | 20% reduction in initial page load bundle if using code splitting target |              |
| Initial entry chunk            | `assets/index-C2vAyoQ1.js` (2,025.10 KB)                                        | entry chunk about 517.82 KB                  | 2026-05-21    | about -1,507.28 KB / -74.4%                   | 20% reduction in initial page load bundle                                |              |
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
- Largest production entry chunk: 2,025.10 KB -> about 517.82 KB in the last checked build.
- New emoji picker async chunk: 271.11 KB.
- Route-level lazy chunks now include `UnifiedDocumentPage-CSRnSbAM.js` (133.22 KB), `ReviewsPage-FqsUksAC.js` (28.39 KB), `TeamMode-lSiJNvGc.js` (21.76 KB), and other route-specific page chunks.
- `rg "ReactQueryDevtools|Open Tanstack query devtools" web/dist/assets`: no production bundle matches.

---

## Category 3: API Response Time

### Source Requirement

> "20% reduction in P95 response time on at least 2 endpoints. You must provide before/after benchmarks run under identical conditions (same data volume, same concurrency, same hardware). Document the root cause of each bottleneck."

### Measurement Method

`pnpm benchmark:api` remains the P95 endpoint benchmark rail. The 2026-05-21 Category 3 run used the same `ship_dev` audit-load data, local dev API on `http://localhost:3001`, `BENCHMARK_DURATION_MS=15000`, `BENCHMARK_CONNECTIONS=10,25,50`, and `BENCHMARK_RATE_PER_SECOND=100` before and after the issue-list/bootstrap projection change. Because the benchmark script defaults to `http://localhost:3000`, this run required `API_BASE_URL=http://localhost:3001`.

### Scorecard

| Endpoint                       | Baseline P50                     | Baseline P95                       | Baseline P99                       | Latest P50 | Latest P95 | Latest P99 | Last Measured | Change | Required Change                           | Stretch Goal |
| ------------------------------ | -------------------------------- | ---------------------------------- | ---------------------------------- | ---------- | ---------- | ---------- | ------------- | ------ | ----------------------------------------- | ------------ |
| `GET /api/documents?type=wiki` | 10c: 8.04 ms; 25c: 8.76 ms; 50c: 10.53 ms  | 10c: 14.34 ms; 25c: 17.68 ms; 50c: 21.55 ms | 10c: 37.07 ms; 25c: 29.32 ms; 50c: 42.98 ms | 10c: 8.56 ms; 25c: 8.97 ms; 50c: 10.21 ms | 10c: 13.50 ms; 25c: 17.87 ms; 50c: 18.03 ms | 10c: 16.87 ms; 25c: 30.18 ms; 50c: 51.49 ms | 2026-05-21 | Mixed; 50c P95 -16.3% | 20% P95 reduction on at least 2 endpoints |              |
| `GET /api/issues`              | 10c: 10.77 ms; 25c: 14.94 ms; 50c: 35.41 ms | 10c: 19.01 ms; 25c: 37.35 ms; 50c: 99.13 ms | 10c: 57.45 ms; 25c: 105.93 ms; 50c: 208.30 ms | 10c: 9.21 ms; 25c: 13.05 ms; 50c: 43.88 ms | 10c: 13.31 ms; 25c: 27.37 ms; 50c: 115.71 ms | 10c: 35.17 ms; 25c: 90.82 ms; 50c: 207.11 ms | 2026-05-21 | 10c -30.0%; 25c -26.7%; 50c +16.7% | 20% P95 reduction on at least 2 endpoints |              |
| `GET /api/dashboard/my-week`   | 10c: 11.10 ms; 25c: 11.99 ms; 50c: 21.12 ms | 10c: 17.72 ms; 25c: 24.68 ms; 50c: 34.82 ms | 10c: 27.44 ms; 25c: 55.51 ms; 50c: 50.41 ms | 10c: 11.22 ms; 25c: 12.29 ms; 50c: 19.97 ms | 10c: 18.26 ms; 25c: 24.54 ms; 50c: 30.53 ms | 10c: 29.41 ms; 25c: 26.13 ms; 50c: 42.76 ms | 2026-05-21 | Mixed | Identical benchmark conditions            |              |
| `GET /api/projects`            | 10c: 8.72 ms; 25c: 8.94 ms; 50c: 10.56 ms  | 10c: 12.99 ms; 25c: 11.07 ms; 50c: 19.34 ms    | 10c: 17.12 ms; 25c: 18.43 ms; 50c: 28.13 ms | 10c: 8.81 ms; 25c: 9.89 ms; 50c: 10.24 ms | 10c: 12.55 ms; 25c: 15.48 ms; 50c: 18.64 ms | 10c: 13.74 ms; 25c: 17.44 ms; 50c: 24.16 ms | 2026-05-21 | Mixed | Identical benchmark conditions            |              |
| `GET /api/bootstrap`           | 10c: 17.27 ms; 25c: 25.10 ms; 50c: 119.84 ms | 10c: 24.74 ms; 25c: 50.24 ms; 50c: 220.81 ms | 10c: 73.82 ms; 25c: 132.58 ms; 50c: 318.57 ms | 10c: 16.84 ms; 25c: 24.78 ms; 50c: 103.32 ms | 10c: 21.38 ms; 25c: 75.11 ms; 50c: 196.84 ms | 10c: 56.75 ms; 25c: 142.01 ms; 50c: 314.64 ms | 2026-05-21 | Payload improved; P95 mixed | Identical benchmark conditions            |              |

### What Changed

- Added `scripts/benchmark-api.mjs` and `pnpm benchmark:api` to make repeated API timing evidence reproducible across fixed auth, endpoint set, concurrency matrix, duration, rate cap, and JSON output.
- Added `/api/bootstrap` to combine app-shell data already fetched by current providers. This is a fanout reduction candidate, not yet a claimed P95 win.
- Added `pnpm evidence:run` / `pnpm evidence:compare` so API benchmark output can be captured with repo metadata, environment, claims, and artifact paths.
- Split issue list/bootstrap projections from issue detail projections. `GET /api/issues` and bootstrap issue data no longer select or return TipTap `content`, and they omit null/default-heavy list fields such as absent ticket numbers, assignees, estimates, and rejection/accountability fields. Issue detail endpoints still return editor content.
- Updated the generated OpenAPI issue-list/bootstrap contract and frontend list/kanban rendering so optional list metadata is handled explicitly.

### Evidence

- `node --check scripts/benchmark-api.mjs`: pass.
- `pnpm evidence:run -- --phase closeout --run-id closeout-check`: completed and writes `my-docs/evidence-runs/closeout-check/`; the manifest is correctly failed because the nested `openapi.prettier.json` claim is failed, while incomplete proof lanes remain `not_measured`.
- Before benchmark: `test-results/benchmarks/api-2026-05-21T02-40-19-503Z.json`.
- Final after benchmark: `test-results/benchmarks/api-2026-05-21T03-11-53-590Z.json`.
- Payload spot check after projection compaction: `/api/issues` 307,043 bytes and `/api/bootstrap` 429,806 bytes against the same audit-load dev data. The valid pre-change benchmark had both `/api/issues` and `/api/bootstrap` near 984 KB, so the payload bottleneck is materially reduced.
- P95 result: `GET /api/issues` meets the 20% reduction bar at 10c and 25c, but not 50c. `GET /api/bootstrap` payload is materially smaller but P95 remains mixed and regressed at 25c in the final run. Category 3 should be treated as improved, not fully closed, until a second endpoint has stable 20% P95 proof or the benchmark target is narrowed.

---

## Category 4: Database Query Efficiency

### Source Requirement

> "20% reduction in total query count on at least one user flow, or 50% improvement on the slowest query. Provide before/after EXPLAIN ANALYZE output. Document what was inefficient and why your change fixes it."

### Measurement Method

`pnpm perf:query-count-api` captures SQL statement counts by monkey-patching `pg.Pool.prototype.query` inside an in-process Express app. As of this lane it records both individual endpoint rows and named flow rows. The docs startup flow compares the pre-bootstrap request fanout (`/api/auth/me`, wiki documents, programs, projects, issues, standup status, action items) against current `/api/bootstrap` under the same database, user, process, and hardware.

### Scorecard

| User Flow         | Baseline Total Queries | Baseline Slowest Query | Baseline N+1 Detected?                                             | Latest Total Queries | Latest Slowest Query | Latest N+1 Detected? | Last Measured | Change | Required Change                                             | Stretch Goal |
| ----------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------ | -------------------- | -------------------- | -------------------- | ------------- | ------ | ----------------------------------------------------------- | ------------ |
| Protected docs startup app-shell | 33 queries across 7 requests | N/A | No row-level N+1; fanout from repeated authenticated list/status endpoints | 24 queries across 1 request | N/A | No | 2026-05-21 | -9 queries / -27.3%; requests 7 -> 1 / -85.7%; bytes 984,044 -> 984,123 / +79 bytes | 20% fewer queries on at least one flow | |
| Load main page    | 41                     | 4.00 ms                | No row-level N+1; repeated session/auth checks across 10 API calls |                      |                      |                      |               |        | 20% fewer queries on at least one flow                      |              |
| View a document   | 5                      | 0.56 ms                | No                                                                 |                      |                      |                      |               |        | 50% improvement on slowest query if using query-time target |              |
| List issues       | 5                      | 1.00 ms                | No                                                                 |                      |                      |                      |               |        | Before/after EXPLAIN ANALYZE output                         |              |
| Load sprint board | 9                      | 0.57 ms                | No                                                                 |                      |                      |                      |               |        | Before/after EXPLAIN ANALYZE output                         |              |
| Search content    | 0                      | N/A                    | N/A; client-side filter only                                       |                      |                      |                      |               |        | Document what was inefficient                               |              |

### What Changed

- Added `/api/bootstrap` and React Query cache seeding for current app-shell providers: auth/session payload, wiki documents, programs, projects, issues, standup status, and action items.
- The command palette now queries title-only `/api/search/documents` on demand instead of fetching the full documents list for palette search.
- Added `pnpm perf:seed-audit-load`, `pnpm perf:query-count-api`, and `pnpm perf:explain` to make audit-scale data setup, query-count capture, and EXPLAIN capture repeatable. The seed rail tops up the source-required scale shape: 500+ documents, 100+ issues, 20+ users, and 10+ sprints.
- Extended `pnpm perf:query-count-api` with flow-level evidence for old docs startup fanout versus current bootstrap, including per-request status/query/byte rows and aggregate request count, elapsed time, total bytes, and total query count.
- Payload byte reduction was made later in the Category 3 lane by projecting issue lists/bootstrap issue data as metadata-only. This does not change the Category 4 query-count proof, which remains a flow-level SQL/request-count win.

### Evidence

- `GET /api/bootstrap` has focused route coverage for auth, response shape, and project status inference.
- `/api/search/documents` has focused route coverage for auth, title-only behavior, type filtering, limits, and visibility.
- Focused route/contract rerun against a temporary disposable Postgres container: 4 files passed, 43 tests passed.
- Measurement script syntax checks passed: `node --check scripts/seed-audit-load.mjs`, `node --check scripts/query-count-api.mjs`, and `node --check scripts/explain-performance.mjs`.
- Closeout rail outputs were produced: `test-results/perf/query-count-api-2026-05-20T23-37-27-346Z.json` and `test-results/perf/explain-performance-2026-05-20T23-37-37-930Z.json`.
- Flow-level query-count output: `test-results/perf/query-count-api-2026-05-21T02-15-44-061Z.json`.
- Old docs startup fanout flow in that artifact: 7 requests, 33 total SQL queries, 984,044 response bytes, 32 ms total elapsed.
- Current bootstrap flow in that artifact: 1 request, 24 total SQL queries, 984,123 response bytes, 17 ms total elapsed.
- Query-count result: -9 queries / -27.3% on the protected docs startup app-shell flow, satisfying the query-count branch of Category 4 for one flow. Slow-query improvement is not claimed.
- EXPLAIN output: `test-results/perf/explain-performance-2026-05-21T02-16-39-379Z.json`; current execution times were `documents_list_wiki` 0.313 ms, `issues_list` 0.978 ms, `projects_list_counts` 0.774 ms, `audit_logs_tagged_recent` 2.750 ms, and `document_association_issue_project` 0.643 ms.

---

## Category 5: Test Coverage and Quality

### Source Requirement

> "Add meaningful tests for 3 previously untested critical paths, or fix 3 flaky tests with documented root cause analysis. 'Meaningful' means the test catches a real regression, not just asserting that a page loads. Each test must include a comment explaining what risk it mitigates."

### Measurement Method

### Scorecard

| Metric         | Baseline                                                                                    | Latest                                                       | Last Measured | Change                                                                                                                           | Required Change                                 | Stretch Goal |
| -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------ |
| Unit tests     | API baseline: 451 pass / 0 fail; Web baseline: 138 pass / 13 fail                           | API: 501 pass; Web: 165 pass | 2026-05-21    | Category 5 now has three meaningful regressions: overlapping comment marks, project issue filtering, and private document comment visibility | Add 3 meaningful tests or fix 3 flaky tests     |              |
| API unit tests | 451 pass / flaky status not fully assessed                                                  | 501 pass; flakiness not fully assessed | 2026-05-21    | Added private document comment visibility regression and risk comment for project issue-filter coverage | Existing tests still pass                       |              |
| Web unit tests | 138 pass / 13 fail / flaky status not fully assessed                                        | 165 pass; flakiness not fully assessed | 2026-05-21    | Added `BacklinksPanel.test.tsx`; existing `CommentMark.test.ts` remains the inline-comment regression | Existing tests still pass                       |              |
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
- Full API suite rerun: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test`: latest verified count 35 files passed, 501 tests passed.
- Full web suite rerun: `pnpm --filter @ship/web test`: latest verified count 20 files passed, 165 tests passed. Existing React `act(...)` warnings remain in `useSessionTimeout.test.ts`.
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
- `e2e/error-handling.spec.ts` now captures named Category 6 runtime screenshots for API 500 fallback UI, offline editor draft preservation, CSRF JSON/editor usability, and concurrent API failure fallback UI. These tests also assert the intercepted failure path occurred, the editor remained usable where relevant, and no uncaught browser `pageerror` was emitted.

### Evidence

- API unit suite: 28 files passed, 452 tests passed in the current post-correctness run.
- Missing-CSRF probe against local API returned `403`, `content-type: application/json; charset=utf-8`, body `{"error":"Invalid or missing CSRF token"}`.
- `pnpm --filter @ship/web exec vitest run src/components/editor/BacklinksPanel.test.tsx src/components/editor/CommentMark.test.ts`: 2 files passed, 4 tests passed.
- Focused E2E runtime run: `E2E_RESULTS_DIR=test-results/category-6-runtime-evidence-final2 PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/error-handling.spec.ts`: 8 passed / 0 failed.
- Category 6 screenshot artifacts were captured under `test-results/category-6-runtime-evidence-final2/playwright/`, including `category-6-runtime-evidence-api-500-documents-list-viewport.png`, `category-6-runtime-evidence-offline-editor-preserves-draft-viewport.png`, `category-6-runtime-evidence-csrf-json-editor-usable-viewport.png`, and `category-6-runtime-evidence-concurrent-api-errors-nonblank-viewport.png` plus matching full-page screenshots.

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
| Total Critical/Serious violations                              | Axe: 2 critical nodes and 40 serious nodes across scanned pages; Lighthouse: 6 page-failures across 4 unique issue types | `pnpm a11y:closeout -- --fail-on-serious`: `/docs` 0, selected `/documents/:id` 0, `/my-week` 0 | 2026-05-21    | Fixed on scanned pages | Fix all Critical/Serious violations on explicitly chosen top 3 pages if using violation target |              |
| Keyboard navigation completeness                               | Partial pass                                                                                                             |                                                                                                               |               |                         | Existing keyboard behavior preserved or improved                                               |              |
| Screen reader usability                                        | VoiceOver partial pass                                                                                                   |                                                                                                               |               |                         | Existing screen reader behavior preserved or improved                                          |              |
| Color contrast failures                                        | Axe: `/my-week` 21 serious nodes, `/projects` 16 serious nodes                                                           | `pnpm a11y:closeout -- --fail-on-serious`: 0 contrast violations on `/docs`, selected `/documents/:id`, and `/my-week` | 2026-05-21    | Fixed on scanned pages | Critical/Serious violations fixed on selected pages                                            |              |
| Missing ARIA labels or roles                                   | 2 pages with ARIA required-child failures: `/docs`, `/documents/:id`; `/login` lacks a main landmark                     | 0 on closeout axe scan of `/docs` and `/documents/:id`                                                        | 2026-05-20    | Fixed targeted pages    | Critical/Serious violations fixed on selected pages                                            |              |

### What Changed

- Added a `main` landmark to `/login`.
- Fixed contrast on `/my-week`, `/projects`, and shared filter-tab count badges.
- Fixed the remaining Category 7 contrast at source: BacklinksPanel document-type badges use an explicit accessible foreground, My Week current-day labels use an accessible blue, and future My Week rows no longer inherit dimming through parent opacity.
- Fixed document tree semantics so `tree` containers expose direct `treeitem` children through presentational list wrappers.
- Fixed the stale E2E selector for nested document auto-expand to use the sidebar ARIA tree and nested `role="group"` structure instead of assuming the group is inside the `treeitem` element.

### Evidence

- Repeatable closeout axe output: `pnpm a11y:closeout -- --fail-on-serious` writes `test-results/a11y-closeout/axe-summary.json` and screenshots for `/docs`, a real `/documents/:id`, and `/my-week`. Current output: `/docs` 0 violations, selected document page 0 violations, `/my-week` 0 violations.
- Focused E2E verification for the updated selector passed: `E2E_RESULTS_DIR=test-results/a11y-tree-closeout pnpm test:e2e:run e2e/accessibility-remediation.spec.ts -g "navigating to nested document auto-expands tree ancestors"`: 1 passed / 0 failed.
- Lighthouse was not rerun because `lighthouse` is not installed in the repo-local toolchain (`pnpm exec lighthouse --version` returns command not found).
- Manual closeout found Backlinks behavior working as intended after creating a real mention: the target document showed the source document as a backlink, offline mode retained that saved backlink with an explicit stale status, reconnect cleared the stale state, and clicking the backlink navigated back to the source.
- Manual closeout also found non-blocking but real keyboard/a11y debt: Action Items modal focus is trapped and Escape works, but the close button is skipped or invisible in tab flow and row focus stops are visually unclear; the docs tree has visible focus and Enter expand/collapse, but arrow-key tree navigation is not implemented.
- Manual closeout surfaced a Radix warning from `SessionTimeoutModal`, not Action Items. The fix lets Radix own the dialog title/description ids and adds a focused regression test that fails if `DialogContent` title/description warnings return.

---

## Additional Contract And Hygiene Wins

- 2026-05-21 Category 1 OpenAPI-typed client pass adopted the 10x API typing path: OpenAPI now generates `web/src/api/generated/ship-openapi.d.ts`, and `web/src/api/client.ts` wraps `openapi-fetch` with existing session-cookie, CSRF, JSON, and session-expiration behavior.
- Added `pnpm openapi:generate` and `pnpm openapi:check`; the latter enforces the no-double-`/api` path convention and reports runtime/OpenAPI coverage gaps.
- Migrated low-risk covered frontend calls in comments and standup status hooks to generated OpenAPI path/body/response types.
- Added typed PostgreSQL test result helpers `pgResult()` and `pgCommand()` in `api/src/test/pg-result.ts`; `pgCommand()` covers no-row command results used by update/delete and `204` response tests without `as any` mocks.
- Cleared `@typescript-eslint/no-unused-vars` warnings from `e2e/**/*.ts`.
- Added local PostgreSQL row types in `api/src/routes/programs.ts` for program owner/existence/list/detail/merge rows without changing response shapes.
- Added test-time OpenAPI response validation via `expectOpenApiResponse`; production response validation remains deferred until route/spec coverage is honest enough.
- 10x follow-ups now have a concrete order: strict route/spec coverage, broader test-time response validation, optional staging-only production validation, then broader frontend generated-client migration. Broad migration before that would convert local casts into generated false confidence.
- Fixed Comments OpenAPI paths so generated contracts no longer double-prefix `/api`.
- Kept `/search/documents` as the mounted title-only command-palette route and kept full-content search on `/search/content`; corrected the earlier cleanup note that implied `/search/documents` was removed.
- Fixed `/search/learnings` OpenAPI response shape to `{ learnings, total }`.
- Fixed `/auth/session` OpenAPI response shape to the timeout-tracking payload actually returned by the route.
- Updated canonical docs to state that `/docs` search uses server-backed `/api/search/content`, while `/api/search/documents` remains title-only for command-palette lookup.
- Regenerated `api/openapi.yaml` and `api/openapi.json`.
- Removed tracked generated/deployment debris: old deploy zips, Terraform plan binary, dev service worker output, and disposable progress/deployment notes.
- Added ignore rules for `deploy-api-*.zip` and `terraform/**/tfplan`.
- API build now cleans `api/dist` first and excludes source tests from production build output.
- Clarified `scripts/check-api-coverage.sh` as a staged heuristic, not real coverage.
- Added evidence-runner package scripts and repeatable performance/query measurement scripts.
- Added `.gitignore` exceptions so `scripts/evidence/**` is tracked despite the broad local `evidence/` screenshot ignore rule.

### Evidence

- 2026-05-21 | `pnpm openapi:generate` | root OpenAPI pipeline | no generated web type artifact -> `web/src/api/generated/ship-openapi.d.ts` generated | pass with sandbox escalation for `tsx` IPC | `api/openapi.json`, `api/openapi.yaml`, `web/src/api/generated/ship-openapi.d.ts`.
- 2026-05-21 | `pnpm openapi:check` | runtime route/OpenAPI contract | initial report-only check after duplicate-mount cleanup: 195 runtime routes, 121 OpenAPI operations, 82 missing, 8 stale after files and auth route-family coverage; later rows record full parity | pass/report-only at that point | `scripts/check-openapi-routes.mjs`.
- 2026-05-21 | `pnpm type-check` | shared/api/web | previous pass -> pass | pass | terminal output.
- 2026-05-21 | `env DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/services/accountability.test.ts src/__tests__/auth.test.ts src/__tests__/activity.test.ts src/routes/projects.test.ts src/routes/iterations.test.ts` | touched API test helper batch | default sandbox/db guard failure -> 5 files / 62 tests passed with local DB escalation | pass | terminal output.
- 2026-05-21 | `pnpm exec eslint web/src api/src shared/src --ext .ts,.tsx --format json` | source worklist | 5380 total / 3818 production after prior sweep -> 4982 total / 3629 production; `no-unused-vars` remains 0 | pass with warnings | `/private/tmp/ship-shape-eslint-current-after-audit.json`.
- 2026-05-21 | AST counter | repo | any 210 total / 12 production; as 649 / 445; non-null 306 / 273 after prior sweep -> any 102 / 12; as 552 / 454; non-null 286 / 254 | measured | terminal output.
- 2026-05-21 | `pnpm exec eslint e2e --ext .ts --format json` | e2e | 43 unused-vars warnings in previous discovery -> 0 unused-vars; 23 total warnings remain | pass with warnings | worker report.
- 2026-05-21 | touched-file eslint | typed client, programs route, API test helper batch | explicit `any` pg mocks present in targeted tests -> 0 explicit-any in touched test files; touched-file lint 0 errors / 80 warnings | pass with warnings | terminal output.
- 2026-05-21 | correctness review | typed-client and E2E cleanup | missing typed-client CSRF retry compatibility and weakened E2E assertions -> CSRF retry accepts the current server `{ error: string }` shape, typed CSRF cache clears with legacy logout, and assertion coverage was restored in the touched E2E specs | fixed | `web/src/api/client.ts`, `web/src/lib/api.ts`, `e2e/accessibility-remediation.spec.ts`, `e2e/toc.spec.ts`, `e2e/team-mode.spec.ts`, `e2e/syntax-highlighting.spec.ts`, `e2e/program-mode-week-ux.spec.ts`.
- 2026-05-21 | `pnpm openapi:generate` | comments update schema | `UpdateComment.resolved_at?: string | unknown | unknown` -> `UpdateComment.resolved_at?: string | null` | pass with sandbox escalation for `tsx` IPC | `api/src/openapi/schemas/comments.ts`, `web/src/api/generated/ship-openapi.d.ts`.
- 2026-05-21 | `env DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/__tests__/auth.test.ts src/routes/projects.test.ts src/routes/iterations.test.ts src/services/accountability.test.ts src/__tests__/activity.test.ts` | touched API test helper batch | ambient `ship_dev` guard / sandbox local-DB block -> 5 files / 62 tests passed with disposable DB and escalation | pass | terminal output.
- 2026-05-21 | `pnpm openapi:check` | current report-only rerun | OpenAPI coverage complete after contract completion pass | pass/report-only | 195 runtime routes, 195 OpenAPI operations, 0 missing, 0 stale.
- 2026-05-21 | `env DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run src/routes/openapi-contract.test.ts src/routes/files.test.ts src/__tests__/auth.test.ts src/routes/projects.test.ts src/routes/iterations.test.ts src/services/accountability.test.ts src/__tests__/activity.test.ts` | OpenAPI response contract smoke plus touched API tests | no test-time response validation helper -> 7 files / 71 tests passed with disposable DB and escalation | pass | terminal output.
- 2026-05-21 | `pnpm exec eslint api/src/test/openapi-response.ts api/src/routes/openapi-contract.test.ts api/src/openapi/schemas/files.ts web/src/api/client.ts web/src/hooks/useCommentsQuery.ts --ext .ts,.tsx` | new typed-client and OpenAPI contract helpers | new helper warnings -> 0 errors / 0 warnings | pass | terminal output.
- 2026-05-21 | `pnpm openapi:generate` | files route-family coverage | file local-upload/confirm/serve missing and stale attach path present -> generated OpenAPI and frontend types include files runtime routes and remove file attach stale operation | pass with sandbox escalation for `tsx` IPC | `api/src/openapi/schemas/files.ts`, `api/openapi.json`, `api/openapi.yaml`, `web/src/api/generated/ship-openapi.d.ts`.
- Typed no-row helper evidence: `api/src/test/pg-result.ts` defines `pgCommand(rowCount, command = 'UPDATE')`, and `api/src/routes/projects.test.ts` uses it for update/delete mocks including the delete path that expects `204`.
- OpenAPI path inspection: comments paths now appear as `/documents/{id}/comments` and `/comments/{id}`; no `/api/documents/{id}/comments` or `/api/comments/{id}` double-prefix matches remain.
- Full-content search follow-up added distinct `/api/search/content`; `/api/search/documents` remains the title-only command-palette endpoint.
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

- Real document full-text search: implemented as `/api/search/content` with a derived Postgres index and DB-backed evidence. Focused search tests passed 26/26, query-count evidence shows three SQL queries per content-search request, EXPLAIN evidence shows `document_search_index_vector_idx` usage, and the bounded content-search benchmark wrote `test-results/benchmarks/content-search-api-2026-05-21T15-35-00.json`.
- Bootstrap endpoint for app-shell hydration: implemented, with flow-level query-count proof captured for the protected docs startup app-shell flow. It does not close Category 3 endpoint P95.
- API latency/query optimization: skipped; needs benchmark/EXPLAIN-driven work, not quick fixes.
- Setup initialize race lock/transaction: deferred; security-sensitive.
- Super-admin API token policy and API-token docs/UI: deferred pending policy decision.
- Association/context visibility leaks: addressed in the fail-closed authorization hardening pass below; rerun DB-backed regression coverage against a disposable database before calling it fully closed.
- Full route row-mapper typing: partially started for high-risk routes; broader dashboard/comments/auth route typing deferred.
- Process-level unhandled rejection handlers: still skipped; easy to add badly without coordinated HTTP/WebSocket/DB shutdown semantics.
- Category 6 screenshot/recording evidence: completed for the focused runtime file; broader full-suite E2E remains outside this pass.
- Category 7 Lighthouse rerun: still deferred because `lighthouse` is not installed in the repo-local toolchain. The axe closeout branch currently passes with 0 violations on `/docs`, the selected document page, and `/my-week`; manual keyboard/a11y polish gaps remain outside that axe gate.

## Fail-Closed Authorization Hardening Pass

### What Changed

- Added centralized document authorization helpers in `api/src/services/document-access.ts`.
- API bearer tokens now fail closed unless the token is unrevoked, unexpired, the user exists, and the user is either super-admin or still has workspace membership.
- Public feedback now requires an enabled workspace-visible program: `properties.public_feedback_enabled = true`, `visibility = 'workspace'`, not archived, not deleted.
- Document create/update validates `parent_id`, `program_id`, `sprint_id`, and `belongs_to` references before mutations.
- Association list/create/delete/reverse/context routes now require actor-readable source and related documents.
- Weekly plan/retro list/detail/history/create and project allocation grid now apply visibility and self-or-admin person scope.
- Activity routes now require readable root entities and count only actor-visible, non-archived, non-deleted documents.
- Added migrations `039_fail_closed_document_access_guards.sql` and `040_relationship_mutation_guards.sql` plus schema parity for narrow DB guardrails.
- Parallel adversarial review found and fixed second-order leaks in protected feedback detail, `GET /documents/:id` relationship enrichment, weekly plan/retro person/project joins, route ordering for project allocation grid, and relationship drift after document type/workspace/soft-delete mutations.

### Evidence

- 2026-05-21 | `pnpm type-check` | shared/api/web | pass after route/service/migration implementation | pass | terminal output.
- 2026-05-21 | `pnpm --filter @ship/api test -- src/middleware/auth.test.ts src/routes/api-tokens.test.ts src/routes/documents-visibility.test.ts src/routes/associations-regression.test.ts src/routes/feedback-authorization.test.ts src/__tests__/activity.test.ts` | focused authz tests | blocked by database safety guard because `DATABASE_URL` pointed at non-disposable `ship_dev` | blocked, not a code failure | setup refused destructive truncation.
- 2026-05-21 | `env DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test -- src/__tests__/auth.test.ts src/routes/api-tokens.test.ts src/routes/documents-visibility.test.ts src/routes/associations-regression.test.ts src/__tests__/activity.test.ts` | focused authz-adjacent API batch after adversarial fixes | sandbox local-DB block on first try -> rerun with local DB access | pass | 34 files / 498 tests passed.
- 2026-05-21 | `pnpm --filter @ship/api db:migrate` | migrations 039 and 040 | sandbox `tsx` IPC block on first try -> rerun with local DB access | pass | migrations applied to local dev DB.
- 2026-05-21 | `pnpm openapi:generate` and `pnpm openapi:check` | generated API contract | `tsx` IPC block on first generate try -> rerun succeeded; later contract completion brought coverage to parity | pass/report-only | 195 runtime routes, 195 OpenAPI operations, 0 missing, 0 stale.
- 2026-05-21 | `pnpm openapi:check:strict` + contract completion pass | OpenAPI route/spec parity | removed 8 stale ops; added admin/setup/feedback/invites/caia-auth and partial-family paths; strict gate 0 missing / 0 stale | pass | `docs/openapi-contract.md`; `defineRoute` pilot on setup; contract tests on `ship_test_audit`.
- 2026-05-21 | Multi-agent fidelity audit + schema fixes | handler/OpenAPI body alignment | P0 envelope/status/field mismatches on CAIA, workspaces, feedback, setup, invites, documents, admin | pass | `ApiErrorResponseSchema` in common; `defineRoute` validation uses standard error envelope; 501 API tests pass after fixes.

### Claim Boundary

This hardening is security and correctness work. It does not complete a Week 4 GFA category by itself, and it does not change the Category 3 status. Do not claim all seven categories complete unless the missing second endpoint P95 proof exists.
