# Testing Guide

## Testing Stack

| Layer | Framework | Config | Files |
|-------|-----------|--------|-------|
| Unit (API) | Vitest | `api/vitest.config.ts` | `api/src/**/*.test.ts` |
| Unit (Web) | Vitest + jsdom | `web/vitest.config.ts` | `web/src/**/*.test.ts` |
| E2E | Playwright | `playwright.config.ts` | `e2e/*.spec.ts` |

Setup files:

- API: `api/src/test/setup.ts` - cleans database before tests
- Web: `web/src/test/setup.ts` - imports `@testing-library/jest-dom`

## Running Tests

### Unit Tests

```bash
pnpm test              # Run API unit tests (vitest)
```

Requires PostgreSQL running locally. Tests share a single database connection via `api/src/db/client.ts` but clean up via `beforeAll` in setup.

### E2E Tests - USE THE SKILL

**ALWAYS use `/e2e-test-runner` skill when running E2E tests.**

```bash
# WRONG - causes output explosion (600+ tests crash Claude Code)
pnpm test:e2e

# RIGHT - use the skill
/e2e-test-runner
```

The skill handles:

- Running tests in background
- Progress polling via `test-results/summary.json`
- `--last-failed` for iterative fixing

If the skill is unavailable, use the repo-local safe runner:

```bash
pnpm test:e2e:run
pnpm test:e2e:run -- --last-failed
pnpm test:e2e:run e2e/issues.spec.ts
```

For the Week 4 audit deliverable, record that this repo's root `pnpm test` script runs API unit tests only. Measure E2E with `/e2e-test-runner` or `pnpm test:e2e:run`, and measure web tests or coverage separately when the category requires it.

Do not run the full suite when a smaller signal will answer the question.

### E2E Fast Feedback Lanes

The lane scripts are wrappers around `scripts/run-e2e.sh`; they keep the same Playwright config, worker isolation, reporter, and raw argument pass-through.

```bash
pnpm test:e2e:smoke      # auth, docs mode, issues happy paths
pnpm test:e2e:docs       # docs/document/wiki workflows
pnpm test:e2e:issues     # issue list, bulk selection, estimates, program/week issue flows
pnpm test:e2e:editor     # TipTap/editor features
pnpm test:e2e:a11y       # accessibility and ARIA checks
pnpm test:e2e:api-flows  # temporary lane for API-shaped Playwright specs
pnpm test:e2e:foundation # workspace, modes, context menus, icons, errors
pnpm test:e2e:slow       # performance, race, visual, session, security-heavy flows
```

Lanes are fast triage signals, not landing proof. Use the smallest lane that matches the change first, then run the appropriate full command or skill before treating the suite as proven.

Use Playwright flags after `--`:

```bash
pnpm test:e2e:smoke -- --list
pnpm test:e2e:run -- --shard=1/4
PLAYWRIGHT_WORKERS=2 pnpm test:e2e:issues
```

Set `E2E_RESULTS_DIR` when running multiple lanes or shards at the same time so progress files, error logs, Playwright artifacts, `.last-run.json`, and the background run log do not clobber each other. The runner stores Playwright artifacts under `${E2E_RESULTS_DIR:-test-results}/playwright`.

```bash
E2E_RESULTS_DIR=test-results/smoke pnpm test:e2e:smoke
E2E_RESULTS_DIR=test-results/shard-1 pnpm test:e2e:run -- --shard=1/4
```

Use `pnpm test:e2e:inventory` to inspect suite shape without executing tests. It reports approximate test declarations, fixed waits, login/setup signals, API request signals, large files, and duplicate umbrella coverage candidates.

## Database Isolation

### E2E Tests (Testcontainers)

Each Playwright worker gets isolated infrastructure:

```
Worker 0:
  - PostgreSQL container
  - API/web ports from range 10000-10099
  - API server (built dist)
  - Vite preview server

Worker 1:
  - PostgreSQL container
  - API/web ports from range 10100-10199
  - API server (built dist)
  - Vite preview server
```

See: `e2e/fixtures/isolated-env.ts:91-117` for container setup

Memory per worker: ~500MB (150MB Postgres + 100MB API + 50MB Preview + 200MB Browser)

