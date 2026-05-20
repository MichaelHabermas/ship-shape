# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work. Prune ruthlessly.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat.

## Product And System Invariants

Things that should stay true across features, refactors, and fixes.

- Type-safety work should prioritize runtime boundary typing: API route request/query parsing, PostgreSQL row-to-domain mappers, and document `properties` narrowing.
- Week document properties are canonically only `sprint_number` and `owner_id`; route code may still read/write legacy plan/review fields, but type aliases should not present those fields as the source-of-truth week model.

## Counterfeit Progress

Work that looks helpful but does not actually improve the system.

- Superficial `any` -> `unknown` changes without meaningful narrowing do not count as real type-safety improvement.
- Repeated local aliases that rename product concepts are a drift source, not harmless duplication. Keep SQL projection row types local, but derive durable document property/domain types from `@ship/shared`.
- Discovery reconciliation needs explicit status hygiene: resolved audit leads can stay as baseline history, but they should be marked resolved/retired and removed from active provisional candidate lists so future passes do not rediscover already-fixed work.

## Local Reality Checks

Repo-specific facts that prevent wrong assumptions.

- Before the ESLint type-safety remediation, ShipShape's root `pnpm lint` ran `pnpm --recursive run lint`, but no workspace package had a `lint` script. It exited 0 with "None of the selected packages has a \"lint\" script", so lint was a no-op placeholder, not an existing gate.
- Week 4 runtime audit measurements require source-of-truth-scale data: 500+ documents, 100+ issues, 20+ users, and 10+ sprints. The normal `pnpm db:seed` creates 257 docs and 11 users, so audit load rows were added separately and tagged with `properties.audit_load = true`; remove those rows with the cleanup commands in `AUDIT_REPORT.md` footnote 7 after measurement.
- `ship_test_audit` is a sidecar local database for destructive API test/coverage benchmarking only. Use `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run` or the same command with `--coverage` for Category 5 reruns; use `ship_dev` for browser/runtime/performance categories.
- If local API tests cannot reach PostgreSQL on 5432, check Docker Desktop and start the existing `ship-shape-postgres-1` container before treating the API suite as blocked. For verification-only reruns, a fresh disposable database is safer than relying on stale `ship_test_audit` migration bookkeeping.
- Issues are discoverable through Programs: each program document has an Issues tab. The global `/issues` route exists too, but audits should not assume it is the only or primary path.
- Local PostgreSQL does not have `pg_stat_statements` enabled, so query-efficiency baselines use the temporary in-process query-count harness plus targeted `EXPLAIN (ANALYZE, BUFFERS)` through `/opt/homebrew/Cellar/libpq/18.3/bin/psql`.
- Document search is intentionally limited after the easy-wins cleanup: `/docs` uses client-side title filtering, `/api/search/mentions` title-searches documents for mention/embed helpers, and OpenAPI no longer advertises the unmounted `/api/search/documents` route.
- OpenAPI registration paths are mounted under `/api` by the app; schema files should register paths without an extra `/api` prefix.

## Leverage Points

Places where a small, focused change creates outsized value.

- Bundle work should target initial-load JavaScript, especially the large `assets/index-*.js` entry chunk. Prefer lazy-loading route pages, emoji picker, editor/collaboration, and highlighting over chasing the existing many tiny chunks.
- Test-quality work should optimize for trust and risk, not raw test count: green failing web tests, guard API tests against non-disposable databases, then add focused regression tests for workspace isolation and document association behavior.
- Keep the API test DB guard in place: destructive setup should only truncate disposable databases such as `ship_test_audit`, with explicit override required for anything else.
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
