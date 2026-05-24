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
- Never modify `api/src/db/schema.sql` for existing tables; use numbered migrations.
- PostgreSQL is local, not Docker.
- For E2E, run `pnpm test:e2e:setup` once (or after Playwright bumps), then use `/e2e-test-runner` or `pnpm test:e2e:run` with full permissions — agent sandboxes lack Playwright browsers and report false 100% launch failures. API unit tests need `DATABASE_URL=…/ship_test_audit` (never truncate `ship_dev`).
- For `gh` (PRs, issues): default repo is **origin** (`MichaelHabermas/ship-shape`). Run `./scripts/setup-gh-default.sh` after clone; never use `US-Department-of-the-Treasury/ship` as the gh target. Treasury is remote `treasury` (fetch-only).

## Default Commands

```bash
pnpm dev
pnpm build
pnpm type-check
pnpm test
pnpm db:migrate
pnpm db:seed
pnpm security:probe:ci   # CI gate: full probe, --fail-on=new (needs Postgres)
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
