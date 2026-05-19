# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work. Prune ruthlessly.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat.

## Product And System Invariants

Things that should stay true across features, refactors, and fixes.

- Type-safety work should prioritize runtime boundary typing: API route request/query parsing, PostgreSQL row-to-domain mappers, and document `properties` narrowing.

## Counterfeit Progress

Work that looks helpful but does not actually improve the system.

- Superficial `any` -> `unknown` changes without meaningful narrowing do not count as real type-safety improvement.

## Local Reality Checks

Repo-specific facts that prevent wrong assumptions.

- ShipShape has a root `pnpm lint` script, but no ESLint config or ESLint dependencies are present in `package.json` files as of the type-safety remediation discussion. Adding lint gates would be a new tooling surface, not tightening existing lint.
- Week 4 runtime audit measurements require source-of-truth-scale data: 500+ documents, 100+ issues, 20+ users, and 10+ sprints. The normal `pnpm db:seed` creates 257 docs and 11 users, so audit load rows were added separately and tagged with `properties.audit_load = true`; remove those rows with the cleanup commands in `AUDIT_REPORT.md` footnote 7 after measurement.
- `ship_test_audit` is a sidecar local database for destructive API test/coverage benchmarking only. Use `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api exec vitest run` or the same command with `--coverage` for Category 5 reruns; use `ship_dev` for browser/runtime/performance categories.
- Issues are discoverable through Programs: each program document has an Issues tab. The global `/issues` route exists too, but audits should not assume it is the only or primary path.
- Local PostgreSQL does not have `pg_stat_statements` enabled, so query-efficiency baselines use the temporary in-process query-count harness plus targeted `EXPLAIN (ANALYZE, BUFFERS)` through `/opt/homebrew/Cellar/libpq/18.3/bin/psql`.

## Leverage Points

Places where a small, focused change creates outsized value.

- Bundle work should target initial-load JavaScript, especially the large `assets/index-*.js` entry chunk. Prefer lazy-loading route pages, emoji picker, editor/collaboration, and highlighting over chasing the existing many tiny chunks.
- Test-quality work should optimize for trust and risk, not raw test count: green failing web tests, guard API tests against non-disposable databases, then add focused regression tests for workspace isolation and document association behavior.

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
