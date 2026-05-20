# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work. Prune ruthlessly.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat.

## Product And System Invariants

Things that should stay true across features, refactors, and fixes.

- Durable choices from audit/improvement work belong in `my-docs/DECISION_LOG.md`; keep `MEMORY.md` to short rules and traps, and use the decision log when a choice needs rationale, alternatives, consequences, and evidence.
- Type-safety work should prioritize runtime boundary typing: API route request/query parsing, PostgreSQL row-to-domain mappers, and document `properties` narrowing.
- Week document properties are canonically only `sprint_number` and `owner_id`; route code may still read/write legacy plan/review fields, but type aliases should not present those fields as the source-of-truth week model.

## Counterfeit Progress

Work that looks helpful but does not actually improve the system.

- Superficial `any` -> `unknown` changes without meaningful narrowing do not count as real type-safety improvement.
- Repeated local aliases that rename product concepts are a drift source, not harmless duplication. Keep SQL projection row types local, but derive durable document property/domain types from `@ship/shared`.
- Discovery reconciliation needs explicit status hygiene: resolved audit leads can stay as baseline history, but they should be marked resolved/retired and removed from active provisional candidate lists so future passes do not rediscover already-fixed work.

## Local Reality Checks

Repo-specific facts that prevent wrong assumptions.

- Historical lint note: before the ESLint type-safety remediation, root `pnpm lint` was a no-op placeholder. Current root `pnpm lint` runs `eslint .`, so do not reuse older audit notes as current gate evidence.
- Week 4 runtime audit measurements require source-of-truth-scale data: 500+ documents, 100+ issues, 20+ users, and 10+ sprints. In the May 2026 audit checkout, normal `pnpm db:seed` created 257 docs and 11 users, so audit load rows were added separately and tagged with `properties.audit_load = true`; remeasure seed scale before assuming those counts still hold.
- `ship_test_audit` is a sidecar local database for destructive API test/coverage benchmarking only. Use `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run` or the same command with `--coverage` for Category 5 reruns; use `ship_dev` for browser/runtime/performance categories.
- If local API tests cannot reach PostgreSQL on 5432, check whether the local Docker/Postgres service for this machine is stopped before treating the API suite as blocked. For verification-only reruns, a fresh disposable database is safer than relying on stale `ship_test_audit` migration bookkeeping.
- Issues are discoverable through Programs: each program document has an Issues tab. The global `/issues` route exists too, but audits should not assume it is the only or primary path.
- Local PostgreSQL does not have `pg_stat_statements` enabled, so query-efficiency baselines use the temporary in-process query-count harness plus targeted `EXPLAIN (ANALYZE, BUFFERS)` through `/opt/homebrew/Cellar/libpq/18.3/bin/psql`.
- Document search is intentionally limited: `/docs` uses client-side title filtering, `/api/search/mentions` title-searches documents for mention/embed helpers, and `/api/search/documents` is title-only metadata search for command-palette on-demand lookup. Do not describe it as full-text search.
- OpenAPI registration paths are mounted under `/api` by the app; schema files should register paths without an extra `/api` prefix.
- Hook tests that exercise state-changing requests through `apiPost` must mock the CSRF preflight JSON response before the actual request response.
- Regular authenticated HTTP requests persist `last_activity` at 60-second granularity to avoid page-load write amplification; `/api/auth/extend-session` still writes immediately.

## Leverage Points

Places where a small, focused change creates outsized value.

- Bundle work should target initial-load JavaScript, especially the large `assets/index-*.js` entry chunk. Prefer lazy-loading route pages, emoji picker, editor/collaboration, and highlighting over chasing the existing many tiny chunks.
- Test-quality work should optimize for trust and risk, not raw test count: green failing web tests, guard API tests against non-disposable databases, then add focused regression tests for workspace isolation and document association behavior.
- E2E optimization source of truth lives in `docs/claude-reference/testing.md`; `e2e/AGENTS.md` owns test-writing flake patterns, and the Vite memory explosion doc is incident history only. Use `pnpm test:e2e:run`, preserve `vite preview`, tune `PLAYWRIGHT_WORKERS`, set `E2E_RESULTS_DIR` for concurrent lanes/shards, and use Playwright's exit code plus `${E2E_RESULTS_DIR:-test-results}/playwright/.last-run.json` for final status because `summary.json` is progress-only.
- Raw `pnpm test:e2e` is intentionally a guarded failure that points to `pnpm test:e2e:run`; the raw Playwright script is `pnpm test:e2e:raw` and should only be called by `scripts/run-e2e.sh`.
- First full post-lane E2E baseline on 2026-05-20: `E2E_RESULTS_DIR=test-results/full-run pnpm test:e2e:run` finished in 6.6 minutes with 862 passed, 1 failed, 6 flaky. The hard accessibility tree auto-expand failure looked like a stale selector against the newer ARIA `group` tree shape, not a runner-induced app regression.
- `/api/bootstrap` is a read-only app-shell hydration endpoint that seeds existing TanStack Query keys. It must preserve the same visibility and projection semantics as the underlying list endpoints; if those routes change, bootstrap is a contract-drift candidate.
- `pnpm benchmark:api` runs the reproducible API benchmark harness and writes JSON under `test-results/benchmarks/`; do not claim Category 3 or 4 improvements until before/after output is captured under identical data, concurrency, and hardware conditions.
- `schema.sql` already includes several later-era structures, so numbered migrations that add those same structures must be idempotent. Recent examples: `010_oauth_state.sql`, `025_prevent_circular_parent.sql`, `033_sprint_to_week_rename.sql`, and `035_add_comments.sql`.
- Keep the API test DB guard in place: destructive setup should only truncate disposable databases such as `ship_test_audit`, with explicit override required for anything else.
- Inline comment cancellation must remove the exact `commentMark` instance by `commentId`; clearing UI state or removing all marks of the type can leave stale highlights or break overlapping comments.
- Improvement reports should keep second-pass result placeholders separate from verified evidence. If implementation or measurement has not run, write `TBD` rather than extrapolating from the discovery proof.

## Sharp Edges

Known traps, fragile paths, or easy ways to break things.

_None yet._

## User And Team Preferences

Stable human preferences that should shape future work.

- Update `MEMORY.md` when a durable preference, recurring project pattern, or cross-session learning is useful.

## External Constraints

Limits imposed by tools, infrastructure, policy, vendors, or environments.

_None yet._

## Retired Beliefs

Old assumptions that were proven wrong and should not come back.

_None yet._
