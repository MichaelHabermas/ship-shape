# Memory

High-signal only. Record recurring patterns, architectural decisions, persistent gotchas, team preferences, and cross-session learnings that prevent repeated mistakes or speed up future work.

Never log: one-off debugging steps, transient session notes, low-confidence observations, or anything that belongs in git history, issues, or chat. Prune ruthlessly.

- Category 1 type-safety remediation should prioritize runtime boundary typing: API route request/query parsing, PostgreSQL row-to-domain mappers, and document `properties` narrowing. The GFA target requires 25% fewer violations, but superficial `any` -> `unknown` changes without meaningful narrowing do not count.
- ShipShape has a root `pnpm lint` script, but no ESLint config or ESLint dependencies are present in `package.json` files as of the type-safety remediation discussion. Adding lint gates would be a new tooling surface, not tightening existing lint.
- Category 2 bundle remediation should target initial-load JavaScript, especially the large `assets/index-*.js` entry chunk. Prefer lazy-loading route pages, emoji picker, editor/collaboration, and highlighting over chasing the existing many tiny chunks.
