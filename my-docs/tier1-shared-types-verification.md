# Tier 1 Shared Types — Verification Report

**Date:** 2026-05-22  
**Scope:** `@ship/shared` consolidation (InferredProjectStatus, ISSUE_STATE_* , SelectableDocumentType, ConversionDocumentType, ApiResponse, BelongsTo)  
**Orchestrator:** parent agent + 5 parallel sub-agents  
**Git:** no commits staged/unstaged by verification pass (user instruction)

## Executive summary

**Verdict: PASS** after corrective fixes from the regression hunt. Foundational type layer is sound: build, type-check, and document-boundary contract tests all green. No GFA spec conflicts; no submission-ledger update required.

## Gates

| Gate | Result |
|------|--------|
| `pnpm build:shared` | PASS |
| `pnpm type-check` (shared, api, web) | PASS |
| `document-boundary.test.ts` (4 tests) | PASS |

## Sub-agent findings

### 1. Regression hunter — FAIL → remediated

Initial pass found incomplete shadow union cleanup. Fixed in verification pass:

- `web/src/components/CommandPalette.tsx` → `SelectableDocumentType`
- `web/src/components/dialogs/ConversionDialog.tsx` → `ConversionDocumentType`
- `web/src/components/Editor.tsx`, `UnifiedEditor.tsx`, `useCollabSession.ts` → `ConversionDocumentType`
- `web/src/pages/UnifiedDocumentPage.tsx` → `ConversionDocumentType`
- `api/src/collaboration/index.ts` → `ConversionDocumentType`
- `api/src/routes/bootstrap.ts` → `InferredProjectStatus`
- `web/src/components/IssuesList.tsx` → `ISSUE_STATE_LABELS`

Re-check: zero `ApiEnvelope`; API-domain `BelongsToEntry` only in OpenAPI/generated layers.

### 2. Contract alignment — PASS

- `BelongsTo` matches `extractBelongsToFromRow` shape.
- `ApiResponse`/`ApiError` compatible with web callers; `error.details` unused today.
- `ISSUE_STATE_OPTIONS` matches `IssueState` union (7 values).
- OpenAPI `BelongsToEntry` vs shared `BelongsTo` is intentional wire/domain split.

### 3. SOLID/DRY review — PASS (post-fix)

- Shared holds domain + cross-tier constants correctly.
- Removed confusing `ISSUE_STATE_OPTIONS` re-export from `contextMenuActions.ts`.
- UnifiedEditor imports types from `@ship/shared` directly.

### 4. GFA spec compliance — Aligned

Supports Category 1 intent (single source of truth, drift prevention). Does **not** alone satisfy GFA Rule 4 measurable AST counter claims.

### 5. Build runner — PASS

All automated gates green after fixes.

## Intentionally out of scope (Tier 2+)

| Item | Reason |
|------|--------|
| `PanelDocumentType`, `UnifiedDocumentType`, `CurrentDocumentContext` local types | Different UI subsets, not same-name shadows |
| `KanbanBoard` column config | Workflow subset + colors, not full state list |
| OpenAPI `BelongsToEntry` rename | Wire contract churn |
| Generate shared types from boundary codegen | Shared cannot import API — rejected in favor of shared-first const arrays |

## Tier 2 completion (2026-05-22)

**Verdict: PASS**

| Gate | Result |
|------|--------|
| `pnpm build:shared` | PASS |
| `pnpm type-check` | PASS |
| `document-boundary.test.ts` (6 tests) | PASS |
| `openapi:check:strict` | PASS (193/193) |
| ESLint `no-unused-vars` | PASS (0 warnings) |

Delivered:

- `shared/src/enums/document-enums.ts` — schema-driven enum source + `ISSUE_PRIORITY_OPTIONS` / `ISSUE_PRIORITY_OPTIONS_FULL`
- OpenAPI fixes: `ProgramSprintsResponse`, snake_case `ActiveWeeksResponse`, `ProjectIssueListItem`, `ProjectWeekListItem`, `inferredProjectStatusSchema` wired through projects/dashboard/programs
- Web hooks migrated: `useProgramsQuery`, `useProjectsQuery`, `useIssuesQuery`, `useWeeksQuery` → `web/src/api/schemas.ts`
- Priority UI: `IssueSidebar`, `contextMenuActions` import shared priority options
- Boundary tests: import-based enum checks, `InferredProjectStatus` contract, issue state/priority exhaustiveness

See D052 in `my-docs/DECISION_LOG.md`. Post-merge verification (multi-agent audit + four UX fixes): `my-docs/tier2-shared-types-verification.md`, D053.

## Galaxy-brained / 10x paths (discuss before building)

1. **Generate shared from boundary** — only if shared/API dependency direction changes.
2. **Full hook OpenAPI client migration** — replace remaining legacy `apiGet`/`readJson` paths with typed `apiClient`.
3. **OpenAPI nullable ref fixes** — generator sometimes drops `| null` on nested refs; consider upstream fixes or shared response wrappers.

## Related docs

- D051, D052, D053 in `my-docs/DECISION_LOG.md`
- `my-docs/tier2-shared-types-verification.md` (verification audit + deferred gaps)
- `my-docs/MEMORY.md` (Tier 1 import rule)
- `my-docs/IMPROVEMENT_REPORT.md` (verification table)
