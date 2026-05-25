# Submission Checklist

This is the reviewer-facing index for the Week 4 ShipShape submission. The claim source of truth is `my-docs/evidence/submission-ledger.json`; generated views are the reviewer packet at `my-docs/project-weeks-sot/week-4/reviewer-dashboard.html` and the Current Ledger Truth block in `my-docs/project-weeks-sot/week-4/IMPROVEMENT_REPORT.md`.

Start here:

1. Open `my-docs/project-weeks-sot/week-4/reviewer-dashboard.html` for the reviewer packet (**Security** tab for Cat 8), or `my-docs/project-weeks-sot/week-4/reviewer-evidence-bundle/index.html` for the static reviewer bundle. Reproduce probe: `pnpm security:probe:ci`.
2. Use this checklist for deliverable status and exact artifact paths.
3. Use `my-docs/evidence/submission-ledger.json` for canonical category status and caveats.

## Final Status

| Deliverable | File / URL | Status | Evidence source |
| --- | --- | --- | --- |
| Improvement Report | `my-docs/project-weeks-sot/week-4/IMPROVEMENT_REPORT.md` | Ready | Ledger generated block shows Categories 1-8 `proven`; narrative sections link proof and claim boundaries. |
| Discovery Write-Up | `my-docs/project-weeks-sot/week-4/discovery-research-log.md` | Ready | Contains more than three discoveries with file paths, dispositions, and future-application notes; stale architecture candidates are retired by the evidence-freeze entry. |
| AI Cost Analysis | `my-docs/AI_COST_ANALYSIS.md` | Ready | Includes tools used, local Codex usage, spend basis, strengths, risks, and codebase-comprehension reflection. |
| README / Setup Guide | `README.md` | Ready | Documents local setup, `pnpm dev`, test lanes, deployment paths, and submission evidence entrypoints. |
| Deployed Application | `https://ship-shape-web.onrender.com/` | Basic public smoke complete | `my-docs/evidence/deploy-smoke-2026-05-24.md`; unauthenticated route reached `/login`. |
| Reviewer Evidence Bundle | `https://ship-shape-reviewer-evidence.onrender.com/` | Render static site | Generated on deploy by `pnpm submission:render-bundle`; local path `my-docs/project-weeks-sot/week-4/reviewer-evidence-bundle/index.html`; service `ship-shape-reviewer-evidence`, no SPA rewrite. |
| Final Verification | See commands below | Mostly complete; one local-service blocker | Submission/doc gates, type-check, OpenAPI, web tests, and E2E smoke passed on 2026-05-24. Standalone API Vitest was blocked because no local PostgreSQL was listening on `localhost:5432`. |

## Category Proof Map

| Category | Source target | Before artifact | After artifact / proof | Validation command | Caveat / non-claim |
| --- | --- | --- | --- | --- | --- |
| 1. Type Safety | 25% reduction in type-safety violations with meaningful types | `my-docs/project-weeks-sot/week-4/AUDIT_REPORT.md` (per-package tables); `my-docs/evidence/cat1-baseline-ast-counts-5731a92.json`; `cat1-baseline-ast-counts` in ledger | `cat1-latest-ast-counts`; `cat1-latest-implicit-any-report`; `pnpm type-check` | `pnpm type-safety:counts:audit-baseline`; `pnpm type-safety:report`; `pnpm type-check` | Audit is a 2026-05-19 snapshot; syntax-count reduction supports the claim; semantic safety is bounded to documented boundary narrowing. |
| 2. Bundle Size | 15% total reduction or 20% initial-load reduction via code splitting | `my-docs/audit-evidence/category-2-bundle/bundle-stats.json` | `my-docs/evidence-runs/cat2-easy-wins-20260523/collectors/bundle-stats.json` | `pnpm build:web`; `pnpm evidence:run -- --phase <phase> --run-id <id>` | Proven path is initial entry/code-splitting improvement, not total JS/CSS shrink. |
| 3. API Response Time | 20% P95 reduction on at least two endpoints under identical conditions | `my-docs/evidence/artifacts/cat3-before-7d31add-bypass.json` | `my-docs/evidence/artifacts/cat3-after-current-bypass-repeat.json` | `pnpm benchmark:api` with documented `API_BASE_URL`, connections, duration, and bypass token | Exclude non-2xx/rate-limited benchmark artifacts. |
| 4. Database Query Efficiency | 20% fewer queries on one flow or 50% slowest-query improvement | Audit baseline in ledger; protected docs startup before query-count artifact | `test-results/perf/query-count-api-2026-05-22T15-07-32-461Z.json`; `test-results/perf/explain-performance-2026-05-22T20-11-19-137Z.json` | `pnpm perf:query-count-api`; `pnpm perf:explain` | Proven claim is app-shell query consolidation, not a blanket N+1 fix. |
| 5. Test Coverage and Quality | Three meaningful tests or three flaky-test fixes with RCA | `cat5-baseline-test-inventory` in ledger | `test-results/cat5-full-green-check`; focused regression tests in ledger | `DATABASE_URL=...ship_test_audit pnpm test`; `pnpm --filter @ship/web test`; `pnpm test:e2e:run` | Full E2E green proof retained retry artifacts as follow-up context, not zero-flake certification. |
| 6. Runtime Error and Edge Case Handling | Three error-handling fixes, including one real data-loss/confusion scenario | `cat6-audit-runtime-baseline` in ledger | `test-results/category-6-runtime-easy-wins/`; `test-results/category-6-ai-unavailable/`; `test-results/category-6-boundary-evidence/` | `E2E_RESULTS_DIR=test-results/category-6-runtime-easy-wins PLAYWRIGHT_WORKERS=1 pnpm test:e2e:run e2e/error-handling.spec.ts` | Operational shutdown hardening is documented separately from the three counted user-facing fixes. |
| 7. Accessibility Compliance | +10 Lighthouse on worst page or all Critical/Serious axe issues fixed on top pages | `cat7-baseline-lighthouse`; `cat7-baseline-axe` in ledger | `test-results/a11y-closeout/axe-summary.json`; tree keyboard E2E artifacts | `pnpm a11y:closeout:local -- --fail-on-serious` | Proven path is axe Critical/Serious closeout, not full manual screen-reader certification. |
| 8. Security Audit | Runnable probe, four attack surfaces, manual review, two verified fixes | `my-docs/evidence/security-audit/runs/probe-v2-baseline-unfixed/report.json`; named before reports | `my-docs/evidence/security-audit/latest.json`; `runs/security-probe-ci-20260523-190801/report.json` | `pnpm security:probe:ci` (includes findings check) | Proof follows the runnable probe and named findings, not generic dependency hygiene or remote production penetration testing. |

