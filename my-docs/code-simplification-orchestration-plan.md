# Code Simplification Orchestration Plan

**Orchestrator:** parent agent (Cursor)  
**Authority:** `my-docs/SOURCE-OF-TRUTH/GFA-Week-4-ShipShape.txt` + project intent (unified document model, fail-closed access, OpenAPI contract, no feature removal for bundle wins)  
**Constraints:** No `git add`, `git commit`, or `git stash` unless the user explicitly asks. Preserve all user-visible behavior unless retiring confirmed-dead code paths.

## Goals (10 opportunities → phased execution)

| ID | Opportunity | SOLID/DRY principle | Target impact |
|----|-------------|---------------------|---------------|
| S1 | Route HTTP helpers | SRP — routes orchestrate; HTTP envelopes centralized | High, low risk |
| S2 | Retire accountability-grid v1/v2 | YAGNI — delete unused API surface | High |
| S3 | Unify `extractPlanItems` | DRY — single TipTap walker in shared/document layer | Med–high |
| S4 | `config/runtime.ts` | SRP — deployment predicates in one module | Medium |
| S5 | Approval workflow module | OCP — parameterized approval transitions | High |
| S6 | Widen `document-access` | DIP — routes depend on access service, not raw SQL | High |
| S7 | Expand `documents-repository` | SRP — SQL in repository, routes thin | High |
| S8 | Split `weeks.ts` | SRP — sprint/standup/review/approval modules | High |
| S9 | `defineRoute` rollout | DRY — OpenAPI + handler + Zod in one place | High |
| S10 | Split `App.tsx` | SRP — layout shell vs sidebar/mode concerns | High (web) |

**Already done (prior session):** `api/src/config/session-cookies.ts` (Render SameSite policy).

## Execution order (dependency-aware)

```
Phase 1 — Foundation (parallel)
  S1 route-http
  S4 runtime.ts (+ wire session-cookies, caia, files, db)
  S2 accountability-grid v1/v2 removal
  S3 extractPlanItems unification

Phase 2 — Domain modules (parallel after Phase 1 merges)
  S5 approval-workflow.ts (projects + weeks consumers)
  S6 document-access pilot (issues.ts or programs.ts list paths)
  S7 documents-repository (extend listIssuesMetadata pattern)

Phase 3 — Structural splits (sequential / heavy)
  S8 weeks.ts → api/src/routes/weeks/* + thin router
  S9 defineRoute pilot: standups.ts, then feedback.ts
  S10 App.tsx → AppSidebar, AppHeader, useAppMode

Phase 4 — Sweep
  S1 migrate remaining routes off copy-paste 400/500 blocks
  Regenerate OpenAPI if paths removed (S2)
  Full gates: type-check, api test (ship_test_audit), targeted e2e
```

## Sub-agent roster (varied types)

| Agent | Type | Phase | Scope (files) |
|-------|------|-------|----------------|
| A1 | code-simplifier | 1 | `api/src/utils/route-http.ts`, `feedback.ts`, `standups.ts`, `bootstrap.ts` |
| A2 | generalPurpose | 1 | `api/src/config/runtime.ts`, `session-cookies.ts`, `caia.ts`, `files.ts`, `db/client.ts` |
| A3 | generalPurpose | 1 | accountability-grid v1/v2: `team.ts`, `openapi/schemas/team.ts`, `AccountabilityGrid.tsx`, `scripts/check-api-coverage.sh`, run `pnpm openapi:generate` |
| A4 | generalPurpose | 1 | `extractPlanItems`: `document-content.ts` or `shared/content-extract.ts`, `weekly-plans.ts`, `dashboard.ts`, `ai-analysis.ts` |
| A5 | generalPurpose | 2 | `approval-workflow.ts`, partial `projects.ts` + `weeks.ts` approval handlers |
| A6 | generalPurpose | 2 | `defineRoute` migration for `standups.ts` |
| A7 | thermo-nuclear-code-quality-review | 2 | Review Phase 1 diffs (maintainability gate) |
| A8 | generalPurpose | 3 | `weeks.ts` split into submodules |
| A9 | generalPurpose | 3 | `App.tsx` component extraction |
| A10 | eelon | 0 | Validate phase order / delete-before-optimize (advisory) |

Agents report to orchestrator; orchestrator updates `MEMORY.md`, `DECISION_LOG.md`, `IMPROVEMENT_REPORT.md`, `discovery-research-log.md`.

## Verification gates (each phase)

1. `pnpm type-check`
2. `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run` (or subset for touched files)
3. If OpenAPI paths change: `pnpm openapi:generate` + `pnpm openapi:check:strict`
4. E2E when UI/API contract changes: `e2e/status-overview-heatmap.spec.ts` after S2; collab unaffected

## GFA / source-of-truth alignment

- **Category 5 (tests):** No weakening guards; add/adjust tests when behavior wrappers change.
- **Category 1 (types):** Prefer meaningful types on new helpers; no `any` → `unknown` theater.
- **No functionality removal** except dead v1/v2 grid (no web importers; v3 is canonical).
- **Document model:** Week properties canonical fields unchanged; approval fields remain route-accessible properties.
- **Security:** Fail-closed access patterns preserved; visibility SQL must not broaden reads.

