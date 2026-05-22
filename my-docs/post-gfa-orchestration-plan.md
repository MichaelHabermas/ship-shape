# Post-GFA Improvement Orchestration (Wave 3)

**Orchestrator:** parent agent  
**Authority:** `my-docs/SOURCE-OF-TRUTH/GFA-Week-4-ShipShape.txt` + project invariants  
**Scope:** Non–Cat-8 backlog (Cat 8 remains separate)  
**Status:** Completed 2026-05-22 (no git commits in this pass)

## Baseline (Phase 0)

| Metric | Before (2026-05-22 start) |
|--------|---------------------------|
| ESLint `no-unsafe-*` (web/api/shared prod) | 985 production / 1932 total |
| `defineRoute` route modules | 3 / ~37 (~8%) |
| `apiClient.*` call sites | 6 |
| OpenAPI strict | 193/193 |

## Phase completion

| Phase | Status | Key deliverables |
|-------|--------|------------------|
| 0 Baseline | Done | Metrics captured; discovery status hygiene |
| 1 Foundation | Done | `session-auth.ts`, `governance-auth.ts`, visibility DRY (bootstrap-queries, bootstrap wiki, search) |
| 2 Security | Done | WS membership, Claude visibility, team/week governance, files delete auth, convert collab hook, belongs_to validation, admin delete txn, API token super-admin block |
| 3 Contracts | Done | defineRoute param test, `GET /feedback/:id`, `POST /standups`; authz E2E attempted (see evidence) |
| 4 Maintainability | Done | `useAiQuality` dedupe, `listIssueChildren`, bootstrap→`listIssuesMetadata`, conversion redirect visibility |
| 5 Product/docs | Done | `/converted/list` in-place model, accountability docs, RACI comments |
| 6 Ops/E2E | Done | deploy.sh `--bootstrap-infra`, terraform README, SECURITY.md, inline-comment cancel fix |
| 7 Closeout | Done | This file + DECISION_LOG D049–D050 + IMPROVEMENT_REPORT + discovery log updates |

## Deferred (explicit)

- **defineRoute pilot** on `documents.ts` / `issues.ts` / `auth.ts` (Phase 4d) — contract tests first; large diff deferred
- **Full E2E green baseline** — authz lane failed in `test-results/post-gfa-authz/` (environment/setup); inline-comment unit fix landed
- **Cat 8** — out of scope per user choice; Phase 2 fixes are probe-ready regressions

## Verification gates (final)

- `pnpm type-check`: pass
- API vitest (`ship_test_audit`): **535/535**
- Web vitest: **174/174**
- `pnpm openapi:check:strict`: not re-run this pass (no OpenAPI schema removals)