### Unit Tests (Shared Database)

Unit tests share one database but clean tables in `beforeAll` via `TRUNCATE CASCADE` (guarded to refuse non-test databases):

```typescript
// api/src/test/setup.ts:7-30
beforeAll(async () => {
  process.env.NODE_ENV = 'test';

  const databaseName = (process.env.DATABASE_URL || '').split('/').pop()?.split('?')[0] || '';
  if (!/(^|[_-])(test|audit)([_-]|$)/i.test(databaseName) && process.env.ALLOW_DESTRUCTIVE_TEST_DB !== 'true') {
    throw new Error('Refusing to truncate non-test database');
  }

  await pool.query(`TRUNCATE TABLE
    workspace_invites, sessions, files, document_links, document_history,
    comments, document_associations, document_snapshots, sprint_iterations,
    issue_iterations, documents, audit_logs, workspace_memberships,
    users, workspaces
    CASCADE`);
})
```

## Test Patterns

### API Unit Tests

**Pattern: describe/it with beforeAll/afterAll for setup/teardown**

```typescript
// api/src/routes/files.test.ts:7-74
describe('Files API', () => {
  const app = createApp('http://localhost:5173');
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let sessionCookie: string;
  let testWorkspaceId: string;

  beforeAll(async () => {
    // Create workspace, user, session
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;
    // ...
  });

  afterAll(async () => {
    // Clean up in FK order
    await pool.query('DELETE FROM files WHERE workspace_id = $1', [testWorkspaceId]);
    // ...
  });

  it('POST /api/files/upload creates file record', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({ filename: 'test.png', mimeType: 'image/png', sizeBytes: 1024 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fileId');
  });
});
```

**Pattern: Unique test IDs to prevent conflicts**

```typescript
// api/src/routes/backlinks.test.ts:9-12
const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const testEmail = `backlinks-${testRunId}@ship.local`;
const testWorkspaceName = `Backlinks Test ${testRunId}`;
```

### Component Tests (Web)

**Pattern: vi.fn() for mocks**

```typescript
// web/src/components/editor/ImageUpload.test.ts:11-26
it('should accept callback options', () => {
  const onUploadStart = vi.fn();
  const onUploadComplete = vi.fn();
  const onUploadError = vi.fn();

  const extension = ImageUploadExtension.configure({
    onUploadStart,
    onUploadComplete,
    onUploadError,
  });

  expect(extension.options.onUploadStart).toBe(onUploadStart);
});
```

### E2E Tests

**Pattern: Import test/expect from isolated-env fixture**

```typescript
// e2e/auth.spec.ts:1
import { test, expect } from './fixtures/isolated-env'

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
  })

  test('successful login redirects to app', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })
})
```

**Pattern: Wait for API responses**

```typescript
// e2e/documents.spec.ts:54
await page.waitForResponse(resp =>
  resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH'
)
```

## Authentication Fixtures

E2E tests use seed data credentials:

```
Email: dev@ship.local
Password: admin123
```

Login pattern used in most E2E tests:

```typescript
// e2e/documents.spec.ts:4-13
test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 5000 })
})
```

## Fixtures

### isolated-env.ts (Worker-Scoped)

Provides complete isolation per worker. See `e2e/fixtures/isolated-env.ts`:

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `dbContainer` | worker | PostgreSQL via testcontainers |
| `apiServer` | worker | Built API on dynamic port |
| `webServer` | worker | Vite preview on dynamic port |
| `baseURL` | test | Web server URL for navigation |

### dev-server.ts (Lightweight)

For quick local iteration - connects to already-running servers. See `e2e/fixtures/dev-server.ts`:

```typescript
// Requires: pnpm dev running in another terminal
const API_PORT = process.env.TEST_API_PORT || '3000'
const WEB_PORT = process.env.TEST_WEB_PORT || '5173'
```

## Screenshots and Traces

Configured in `playwright.config.ts:69-72`:

```typescript
use: {
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
}
```

- Screenshots saved on failure to `${E2E_RESULTS_DIR:-test-results}/playwright`
- Traces saved on first retry for debugging

## Known Issues

### Empty Tests Pass Silently

Tests with only TODO comments pass without running assertions.

