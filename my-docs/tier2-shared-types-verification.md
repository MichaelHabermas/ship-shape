# Tier 2 Shared Types Verification (2026-05-22)

Orchestrated multi-agent audit of Tier 2 type consolidation (enum source in `@ship/shared`, OpenAPI wire alignment, web hook migration). Treat `my-docs/SOURCE-OF-TRUTH/GFA-Week-4-ShipShape.txt` as authoritative for submission outcomes; this pass is foundational infrastructure, not a standalone ledger category claim.

## Automated gates (post-fix)

| Gate | Result |
|------|--------|
| `pnpm build:shared` | Pass |
| `pnpm type-check` | Pass |
| `document-boundary.test.ts` | 6/6 (`DATABASE_URL=…/ship_test_audit`) |
| `pnpm openapi:check:strict` | 193/193 |
| ESLint `@typescript-eslint/no-unused-vars` | 0 (Tier 2 closeout) |

## Agent verdicts

| Agent focus | Verdict | Notes |
|-------------|---------|-------|
| Contract / OpenAPI vs runtime | **Partial fail** | Enum consolidation aligned. Date-format drift on `workspace_sprint_start_date` (ISO datetime vs OpenAPI `DateSchema` YYYY-MM-DD). Documented `status` query on `GET /programs/{id}/sprints` not implemented in handler. |
| Web hooks + consumers | **Partial fail → fixed** | Inline sprint change used single-issue PATCH with unsupported `sprint_id`; bootstrap cache typed as `Issue[]`; duplicate `PRIORITY_LABELS`; `action_items` source mislabeled. |
| SOLID / DRY architecture | **Pass with follow-ups** | Shared enum + OpenAPI alias layering sound. Remaining casts for optimistic stubs; filtered issue cache keys vs mutation `issueKeys.lists()`. |
| Build / gate runner | **Pass** | All compile-time gates green. |

## Fixes applied (verification pass)

1. **`IssuesList.handleInlineSprintChange`** — route through `useBulkUpdateIssues` with `{ sprint_id }` (bulk API accepts field; single-issue `updateIssueRequestSchema` does not).
2. **`useAuth.tsx` bootstrap seed** — `IssueListItem[]` for `issueKeys.list(undefined)` instead of `Issue[]`.
3. **`IssuesList` priority labels** — use `ISSUE_PRIORITY_LABELS` from `@ship/shared` (removed local `PRIORITY_LABELS`).
4. **`SourceBadge`** — label and style for `action_items` source (was shown as External).

## Known gaps (deferred — not Tier 2 blockers)

| Issue | Severity | Recommendation |
|-------|----------|----------------|
| `workspace_sprint_start_date` returns full ISO from PG `Date` in program sprints + sprint extract helpers | Medium | Normalize to `.split('T')[0]` in routes **or** extend OpenAPI to `DateTimeSchema`; add `expectOpenApiResponse` contract test. |
| `GET /programs/{id}/sprints?status=` documented but unimplemented | Low | Implement filter or remove from OpenAPI spec. |
| Issue mutation optimistic updates use `issueKeys.lists()` while filtered views use `issueKeys.list(filters)` | Medium | Use `setQueriesData` with partial key match or invalidate filtered keys. |
| `useAuth` seeds `Project[]` from bootstrap; wire may be `BootstrapProject` subset | Low | Add OpenAPI alias when bootstrap schema stabilizes. |
| Hand-rolled types in comboboxes (`ProjectSprint`, local `Issue` in sidebars) | Low | Incremental migration to `schemas.ts` aliases. |
| OpenAPI generator nullability on nested refs (`owner: UserReference & unknown`) | Low | Generator config or post-process; shared optimistic stub builders. |

## GFA / SOURCE-OF-TRUTH alignment

- **Cat 1 (type safety):** Tier 2 reduces drift risk; no new AST counter claim without `pnpm type-safety:counts` before/after. No submission-ledger update for this verification pass.
- **Unified document model:** Preserved — list vs detail issue shapes intentional; `BelongsTo` domain type unchanged.
- **No contradiction** with Week 4 outcomes; fixes restore correct sprint mutation behavior that Tier 2 typing had exposed.

## Galaxy-brained / 10x follow-ups (discuss before building)

1. **Runtime ↔ OpenAPI contract tests** — extend `expectOpenApiResponse` to program sprints, active weeks, project issue/week lists (catches date-format drift automatically).
2. **Finish hook migration tail** — all issue mutations via `apiClient`; drop `as unknown as Program/Project` via shared optimistic stub builders.
3. **OpenAPI generator nullability** — fix at source so nested refs allow `| null` without casts.
4. **Filtered TanStack cache coherence** — single helper for issue list cache updates keyed by filter prefix.
