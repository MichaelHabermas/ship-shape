# Ship FAQ

Frequently asked questions organized by topic.

## Table of Contents

- [Setup & Development](#setup--development)
- [Testing](#testing)
- [Editor & Collaboration](#editor--collaboration)
- [Deployment & Infrastructure](#deployment--infrastructure)
- [Authentication & Security](#authentication--security)

---

## Setup & Development

### How do I set up the development environment?

1. **Prerequisites**: PostgreSQL running locally (not Docker), Node.js 20+, pnpm 9+
2. **Install dependencies**: `pnpm install`
3. **Start development**: `pnpm dev`

The `pnpm dev` command (via `scripts/dev.sh`) automatically creates the database, runs migrations, and seeds test data on first run.

### Why does `pnpm dev` fail?

| Error | Solution |
|-------|----------|
| `createdb` fails | Ensure PostgreSQL is running: `brew services start postgresql` |
| `EADDRINUSE` | Another process using port 3000 or 5173 |
| Module not found | Run `pnpm install` and `pnpm build:shared` |
| Database connection refused | Check PostgreSQL is running via `psql` |

### What ports does the application use?

| Service | Default Port |
|---------|-------------|
| API (Express) | 3000 |
| Web (Vite) | 5173 |
| WebSocket | Same as API |

When running multiple worktrees, ports auto-increment. Check the `.ports` file.

### How do I add a new API endpoint?

1. Create/modify route file in `api/src/routes/`
2. Use Zod schemas for validation
3. Apply `authMiddleware` for protected routes
4. Register in `api/src/app.ts`

See `api/src/routes/issues.ts` for a complete example.

### How do I create a new document type?

**Important**: Ship uses Unified Document Model. Don't create new tables.

1. Add to PostgreSQL enum via migration
2. Add TypeScript types in `shared/src/types/document.ts`
3. Rebuild: `pnpm build:shared`
4. Create API routes

See `docs/unified-document-model.md` for full details.

### How do I write a database migration?

1. Create file in `api/src/db/migrations/` with next number (e.g., `023_add_column.sql`)
2. Write the SQL (each migration runs in a transaction)
3. Run: `pnpm db:migrate`

**Never modify `schema.sql` for existing tables** - only use migrations.

### Why are my types not updating?

Run `pnpm build:shared` after changing shared types. This compiles to `shared/dist/`.

---

## Testing

### How do I run unit tests?

```bash
pnpm test
```

PostgreSQL must be running. Tests use real database integration.

### Why can't I run `pnpm test:e2e` directly?

**Never run `pnpm test:e2e` directly in Claude Code.** The output from 600+ tests crashes the context.

Use the `/e2e-test-runner` skill instead (fallback: `pnpm test:e2e:run`), which handles background execution and progress tracking.

On fresh machines, after Playwright version bumps, or when agent sandboxes report `browserType.launch: Executable doesn't exist`, run `pnpm test:e2e:setup` first and rerun with full permissions. Smoke-gate with `pnpm test:e2e:smoke` before a full suite.

### How do I debug a failing E2E test?

1. Check error logs: `cat test-results/errors/*.log`
2. Run with debug: `DEBUG=1 pnpm test:e2e:run e2e/specific-test.spec.ts`
3. Use UI mode: `pnpm test:e2e:ui`
4. View HTML report: `playwright-report/index.html`

### What test data is seeded?

- 1 workspace with 11 users
- 5 programs, 3 projects each
- 7 weeks per program
- ~40 issues with various states

Test credentials: `dev@ship.local` / `admin123`

### Why do empty tests pass silently?

Tests with only `// TODO:` comments pass. Use `test.fixme()` instead. The pre-commit hook catches these.

---

## Editor & Collaboration

### How do I add a new TipTap extension?

1. Install package if needed
2. Import in `web/src/components/Editor.tsx`
3. Add to `baseExtensions` array

Custom extensions go in `web/src/components/editor/`.

### How do I add a new slash command?

Add to `slashCommands` array in `web/src/components/editor/SlashCommands.tsx` (lines 255-571).

### Why isn't my editor content saving?

1. Check sync status indicator (Green "Saved" = synced)
2. Check browser console for WebSocket errors
3. Server persistence is debounced (2 seconds)
4. Session may have timed out (15 min inactivity)

### How does real-time collaboration work?

Ship uses Yjs CRDTs synced over WebSockets:

- Client creates Y.Doc per document
- IndexedDB loads cached content first
- WebSocket syncs with server
- Server persists to PostgreSQL

### What's the difference between `content` and `yjs_state`?

| Column | Format | Purpose |
|--------|--------|---------|
| `content` | TipTap JSON | Human-readable, for queries |
| `yjs_state` | Yjs binary | CRDT state for collaboration |

---

## Deployment & Infrastructure

### How do I deploy to shadow (UAT)?

```bash
./scripts/deploy.sh shadow
./scripts/deploy-web.sh shadow
```

Deploy both API and frontend together - they must stay in sync.

### How do I deploy to production?

```bash
./scripts/deploy.sh prod
./scripts/deploy-web.sh prod
```

Only after PR merge to master. Always deploy to shadow first for UAT.

### What's the difference between dev, shadow, and prod?

| Environment | Purpose |
|-------------|---------|
| dev | Active development |
| shadow | UAT before merge |
| prod | Production |

### How do I run database migrations in production?

Migrations run **automatically** on application startup via `api/src/db/migrate.ts`.

### How do I check application logs?

```bash
cd api
eb logs                # Recent logs
eb logs --stream       # Stream real-time
```

### How do I rollback a deployment?

```bash
# List versions
aws elasticbeanstalk describe-application-versions --application-name ship-api

# Deploy previous version
eb deploy --version <previous-version>
```

---

## Authentication & Security

### How does session authentication work?

- Cryptographically secure session ID (256 bits)
- Stored in `sessions` table with user binding
- Cookie with `httpOnly`, `secure`, `sameSite: 'strict'`

### What are the session timeout values?

| Type | Duration |
|------|----------|
| Inactivity | 15 minutes |
| Absolute | 12 hours |

NIST SP 800-63B-4 AAL2 compliance.

### How do API tokens work?

- Format: `ship_` + 64 hex characters
- SHA-256 hash stored (never plaintext)
- Token shown only once at creation
- Usage: `Authorization: Bearer ship_...`

### How do I check if a user can access a document?

Use `getVisibilityContext()` and `VISIBILITY_FILTER_SQL` from `api/src/middleware/visibility.ts`:

- `workspace`: All members can see
- `private`: Only creator + admins

### Why did my commit get rejected?

Pre-commit hooks run:

1. **gitleaks** - Scans for secrets
2. **AI analysis** - Scans for sensitive info
3. **Empty test check** - Catches TODO-only tests

**Never use `git commit --no-verify`** - this is prohibited.

### What should I do if I accidentally committed a secret?

1. **Revoke immediately** - Generate new key
2. **Remove from git history** - Use `git filter-repo` or BFG
3. **Update ATTESTATION.md** - Document the incident

Prevention: Use `.env.local` for local secrets, SSM for production.