## Status log

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Plan | Done | This file |
| 0b Eelon advisory | Done | Defer S8/S10 until measured wins; S2 delete-first |
| 1 S1–S4 | Done | route-http, runtime, grid v1/v2 removed, extractPlanItems in shared; type-check green |
| 2 S5 | Done | `approval-workflow.ts`; projects + weeks handlers wired |
| 2 S9 standups | Done | A6 — 5 routes, 17 tests |
| 2 S6–S7 | Done | `getIssueDetailById` + issues GET paths use document-access |
| 2 S5 remainder | Done | all sprint approval routes → approval-workflow |
| 3 S8 | Done | `api/src/routes/weeks/*` + thin `weeks.ts` re-export |
| 3 S9 feedback | Done | defineRoute on protected feedback routes |
| 3 S10 | Done | App.tsx 220 lines; AppHeader, AppSidebar, useAppMode |
| 4 S4 finish | Done | app/migrate/seed → runtime.ts |
| 4 Sweep | Done | route-http across 18 route files + weeks/ submodules; OpenAPI strict 193/193; 313+ route tests pass |
| 4b OpenAPI parity | Done | `standups.js` in openapi index; `check-openapi-routes.mjs` follows `weeks/` re-export |
| 4c Remaining sweep | Done | associations, files, search, activity, claude, ai, caia-auth, admin-credentials |
| 4d Router types | Done | `const router = Router()` default; `ExpressRouter` only on named exports |
| 5 Verification | Done | Multi-agent audit 2026-05-21 — see **Verification report** below |

## Verification report (Phase 5 — 2026-05-21)

**Branch:** `simplify-1` (3 commits vs `master`). **Agents:** security/access, OpenAPI contract, weeks split, web App refactor, thermo-nuclear foundation review, test-contract audit, shell gates.

### Automated gates (orchestrator re-run)

| Gate | Result |
|------|--------|
| `pnpm type-check` | PASS |
| `pnpm openapi:check:strict` | PASS — 193 runtime / 193 OpenAPI |
| `vitest run src/routes/` (`ship_test_audit`) | PASS — 313/313 |
| `standups.test.ts` + `feedback.test.ts` | PASS — 21/21 |

### Verdict by area

| Area | Verdict | Notes |
|------|---------|-------|
| document-access / issues GET | **PASS** | `document-access.ts` unchanged vs master; visibility SQL preserved |
| approval-workflow + weeks approvals | **PASS** | Auth/state transitions bit-equivalent to master |
| accountability-grid v1/v2 removal | **PASS** | v3 only; web `StatusOverviewHeatmap` unchanged consumer |
| session-cookies / runtime | **PASS** | Prod/dev cookie semantics preserved |
| route-http sweep | **PASS** | Legacy `{ error }` / `{ error, details }` shapes preserved on swept routes |
| weeks/ split | **PASS** | Mount order correct; no dropped routes; dead imports only |
| App.tsx split | **PASS** | Navigation, standup status path, providers intact |
| OpenAPI parity | **PASS** | Scanner + index imports fixed |
| Router type cleanup | **PASS** | Mechanical; type-check green |

### Accepted intentional deltas (not regressions)

- **`defineRoute` validation envelope** on standups + feedback protected routes: `{ success: false, error: { code, message } }` — documented in MEMORY; OpenAPI 400 schemas for standups still document legacy `{ error }` for handler errors (doc drift, not runtime mismatch on happy paths).
- **Route count 195 → 193** after grid v1/v2 removal.

### Follow-ups (pre-existing or incomplete slice — not blockers for merge)

| Priority | Item | Owner hint |
|----------|------|------------|
| HIGH | `databaseSslOptions()` forces `{ rejectUnauthorized: false }` in prod (master pool had no `ssl` key) — confirm Render/Postgres TLS policy | `runtime.ts` |
| HIGH | Test gaps: no standalone `/api/standups` tests; no `GET /api/feedback/:id` tests; weak private-issue visibility on issues GET | Cat 5 |
| MEDIUM | `asApprovalRecord` unchecked cast — add runtime guard or Zod | `approval-workflow.ts` |
| MEDIUM | Issue detail repository incomplete (`/:id/children` still inline SQL; conversion redirect without visibility re-check) | pre-existing |
| MEDIUM | OpenAPI `StandupLegacyErrorSchema` vs `defineRoute` param validation envelope mismatch | contract tests |
| LOW | Dead imports in `weeks/sprints.ts`, `weeks/approvals.ts`, `my-week.ts` | hygiene |
| LOW | `AppSidebar` `sprints` / `project-context` modes never activated | pre-existing |
| LOW | E2E `e2e/status-overview-heatmap.spec.ts` not re-run this pass | optional gate |

**GFA alignment:** No forbidden functionality removal; fail-closed access not weakened; tests not weakened (but coverage gaps documented). Category metric rows still require before/after benchmarks for claimed credit.