```typescript
// WRONG - silently passes
test('my test', async ({ page }) => {
  // TODO: implement
});

// RIGHT - shows as 'fixme' in report
test.fixme('my test', async ({ page }) => {
  // TODO: implement
});
```

Pre-commit hook `scripts/check-empty-tests.sh` catches these.

### E2E Output Explosion

Running `pnpm test:e2e` directly outputs 600+ test results, crashing Claude Code.

**Always use `/e2e-test-runner` skill** which:

1. Runs tests in background
2. Polls `test-results/summary.json` for progress
3. Shows concise pass/fail summary

Local note from the May 20, 2026 run: this checkout referenced `/e2e-test-runner`, but the skill was not present under `.agents/skills` or `.claude/skills`. For environments where the skill is unavailable, use the repo-local fallback `pnpm test:e2e:run`. It preserves the same background/polling behavior, captures output in `${E2E_RESULTS_DIR:-test-results}/e2e-run.log`, archives prior progress files, stores Playwright output under `${E2E_RESULTS_DIR:-test-results}/playwright`, and accepts Playwright flags such as `-- --last-failed`. Docker must be running because the E2E fixture uses Testcontainers to start PostgreSQL per worker. On fresh machines or after a Playwright version bump, run `pnpm test:e2e:setup` first.

**Agent / Cursor sandbox gotcha (May 22, 2026):** If E2E shows `0 passed` and every failure is `browserType.launch: Executable doesn't exist` under a `cursor-sandbox-cache/.../playwright/` path, the suite never reached the app — Chromium was not installed in the sandbox cache. Fix: run `pnpm test:e2e:setup`, then rerun E2E with unrestricted permissions (not the default agent sandbox). Validate with `pnpm test:e2e:smoke` before a full `pnpm test:e2e:run`. Root `pnpm test` runs API unit tests only; point API Vitest at a disposable DB: `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_test_audit pnpm --filter @ship/api test`.

### Memory Issues with Parallel Workers

Each worker needs ~500MB. System calculates safe worker count based on:

- Available memory (keep 2GB free)
- CPU cores (no more workers than cores)

Override with: `PLAYWRIGHT_WORKERS=2 pnpm test:e2e:run`

## Snapshot: May 20, 2026 Local E2E Findings

Last full local run: May 20, 2026 via `pnpm test:e2e:run`.

Final Playwright status: failed. `test-results/playwright/.last-run.json` reported one final failed test:

```text
e2e/inline-comments.spec.ts:118
canceling a comment removes the highlight
Expected locator('.comment-highlight') not to be visible, but it stayed visible after cancel.
```

Failed attempts that passed on retry should be treated as flake signals:

| Test | Signal |
|------|--------|
| `e2e/bulk-selection.spec.ts:1581` | Strict locator for `#5` also matched `#50` and `#51` |
| `e2e/feedback-consolidation.spec.ts:67` | Timed out waiting for `External feature request` row |
| `e2e/my-week-stale-data.spec.ts` | Plan/retro edits timed out before becoming visible on `/my-week` |
| `e2e/project-weeks.spec.ts:205` | Timed out waiting for `Navigation Test Project` link |
| `e2e/weekly-accountability.spec.ts:469` | Expected assigned person/document id but received `null` |

Important runner note: `summary.json` is a progress file, not the source of truth for final pass/fail when retries are involved. Use Playwright's final exit code and `${E2E_RESULTS_DIR:-test-results}/playwright/.last-run.json` for final failure status, and use `${E2E_RESULTS_DIR:-test-results}/errors/*.log` for reporter details.

## Progress Monitoring

E2E tests write progress to `${E2E_RESULTS_DIR:-test-results}/`:

| File | Purpose |
|------|---------|
| `progress.jsonl` | Per-test status updates |
| `summary.json` | Progress-only total/passed/failed counts |
| `errors/*.log` | Detailed error output |
| `playwright/.last-run.json` | Playwright final failure metadata |

See `e2e/progress-reporter.ts` for implementation.

## CI Configuration

In CI (`process.env.CI`):

- 4 workers (CI runners have good resources)
- 2 retries on failure
- GitHub reporter for annotations
- HTML report (never opens)
