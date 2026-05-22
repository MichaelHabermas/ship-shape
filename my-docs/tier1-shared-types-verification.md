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
| Web hook DTOs → generated OpenAPI types | Tier 2 |
| `ISSUE_PRIORITY_OPTIONS` centralization | Tier 2 |
| `InferredProjectStatus` in boundary tests | Recommended follow-up |

## Galaxy-brained / 10x paths (discuss before building)

1. **OpenAPI-as-wire-source (10x):** Delete hand-rolled `Issue`/`Project`/`Sprint` in hooks; alias `components['schemas']` — one contract, compile-time drift detection on every `openapi:generate`.
2. **Schema-driven shared enums (100x idea):** Generate `shared/src/types/document.ts` union members from `document-boundary.ts` Zod const arrays — eliminates regex parse tests and human copy-paste forever.
3. **Exhaustiveness CI guard:** Test that `ISSUE_STATE_OPTIONS` length === `IssueState` cardinality and every option value ∈ union (cheap, high leverage).

## Related docs

- D051 in `my-docs/DECISION_LOG.md`
- `my-docs/MEMORY.md` (Tier 1 import rule)
- `my-docs/IMPROVEMENT_REPORT.md` (verification table)
