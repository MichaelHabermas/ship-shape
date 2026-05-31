# AGENTS.md

Repo guidance for Codex and other coding agents. Keep this file small: it is always loaded.

## Context Routing

Before reading broad docs or running broad tools, select the smallest matching profile from `docs/context-manifest.md`.

Use multiple profiles only when the task clearly crosses boundaries. If no profile matches, use `general`.

## Always-On Rules

- Preserve the unified document model unless the user explicitly asks to redesign it.
- Read the manifest profile before task-specific docs.
- Change only what the task requires; do not reformat, rename, or refactor unrelated code.
- Never use `git commit --no-verify`.
- Never hand-edit `api/src/db/schema.sql` to change existing tables. Use numbered migrations for all schema changes. `schema.sql` may be updated only as the generated/current schema snapshot, and the matching migration must exist in `api/src/db/migrations/`.
- PostgreSQL is local, not Docker.
- For E2E, run `pnpm test:e2e:setup` once (or after Playwright bumps), then use `/e2e-test-runner` or `pnpm test:e2e:run` with full permissions — agent sandboxes lack Playwright browsers and report false 100% launch failures. `scripts/run-e2e.sh` preflights browsers and aborts early when failures share an infrastructure error (e.g. missing Chromium). After the first failure, read the log; if 2–3 failures share the same message, stop and fix the root cause before running the full suite. API unit tests need `DATABASE_URL=…/ship_test_audit` (never truncate `ship_dev`).
- For `gh` (PRs, issues): default repo is **origin** (`MichaelHabermas/ship-shape`). Run `./scripts/setup-gh-default.sh` after clone; never use `US-Department-of-the-Treasury/ship` as the gh target. Treasury is remote `treasury` (fetch-only).
- UI `localStorage` prefs are best-effort; submission/security inline scripts use `scripts/submission/browser-storage-client.mjs` (`docs/conventions/browser-storage.md`).
- Document authorization is capability-based (`api/src/security/capabilities.ts`); `document-policy.ts` is seed data only. For auth work use the `security` profile, `my-docs/evidence/auth-matrix.md`, and the remediation checklist pointer in `my-docs/CODE_QUALITY_REMEDIATION_PLAN.md` (do not duplicate that plan here).
- Do not add `export type { … } from '…'` passthrough barrels; import types from where they are defined (`@ship/shared`, `@/api/schemas`, etc.). See `docs/claude-reference/anti-patterns.md` §11.

## Communication Surface

Be terse for structural metadata: titles, labels, task names, status lines, commit summaries, PR titles, filenames, and UI microcopy.

Do not make the actual conversation terse by default. In conversation, be natural, specific, and willing to think through uncertainty. Match the user's depth instead of compressing every answer.

Use metadata only when it reduces ambiguity: starting a multi-step task, switching contexts, summarizing a result, naming a saved artifact, or handing work off. Do not repeat metadata once the context is established.

## Feature branches

Durable feature branches live on **GitHub (`origin`)** and **GitLab (`gitlab`)**. Temporary agent/Codex worktrees are not branch inventory. See `docs/feature-branches.md` and run `pnpm branches:sync` to fetch remotes, create local tracking branches, and mirror `origin` → `gitlab`.

## Default Commands

```bash
pnpm dev
pnpm build
pnpm type-check
pnpm test
pnpm db:migrate
pnpm db:seed
pnpm exec shipshape-security run   # Cat 8 probe (or pnpm security:probe)
pnpm security:probe:deployed       # Safe probe vs Render (https://ship-shape-api.onrender.com)
pnpm exec shipshape-security ci    # CI gate: full probe, --fail-on=new (needs Postgres)
pnpm security:console              # Reviewer Security Console (WS logs, CI mirror, hot payload)
```

`pnpm dev` creates `api/.env.local` if needed, creates the local database if missing, runs migrations/seeds for fresh databases, finds open API/web ports, and starts both servers.

## Architecture In One Screen

- Monorepo: `api/` Express, `web/` React/Vite, `shared/` shared TypeScript.
- Documents live in one `documents` table with `document_type`.
- Document relationships live in `document_associations`.
- TipTap content uses shared JSON; Yjs binary state stores collaboration state.
- Collaboration sync is WebSocket-based at `/collaboration/{docType}:{docId}`.
- Editors use the 4-panel layout: icon rail, contextual sidebar, main editor, properties sidebar.
- New document titles are exactly `"Untitled"`.

When a task touches any of those assumptions, read the relevant profile in `docs/context-manifest.md` before editing.