## Deployed Application

- Public URL: `https://ship-shape-web.onrender.com/`
- Smoke status: Basic public smoke completed on 2026-05-24.
- Smoke result: browser reached `https://ship-shape-web.onrender.com/login` with title `Ship - Project Management & Documentation`; sign-in form rendered.
- Smoke artifact: `my-docs/evidence/deploy-smoke-2026-05-24.md`
- Boundary: this was an unauthenticated smoke check only. The observed unauthenticated `/api/bootstrap` `401` is expected before redirect to login.

## Deployed Reviewer Evidence Bundle

- Public URL: `https://ship-shape-reviewer-evidence.onrender.com/`
- Dashboard: `https://ship-shape-reviewer-evidence.onrender.com/my-docs/project-weeks-sot/week-4/reviewer-dashboard.html`
- Render service: `ship-shape-reviewer-evidence` (static site; regenerates bundle on deploy via `pnpm submission:render-bundle`)

## Final Verification Commands

Run after the final docs/evidence state is frozen. Latest local results from 2026-05-24:

| Command | Result |
| --- | --- |
| `pnpm submission:validate` | Pass; Categories 1-8 proven. |
| `pnpm submission:render` | Pass; regenerated reviewer packet/report ledger block. |
| `pnpm submission:check` | Pass; generated submission artifacts and reviewer evidence bundle current. |
| `pnpm docs:check:strict` | Pass; no findings. |
| `pnpm type-check` | Pass. |
| `pnpm openapi:check:strict` | Pass; 193 runtime routes, 193 OpenAPI paths, 0 missing, 0 stale. |
| `pnpm --filter @ship/web test` | Pass; 24 files, 179 tests. |
| `E2E_RESULTS_DIR=test-results/final-smoke pnpm test:e2e:smoke` | Pass with full permissions; 27/27 tests. |
| `DATABASE_URL=postgresql://[redacted]:[redacted]@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run` | Blocked locally; escalated run reached host network but failed with `ECONNREFUSED` because PostgreSQL was not listening on `localhost:5432`. |
| `pnpm test:e2e:setup` | Blocked/hung locally during Playwright Chromium install; E2E smoke still passed with existing browser installation. |

If Category 8 text or findings status changes, also run:

```bash
pnpm security:probe:ci
pnpm security:findings:check
pnpm security:findings:render
```

## Claim Boundaries

- Cat 2 proves initial-entry/code-splitting improvement, not total bundle reduction.
- Cat 4 proves app-shell query consolidation, not every N+1 class.
- Cat 7 proves axe Critical/Serious closeout on the source-backed page set, not full manual assistive-tech certification.
- Cat 8 proof follows the runnable probe and named before/after findings, not generic dependency hygiene.

## Freeze Rule

Product code is frozen. Remaining work is evidence integrity unless a validation command exposes a real blocker. Do not stage, unstage, or commit unless explicitly instructed.
