# E2E Test Writing Guide — Avoiding Flakiness

This guide captures lessons learned from diagnosing and fixing flaky E2E tests. Follow these patterns when writing new tests to minimize flakiness under parallel execution.

## Core Principle

Tests run in parallel across multiple workers, each with its own PostgreSQL container, API server, and browser. Under load, **everything takes longer** — API responses, DOM updates, React re-renders, WebSocket sync, and keyboard event processing. Tests must never assume operations complete within a fixed time.

## Fast Feedback Workflow

Start with the narrowest signal that can prove or disprove the change:

```bash
pnpm test:e2e:inventory          # Static suite shape; does not run tests
pnpm test:e2e:run -- --last-failed
pnpm test:e2e:run e2e/issues.spec.ts
pnpm test:e2e:smoke
```

Run a lane before the full suite when the change maps cleanly to one area. Lanes are triage signals, not landing proof. Docker must be running for real E2E execution because Testcontainers starts PostgreSQL per worker; `--list` is the only runner path that bypasses Docker. Use `E2E_RESULTS_DIR=...` for concurrent lanes or shards. Treat `summary.json` as progress only; final status comes from Playwright's exit code and `${E2E_RESULTS_DIR:-test-results}/playwright/.last-run.json`.

**Agent triage:** After the first failure, read `test-results/e2e-run.log`. If several failures share one error (missing browser, Docker down, wrong `DATABASE_URL`), stop the suite and fix that — do not burn the full run. `scripts/e2e-preflight.sh` checks Docker + Chromium before `run-e2e.sh` starts; the runner also aborts when failures pile up with zero passes and a known infra signature.

Do not make tests faster by weakening assertions, adding blind waits, or hiding failures behind conditional skips. If tests share mutable state, prefer unique seeded records; otherwise use `test.describe.configure({ mode: 'serial' })` deliberately and explain why in the test file.

## Authentication (mandatory)

Do **not** copy-paste login flows into spec files. Import from `e2e/fixtures/api-auth.ts`:

| Helper | Use when |
|--------|----------|
| `login(page, email?, password?)` | UI `/login` form (default admin) |
| `loginAsAdmin(page)` | UI admin only |
| `loginAsMember(page)` | UI member (`bob.martinez@ship.local`) |
| `loginAsSuperAdmin(page)` | UI super-admin (same creds as admin in E2E seed) |
| `loginViaApi(page, apiUrl)` | UI login + CSRF for `page.request` against `apiServer.url` |
| `loginAsAdmin(page, apiUrl)` | Same as `loginViaApi` |
| `loginAsAdminWithUser(page, apiUrl)` | Admin + CSRF + `userId` from `/api/auth/me` |
| `loginMemberViaApi(page, apiUrl)` | Member + CSRF |
| `getCsrfToken(page, apiUrl?)` | CSRF only (after login) |
| `loginAndGetSessionCookieHeader(page)` | Manual `Cookie` header for rare API specs |

`e2e/fixtures/app.ts` re-exports `login` and provides `authenticatedPage` for fixture-based specs.

## Reusable Helpers

Import helpers from `e2e/fixtures/test-helpers.ts` instead of writing inline retry logic:

```typescript
import { triggerMentionPopup, hoverWithRetry, waitForTableData } from './fixtures/test-helpers'
```

- **`triggerMentionPopup(page, editor)`** — Type `@` and wait for the mention autocomplete popup with robust retry
- **`hoverWithRetry(target, assertion)`** — Hover an element and verify a post-hover assertion with retry
- **`waitForTableData(page, selector?)`** — Wait for table rows to render and network to settle

## Anti-Patterns and Fixes

### 1. `waitForTimeout()` as synchronization

`waitForTimeout(N)` is a guess at how long something takes. Under load, that guess is wrong.

```typescript
// BAD: Fixed delay before checking result
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await expect(highlight).not.toBeVisible()

// GOOD: Auto-retrying assertion (polls until condition met or timeout)
await page.keyboard.press('Escape')
await expect(highlight).not.toBeVisible({ timeout: 10000 })
```

```typescript
// BAD: Fixed delay after clicking a tab
await triageTab.click()
await page.waitForTimeout(1000)
const count = await rows.count()

// GOOD: Wait for the expected result of the tab click
await triageTab.click()
await expect(rows.first()).toBeVisible({ timeout: 10000 })
const count = await rows.count()
```

### 2. `isVisible().catch(() => false)` — silent swallowing

This pattern silently skips a step when it fails, masking the real issue.

```typescript
// BAD: Silently skips clicking the tab if it's slow to render
const tab = page.locator('button', { hasText: 'Needs Triage' })
if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
  await tab.click()
}

// GOOD: Wait for the tab, then click it
const tab = page.getByRole('tab', { name: /needs triage/i })
await expect(tab).toBeVisible({ timeout: 10000 })
await tab.click()
```

### 3. Point-in-time checks on async state

Checking a value at a single moment misses state that hasn't propagated yet.

