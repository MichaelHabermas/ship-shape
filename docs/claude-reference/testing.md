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

Requires PostgreSQL running locally. Tests share a single database connection via `api/src/db/client.js` but clean up via `beforeAll` in setup.

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

## Database Isolation

### E2E Tests (Testcontainers)

Each Playwright worker gets isolated infrastructure:

```
Worker 0:
  - PostgreSQL container (port 50000-50099)
  - API server (built dist)
  - Vite preview server

Worker 1:
  - PostgreSQL container (port 50100-50199)
  - API server (built dist)
  - Vite preview server
```

See: `e2e/fixtures/isolated-env.ts:91-117` for container setup

Memory per worker: ~500MB (150MB Postgres + 100MB API + 50MB Preview + 200MB Browser)

### Unit Tests (Shared Database)

Unit tests share one database but clean tables in `beforeAll`:

```typescript
// api/src/test/setup.ts:11-23
beforeAll(async () => {
  await pool.query('DELETE FROM workspace_invites WHERE 1=1')
  await pool.query('DELETE FROM sessions WHERE 1=1')
  // ... clean all tables in FK order
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

- Screenshots saved on failure to `test-results/`
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

Local note from the May 20, 2026 run: this checkout referenced `/e2e-test-runner`, but the skill was not present under `.agents/skills` or `.claude/skills`. For environments where the skill is unavailable, use the repo-local fallback `pnpm test:e2e:run`. It preserves the same background/polling behavior, captures output in `test-runs/e2e-run.log`, archives prior progress files, and accepts Playwright flags such as `-- --last-failed`. Docker must be running because the E2E fixture uses Testcontainers to start PostgreSQL per worker. On fresh machines or after a Playwright version bump, run `pnpm test:e2e:setup` first.

### Memory Issues with Parallel Workers

Each worker needs ~500MB. System calculates safe worker count based on:
- Available memory (keep 2GB free)
- CPU cores (no more workers than cores)

Override with: `PLAYWRIGHT_WORKERS=2 pnpm test:e2e`

## Latest Known E2E Findings

Last full local run: May 20, 2026 via `pnpm test:e2e:run`.

Final Playwright status: failed. `test-results/.last-run.json` reported one final failed test:

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

Important runner note: `test-results/summary.json` is a progress file, not the source of truth for final pass/fail when retries are involved. Use Playwright's final exit code and `test-results/.last-run.json` for final failure status, and use `test-results/errors/*.log` for details.

## Progress Monitoring

E2E tests write progress to `test-results/`:

| File | Purpose |
|------|---------|
| `progress.jsonl` | Per-test status updates |
| `summary.json` | Total/passed/failed counts |
| `errors/*.log` | Detailed error output |

See `e2e/progress-reporter.ts` for implementation.

## CI Configuration

In CI (`process.env.CI`):
- 4 workers (CI runners have good resources)
- 2 retries on failure
- GitHub reporter for annotations
- HTML report (never opens)
