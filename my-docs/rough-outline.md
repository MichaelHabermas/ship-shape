# ShipShape Rough Weekly Outline

## 1. Codebase Orientation

Goal: build a working mental model of `ship-shape/` before measuring or changing anything.

Deliverables:

1. Get the app running locally and document any setup gaps.
2. Read the existing project docs in `ship-shape/docs/`.
3. Map the monorepo structure:
   - `web/` React/Vite frontend: “Where does the user see/edit issues, docs, weeks?”
   - `api/` Express/PostgreSQL backend: “Where is persistence, validation, and authority enforced?”
   - `shared/` cross-package TypeScript contracts: “What must frontend and backend agree on?”
   - `e2e/` Playwright test suite: “How is full-user-flow behavior verified?”
4. Understand the core architecture:
   - unified document model: One table, many kinds of content
   - `document_type` discriminator: A label that says which kind
   - server-authoritative sync: The server decides what’s “real” when saving
   - TipTap/Yjs real-time collaboration: Live co-editing in the rich text editor
5. Trace one important request flow end to end, preferably creating or updating an issue.
6. Capture orientation notes for later use in the audit report and final submission.

   **ShipShape orientation (May 2026)**

   - **Run:** `pnpm install` → `pnpm dev` → login `dev@ship.local` / `admin123`. Native Postgres; first run creates DB via `scripts/dev.sh`. README overstates Docker/manual migrate order. API tests: `pnpm test` (~451). E2E: `pnpm test:e2e` (Docker/testcontainers, long).
   - **Shape:** `web/` (React/Vite), `api/` (Express/Postgres), `shared/` (types/constants), `e2e/` (Playwright, not a workspace package). No direct web↔api imports; both use `@ship/shared`.
   - **Architecture:** One `documents` table; `document_type` + `properties` JSONB distinguish issue/wiki/week/etc. Metadata and lists = REST + TanStack Query. Editor body = TipTap + Yjs over WebSocket; server persists merged state to `yjs_state`. Workspace-scoped auth only.
   - **Key paths:** Issues `web/.../useIssuesQuery.ts` → `POST /api/issues` → `api/src/routes/issues.ts`. Editor `web/.../Editor.tsx` ↔ `api/src/collaboration/index.ts`.
   - **Audit focus:** Type drift (`shared` vs `web/lib/api.ts` vs Zod). Bundle = `web/`. API/DB = issue list + document routes. Flakes = `e2e/`. A11y = major pages + axe in e2e.
   - **Improvement bias:** Unify types with shared/OpenAPI; document collab scaling; fix README/CI visibility.

## 2. Phase 1: Audit Report

Goal: produce baseline measurements for all seven required categories before making fixes.

This is the first hard gate. The audit should include methodology, commands/tools used, raw measurements, weaknesses found, and severity ranking.

Deliverables, in order:

1. Type Safety Audit
   - Count `any`, `as`, non-null assertions, and `@ts-ignore` / `@ts-expect-error`.
   - Check TypeScript strictness settings and strict-mode errors if applicable.
   - Identify the most violation-dense files.

2. Bundle Size Audit
   - Build the production frontend.
   - Record total bundle size, chunk count, largest chunks, and largest dependencies.
   - Identify unused dependencies and code-splitting opportunities.

3. API Response Time Audit
   - Seed realistic data.
   - Identify the five most important API endpoints.
   - Benchmark P50, P95, and P99 under concurrent load.

4. Database Query Efficiency Audit
   - Enable query logging.
   - Measure query counts for core user flows.
   - Run `EXPLAIN ANALYZE` on slow queries.
   - Identify missing indexes, full scans, and N+1 patterns.

5. Test Coverage and Quality Audit
   - Run the test suite and record pass/fail/flaky counts.
   - Catalog covered and uncovered critical flows.
   - Run the suite multiple times to detect flakes.
   - Measure coverage if tooling is available or worth adding.

6. Runtime Error and Edge Case Audit
   - Monitor browser console and server logs during normal usage.
   - Test network failure, malformed input, concurrent edits, slow network, and silent failures.
   - Identify missing error boundaries and confusing user-facing failure states.

7. Accessibility Audit
   - Run Lighthouse accessibility checks on major pages.
   - Run axe or equivalent automated scans.
   - Test keyboard navigation, screen reader basics, ARIA coverage, and color contrast.

## 3. Phase 2: Implementation

Goal: make measurable improvements in every required category, using the audit findings to prioritize.

Rules for every implementation item:

1. Record before and after measurements under identical conditions.
2. Keep existing tests passing.
3. Document root cause, fix, tradeoffs, and reproducibility.
4. Keep changes meaningful, not cosmetic.
5. Separate changes clearly in git history.

Deliverables, in order:

1. Type Safety Improvements
   - Eliminate at least 25% of type-safety violations with meaningful types and proper narrowing.

2. Bundle Size Improvements
   - Reduce total production bundle size by 15%, or reduce initial load bundle by 20% through code splitting.

3. API Performance Improvements
   - Reduce P95 response time by at least 20% on two important endpoints.

4. Database Query Improvements
   - Reduce query count by 20% on at least one core flow, or improve the slowest query by 50%.

5. Test Coverage or Reliability Improvements
   - Add meaningful tests for three uncovered critical paths, or fix three flaky tests with root cause analysis.

6. Runtime Error Handling Improvements
   - Fix three error-handling gaps.
   - At least one fix must address a real data-loss or user-confusion scenario.

7. Accessibility Improvements
   - Improve the lowest Lighthouse accessibility score by at least 10 points, or fix all Critical/Serious violations on the three most important pages.

## 4. Discovery Write-Up

Goal: document three things learned from studying the codebase.

Deliverables:

1. Name each discovery.
2. Reference where it appears in the codebase.
3. Explain what it does and why it matters.
4. Explain how the learning could apply to future projects.

## 5. Final Documentation Package

Goal: make the work reviewable, reproducible, and easy to evaluate.

Deliverables:

1. Final audit report with all seven baseline categories.
2. Improvement documentation for all seven categories.
3. Before/after benchmark evidence.
4. Setup guide updates if local setup required extra steps.
5. Discovery write-up.
6. AI cost analysis and reflection.
7. Demo video outline and final recording.
8. Public deployed version of the improved app.
9. Social post summarizing what was learned.

## 6. Suggested Working Order

1. Orientation notes.
2. Baseline audit measurements.
3. Audit report draft.
4. First-pass fixes in the lowest-risk, highest-confidence categories.
5. Performance/database fixes once benchmark harnesses are stable.
6. Runtime and accessibility fixes with screenshots or recordings.
7. Final test pass and measurement reruns.
8. Documentation polish.
9. Demo video and submission packaging.