```typescript
// BAD: Count might be stale if UI hasn't updated
await page.waitForTimeout(500)
const hasNoIssues = await noIssuesMessage.isVisible().catch(() => false)
expect(hasNoIssues).toBe(false)

// GOOD: Wait for the positive condition directly
await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 })
```

### 4. Hover without table stabilization

Under load, late-arriving data causes table re-renders that shift rows. A hover that fires during a re-render targets the wrong element.

```typescript
// BAD: Hover immediately after first row is visible
await expect(rows.first()).toBeVisible()
await rows.nth(2).hover()
await expect(rows.nth(2)).toHaveAttribute('data-focused', 'true')

// GOOD: Wait for data to stabilize, then hover with retry
await waitForTableData(page)
await hoverWithRetry(rows.nth(2), async () => {
  await expect(rows.nth(2)).toHaveAttribute('data-focused', 'true', { timeout: 3000 })
})
```

### 5. Mention popup without retry

The TipTap `@` mention popup requires the editor to be focused and the mention extension to be initialized. Under load, keystrokes can be swallowed.

```typescript
// BAD: Type @ once and hope it works
await editor.click()
await page.keyboard.type('@')
await expect(popup).toBeVisible({ timeout: 5000 })

// GOOD: Use the helper which retries with focus re-establishment
await triggerMentionPopup(page, editor)
```

### 6. Markdown shortcuts without verification

TipTap markdown shortcuts (e.g., `## ` for headings) process asynchronously. Typing more content before the conversion completes can lose the heading.

```typescript
// BAD: Type heading shortcut, fixed delay, then type paragraph
await page.keyboard.type('## My Heading')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
await page.keyboard.type('Paragraph text')

// GOOD: Wait for the heading element to appear before continuing
await page.keyboard.type('## My Heading')
await page.keyboard.press('Enter')
await expect(editor.locator('h2')).toContainText('My Heading', { timeout: 5000 })
await editor.click()
await page.keyboard.type('Paragraph text')
```

### 7. Tests that mutate shared state with `fullyParallel`

When `fullyParallel: true` is set in playwright.config.ts, tests from different `describe` blocks within the same file can interleave. If one block mutates data (e.g., accepting/rejecting issues) while another reads it, results are unpredictable.

```typescript
// BAD: Read tests and mutation tests in separate describe blocks with fullyParallel
test.describe('Read Tests', () => {
  test('lists triage issues', ...) // Reads triage count
})
test.describe('Mutation Tests', () => {
  test('accepts a triage issue', ...) // Moves triage → backlog
})

// GOOD: Force serial execution when tests share mutable state
test.describe.configure({ mode: 'serial' })
```

### 8. UTC/timezone mismatches in seed data

Seed data that uses local time (`new Date()`) but is read back as UTC by the API causes sprint number mismatches. The API parses dates from PostgreSQL as UTC.

```typescript
// BAD: Local time Date object — toISOString converts to UTC, creating mismatch
const threeMonthsAgo = new Date()
threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
const dateStr = threeMonthsAgo.toISOString().split('T')[0]

// GOOD: Explicit UTC — matches how the API parses the date
const now = new Date()
const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate()))
const dateStr = threeMonthsAgo.toISOString().split('T')[0]
```

## General Guidelines

1. **Use `expect().toBeVisible({ timeout: N })` instead of `waitForTimeout(N)`** — auto-retrying assertions handle variable latency gracefully.

2. **Use `toPass()` for multi-step interactions that may fail** — wraps an action + assertion in a retry loop. Use for hover, mention popup, slash commands, or any interaction where the first attempt may not register.

3. **Wait for table data before interacting with rows** — call `waitForTableData(page)` or at minimum `await expect(rows.first()).toBeVisible()` + `await page.waitForLoadState('networkidle')`.

4. **Use `test.describe.configure({ mode: 'serial' })` when tests share mutable state** — prevents `fullyParallel` from interleaving read and write tests.

5. **Use `test.fixme()` instead of empty test bodies** — empty tests pass silently. `test.fixme()` marks them as known-incomplete.

6. **Prefer `getByRole()` over CSS selectors** — role-based selectors are more specific and less likely to match multiple elements.

7. **Don't add `test.slow()` as a first resort** — it triples the timeout but doesn't fix the underlying issue. Fix the timing patterns first; only use `test.slow()` for genuinely long tests.

8. **Seed data should use UTC date math** — always use `Date.UTC()` and `getUTC*()` methods when computing dates that will be stored in PostgreSQL and read back by the API.

## Check for Existing Helpers Before Writing Retry Logic

Before writing inline `toPass()` retry loops or `waitForTimeout()` workarounds, check `e2e/fixtures/test-helpers.ts` for existing helpers that solve common flaky interaction patterns. These helpers encapsulate tested retry logic with appropriate timeouts and intervals.

If an existing helper covers your use case, use it. If your interaction pattern is new and likely to be reused across multiple test files, consider adding a new helper to `test-helpers.ts` rather than writing inline retry logic that will need to be duplicated.
