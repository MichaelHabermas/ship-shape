# Tier 2 Shared Types Verification (2026-05-22)

Orchestrated multi-agent audit of Tier 2 type consolidation (enum source in `@ship/shared`, OpenAPI wire alignment, web hook migration). Treat `my-docs/SOURCE-OF-TRUTH/GFA-Week-4-ShipShape.txt` as authoritative for submission outcomes; this pass is foundational infrastructure, not a standalone ledger category claim.

## Automated gates (final)

| Gate | Result |
|------|--------|
| `pnpm build:shared` | Pass |
| `pnpm type-check` | Pass |
| `document-boundary.test.ts` | 6/6 |
| Contract tests (programs/weeks/projects lists + format-wire-date) | 60/60 |
| `issue-list-cache.test.ts` | 4/4 |
| `pnpm openapi:generate` + `check-openapi-types.mjs` | Pass (no `& unknown` drift) |
| `pnpm openapi:check:strict` | 193/193 |
| E2E `e2e/issues-inline-sprint.spec.ts` | 1/1 (bulk API + departure from locked sprint + arrival in target) |

## Second multi-agent verification (2026-05-22, D056)

Six parallel reviewers audited the hardening pass adversarially:

| Agent | Verdict | Orchestrator action |
|-------|---------|---------------------|
| API wire/contract | Pass after fixes | Local-calendar `formatWireDate`; POST /weeks date regex test |
| React Query cache | Pass (eviction already in D055) | Added bulk `onSuccess` partial-failure reconciliation |
| OpenAPI/apiClient | Pass | No runtime regressions; compile-time body typing tail noted |
| E2E/integration | Fail → fixed | E2E asserted wrong post-move DOM; now tests leave + arrive |
| GFA compliance | Aligned | No spec contradiction; ledger unchanged |
| Security regression | Pass | apiClient preserves CSRF/credentials; bulk auth unchanged |

**Open tail:** `POST /weeks` OpenAPI registers full `WeekResponseSchema` but create handler returns a subset — cannot use full `expectOpenApiResponse` until aligned.

## Tier 2 follow-up hardening (same day)

| Workstream | Delivered |
|------------|-----------|
| Wire dates | `formatWireDate` on program sprints, active weeks extract, **POST /weeks 201**; rejects garbage strings |
| Contract tests | `programs.test.ts`, `projects-contract.test.ts`, `weeks.test.ts` OpenAPI block; `expectOpenApiResponse` array-item support |
| OpenAPI hygiene | Removed unimplemented `status` query from program sprints spec |
| Issue cache | `issue-keys.ts`, `issue-list-cache.ts`; mutations patch all filtered list caches; D055 adds filter-aware eviction + unit tests |
| Nullable refs | `normalizeNullableRefs` in OpenAPI generation; `scripts/check-openapi-types.mjs` gate |
| Optimistic stubs | `web/src/api/optimistic-stubs.ts` (no `as unknown as Program/Project`) |
| apiClient migration | Issue/program/project hook reads + mutations via `apiClient`; weeks reads/mutations migrated |
| E2E | Inline week assignment on sprint Plan tab uses `POST /api/issues/bulk` |

## Initial verification fixes (D053)

1. **`IssuesList.handleInlineSprintChange`** — bulk API with `{ sprint_id }`.
2. **`useAuth.tsx` bootstrap seed** — `IssueListItem[]`.
3. **`IssuesList` priority labels** — `ISSUE_PRIORITY_LABELS` from shared.
4. **`SourceBadge`** — `action_items` label/style.

## Remaining tail (low priority)

| Item | Notes |
|------|-------|
| Component-level legacy mutations | `WeekReconciliation`, `CommandPalette`, `MergeProgramDialog`, `ProjectRetro` still use `@/lib/api` |
| `BootstrapProject` alias | Bootstrap project rows vs full `Project` OpenAPI type |
| Auto contract-test generator | 10x idea — emit vitest stubs for uncovered GET routes |

## GFA / SOURCE-OF-TRUTH alignment

- **Cat 1:** Supporting infrastructure only; no submission-ledger update without `pnpm type-safety:counts` before/after.
- **Unified document model:** Preserved.
- **No contradiction** with Week 4 outcomes.

## Galaxy-brained / 10x follow-ups (discuss before building)

1. **Auto contract-test generator** during `openapi:generate` for all GET routes.
2. **Generic `patchListQueries` helper** reusable across programs/projects if filter segments grow.
3. **OpenAPI 3.1 migration** to eliminate nullable-ref post-process.

See D052–D056 in `my-docs/DECISION_LOG.md`.
