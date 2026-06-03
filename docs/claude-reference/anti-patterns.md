# Anti-Patterns

Patterns to avoid in the Ship codebase. Each anti-pattern includes real examples from the codebase to help identify and fix these issues.

## 1. Console Logging in Production

### What it looks like

```typescript
console.error('List issues error:', err);
console.log('Clicked sidebar button');
```

### Examples in codebase

- `api/src/routes/issues/index.ts` and other routes — use `sendInternalError()` from `api/src/utils/route-http.ts` instead of raw `console.error`
- `e2e/debug-create.spec.ts:26-58` - Multiple `console.log()` statements in test files

### Why it's problematic

- No log levels (info, warn, error, debug)
- No structured metadata (request ID, user ID, timestamp)
- Cannot be routed to log aggregation services
- Cannot be filtered or searched effectively
- Exposes sensitive data in production logs

### What to do instead

Use `sendInternalError()` so errors are logged consistently and responses stay uniform:

```typescript
import { sendInternalError } from '../utils/route-http.js';

// Instead of: console.error('List issues error:', err);
sendInternalError(res, err, 'List issues error:', { error: 'Failed to list issues' });
```

---

## 2. Empty Tests

### What it looks like

```typescript
test('should validate input', () => {
  // TODO: implement this test
});

test('handles edge case', async () => {
  // Will add assertions later
});
```

### Why it's problematic

- Tests with only comments or no assertions **pass silently**
- CI shows green when nothing is actually tested
- Creates false sense of test coverage
- Pre-commit hook `scripts/check-empty-tests.sh` catches these, but manual review is still needed

### What to do instead

Use `test.fixme()` for unimplemented tests:

```typescript
// Instead of empty test body with comments:
test.fixme('should validate input', async () => {
  // TODO: implement this test
});
```

This makes the test appear as "skipped" in test output rather than falsely passing.

---

## 3. Type Assertions to `any`

### What it looks like

```typescript
const result = await transformIssueLinks(content, workspaceId) as any;
expect((editor.commands as any).setDetails).toBeDefined();
```

### Examples in codebase

- `api/src/__tests__/transformIssueLinks.test.ts:35-481` - 25+ instances of `as any` for mocking
- `web/src/components/editor/DetailsExtension.test.ts:75-76` - Testing TipTap commands
- `web/src/components/editor/FileAttachment.test.ts:70-71` - Testing TipTap commands

### Why it's problematic

- Bypasses TypeScript's type safety completely
- Hides type errors that could indicate real bugs
- Makes refactoring dangerous (no compiler help)
- Often a sign of poor interface design

### What to do instead

1. **For mocking**: Create proper mock types or use `vi.mocked()`:

```typescript
// Instead of: vi.mocked(pool.query).mockResolvedValue({} as any);
const mockQueryResult: QueryResult = {
  rows: [],
  command: 'SELECT',
  rowCount: 0,
  oid: 0,
  fields: [],
};
vi.mocked(pool.query).mockResolvedValue(mockQueryResult);
```

2. **For library extensions**: Extend the type definitions:

```typescript
// Instead of: (editor.commands as any).setDetails
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    setDetails: () => ReturnType;
  }
}
```

3. **For unknown types**: Use `unknown` with type guards:

```typescript
// Instead of: const data = response as any;
const data: unknown = response;
if (isValidResponse(data)) {
  // TypeScript now knows the type
}
```

---

## 4. Direct E2E Test Execution

### What it looks like

```bash
pnpm test:e2e
pnpm test:e2e e2e/some-test.spec.ts
```

### Why it's problematic

- Outputs 600+ test results that crash Claude Code
- No progress tracking or summary
- Cannot be run in background with polling
- Fails catastrophically on large test suites

### What to do instead

**Prefer the `/e2e-test-runner` skill; if unavailable, use `pnpm test:e2e:run`:**

```bash
# The skill or pnpm test:e2e:run handles:
# - Background execution
# - Progress polling via test-results/summary.json
# - --last-failed for iterative fixing
```

See `e2e/AGENTS.md` for full details on the E2E workflow.

---

## 5. Modifying schema.sql for Existing Tables

### What it looks like

Editing `api/src/db/schema.sql` to add columns or modify constraints on tables that already exist in production.

### Why it's problematic

- `schema.sql` is only run on fresh database creation
- Changes won't apply to existing databases
- Creates drift between dev and production schemas
- Makes deployments fail silently (no error, just missing changes)

### What to do instead

Create a numbered migration file in `api/src/db/migrations/`:

```sql
-- api/src/db/migrations/023_add_new_column.sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS new_column TEXT;
```

Existing migrations show the pattern:
- `api/src/db/migrations/001_properties_jsonb.sql`
- `api/src/db/migrations/006_document_visibility.sql`
- `api/src/db/migrations/020_document_associations.sql`

Migrations are tracked in `schema_migrations` table and run automatically on deploy.

---

## 6. Using git commit --no-verify

### What it looks like

```bash
git commit --no-verify -m "Quick fix"
git commit -n -m "Bypass hooks"
```

### References in codebase

- `AGENTS.md` - Explicitly prohibits this
- `.claude/CLAUDE.md` - Agent reference for local Claude workflows

### Why it's problematic

- Bypasses `comply opensource` security scans
- Skips gitleaks secret detection
- Can commit credentials, API keys, or sensitive data
- CI will fail anyway (GitHub Actions runs same checks)
- Creates security vulnerabilities

### What to do instead

1. **Fix the issue** - Remove secrets, update files
2. **If the tool is broken** - Report the bug, wait for fix
3. **There is no emergency bypass** - Security is non-negotiable

---

## 7. Inconsistent Error Formats

### What it looks like

```typescript
// Format 1: Object with error key
res.status(400).json({ error: 'Invalid input' });

// Format 2: Object with error and details
res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });

// Format 3: Just error
res.status(500).json({ error: 'Internal server error' });

// Format 4: Different structure
res.status(400).json({ message: 'Bad request' });
```

### Examples in codebase

- `api/src/routes/issues/index.ts`:284-933 - Uses `{ error: string }`
- `api/src/routes/issues/index.ts`:517 - Uses `{ error, details }`
- `api/src/routes/standups.ts:159` - Uses `{ error, details }`
- `api/src/routes/associations.ts:86` - Uses `{ error: 'Failed to...' }`

### Why it's problematic

- Frontend must handle multiple error shapes
- Inconsistent user experience
- Harder to implement global error handling
- Makes debugging more difficult

### What to do instead

Use a consistent error response structure:

```typescript
// Standard error response
interface ErrorResponse {
  error: string;           // Human-readable message
  code?: string;           // Machine-readable error code
  details?: unknown[];     // Validation errors, etc.
}

// Use a helper function
function sendError(res: Response, status: number, message: string, details?: unknown[]) {
  res.status(status).json({
    error: message,
    ...(details && { details }),
  });
}

// Usage
sendError(res, 400, 'Invalid input', parsed.error.errors);
sendError(res, 500, 'Internal server error');
```

---

## 8. Types in Route Files

### What it looks like

```typescript
// In api/src/routes/dashboard.ts
interface WorkItem {
  id: string;
  title: string;
  type: 'issue' | 'project';
  // ...
}

// In api/src/routes/claude.ts
interface ClaudeContextRequest {
  context_type: 'standup' | 'review' | 'retro';
  // ...
}
```

### Examples in codebase

- `api/src/routes/dashboard/index.ts`:11-32 - `WorkItem` interface
- `api/src/routes/claude/types.ts`:21-48 - Multiple interfaces
- `api/src/routes/weeks/index.ts`:265 - `ActionItem` interface
- `api/src/routes/backlinks.ts:158` - `Request` interface
- `api/src/routes/issues/shared.ts`:105 - `BelongsTo` is in `shared/src/types/document.ts`; do not reintroduce local `BelongsToEntry`
- `api/src/routes/caia-auth.ts:381` - `PendingInvite` interface

### Why it's problematic

- Types cannot be shared with frontend (in `web/`)
- Duplicated types across API and frontend
- No single source of truth
- Makes API contract changes risky

### What to do instead

Put shared types in `shared/src/types/`:

```typescript
// shared/src/types/api.ts
export interface WorkItem {
  id: string;
  title: string;
  type: 'issue' | 'project';
  // ...
}

// api/src/routes/dashboard.ts
import { WorkItem } from '@ship/shared';

// web/src/hooks/useDashboard.ts
import { WorkItem } from '@ship/shared';
```

Existing shared types are at:
- `shared/src/types/api.ts`
- `shared/src/types/document.ts`
- `shared/src/types/user.ts`

---

## 9. Magic Numbers

### What it looks like

```typescript
await new Promise(resolve => setTimeout(resolve, 2000));
await expect(page).toHaveURL(/\/docs\/[a-f0-9-]+/, { timeout: 10000 });
await page.waitForSelector('.tiptap', { timeout: 30000 });
```

### Examples in codebase

- `e2e/file-attachments.spec.ts:97` - `setTimeout(..., 5000)`
- `e2e/feedback-consolidation.spec.ts:109` - `setTimeout(..., 3000)`
- `e2e/issue-estimates.spec.ts:28` - `timeout: 10000`
- `e2e/features-real.spec.ts:175` - `timeout: 30000`
- `web/src/hooks/useAutoSave.ts:42` - `1000 * (retryCount + 1)`
- `playwright.isolated.config.ts:41` - `timeout: 60000`

### Why it's problematic

- No semantic meaning (what is 10000ms waiting for?)
- Hard to adjust globally (must find all instances)
- Different values for same concept (10000 vs 30000 for "page load")
- Makes tests flaky when CI is slow

### What to do instead

Define constants with meaningful names:

```typescript
// constants/timeouts.ts
export const TIMEOUTS = {
  PAGE_LOAD: 10_000,
  EDITOR_READY: 5_000,
  IMAGE_UPLOAD: 30_000,
  AUTOSAVE_DEBOUNCE: 1_000,
  CLEANUP_DELAY: 5_000,
} as const;

// Usage
await page.waitForSelector('.tiptap', { timeout: TIMEOUTS.EDITOR_READY });
await expect(img).toBeVisible({ timeout: TIMEOUTS.IMAGE_UPLOAD });
```

For E2E tests, use Playwright config defaults when possible.

---

## 10. Missing Transaction Boundaries

### What it looks like

```typescript
// Multiple queries without transaction
await pool.query('UPDATE documents SET ...', [...]);
await pool.query('INSERT INTO document_history ...', [...]);
// If second query fails, first change is orphaned
```

### Examples of CORRECT usage (with transactions)

- `api/src/routes/issues/index.ts`:513-582 - Issue creation
- `api/src/routes/documents/index.ts`:675-871 - Document operations
- `api/src/routes/backlinks.ts:115-142` - Backlink updates

### Examples of potentially risky patterns

Many routes use multiple `pool.query()` calls without transactions. Check any route that:
1. Updates multiple tables
2. Deletes and inserts related data
3. Creates parent and child records

### Why it's problematic

- Partial failures leave database in inconsistent state
- No rollback if second operation fails
- Race conditions with concurrent requests
- Hard to debug data corruption

### What to do instead

Use explicit transactions for multi-step operations:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // All related operations
  await client.query('UPDATE documents SET ...', [...]);
  await client.query('INSERT INTO document_history ...', [...]);

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

Follow the transaction pattern used in:
- `api/src/routes/issues/index.ts`:513-586
- `api/src/routes/documents/index.ts`:907-1002

---

## 11. Type Re-Export Barrels (Import Only to Re-Export)

### What it looks like

A module imports a type solely to publish it again under the same name:

```typescript
import type { FleetGraphTrace } from '@ship/shared';

export type { FleetGraphTrace } from '@ship/shared';
```

Or the same idea through an intermediate file:

```typescript
// api/src/fleetgraph/types.ts
export type { FleetGraphEvidenceItem } from '@ship/shared';

// elsewhere
import type { FleetGraphEvidenceItem } from '../fleetgraph/types.js';
```

Hook and schema “barrels” do the same thing with OpenAPI aliases:

```typescript
export type { ApiResponse } from '@ship/shared';
export type { Project } from '@/api/schemas';
```

### Why it's problematic

- **Hides the source of truth** — readers cannot tell whether a type is wire contract (`@ship/shared`), OpenAPI (`web/src/api/schemas.ts`), or runtime-only (`api/src/fleetgraph/types.ts`) without opening intermediate files.
- **Duplicates hubs** — one package ends up with several competing barrels (`types.ts`, `persistence.ts`, `api-contract.ts`, `schemas.ts`) that drift as soon as one file imports from the canonical module directly.
- **No added behavior** — unlike a facade that wraps or narrows types, pure re-exports are indirection with zero semantics.
- **Encourages more indirection** — the next contributor re-exports from the barrel instead of the defining module, and the graph gets worse.

### When it is acceptable (rare)

Only when the re-export is **part of a module that owns real API**, not a type-only passthrough:

- **`export *` from a module that defines** functions, constants, and types together (e.g. a feature’s public `index.ts` that is the intentional package boundary).
- **A facade that does work** — e.g. `web/src/lib/document-view-guards.ts` re-exports shared guards alongside web-specific helpers that call them.
- **Narrowing or renaming for a boundary** — e.g. `export type FleetGraphTraceMetadata = Omit<FleetGraphTrace, 'decision'> & { decision: FleetGraphRunDecision }` in a file that also defines runtime-only types (import shared types for composition; do not re-export the wire shape unless this file is the agreed public entry).

If the only change is `export type { X } from '…'`, import `X` at the call site instead.

### What to do instead

| Type kind | Import from |
| --- | --- |
| Cross-package wire / domain contract | `@ship/shared` |
| HTTP/OpenAPI component shape (web) | `@/api/schemas` (OpenAPI-derived aliases) or generated `ship-openapi.d.ts` |
| API runtime-only (internal graph, DB helpers) | The module that **defines** the type (e.g. `api/src/fleetgraph/types.ts`, `api/src/fleetgraph/persistence.ts`) |

```typescript
// Good — consumer imports at source
import type { FleetGraphTrace } from '@ship/shared';
import type { FleetGraphTraceMetadata } from '../fleetgraph/types.js';
import type { ApiResponse } from '@ship/shared';
import type { IssueListItem } from '@/api/schemas';
```

```typescript
// Good — local file uses shared types to define its own export
import type { FleetGraphTrace } from '@ship/shared';

export type FleetGraphTraceMetadata = Omit<FleetGraphTrace, 'decision'> & {
  decision: FleetGraphRunDecision;
};
```

Do **not** add `export type { FleetGraphTrace } from '@ship/shared'` in that file unless this path is the deliberate public API for the whole subtree (and the team enforces that everywhere).

### Cleanup reference (2026)

FleetGraph and related barrels were removed in favor of direct imports; see git history on `api/src/fleetgraph/types.ts`, `web/src/api/schemas.ts`, and sibling files.

---

## Quick Reference

| Anti-Pattern | Detection | Fix |
|--------------|-----------|-----|
| Console logging | `grep -r "console\."` | Use `sendInternalError()` |
| Empty tests | `scripts/check-empty-tests.sh` | Use `test.fixme()` |
| Type assertions to `any` | `grep -r "as any"` | Create proper types |
| Direct E2E execution | Running `pnpm test:e2e` | Use `/e2e-test-runner` or `pnpm test:e2e:run` |
| Modifying schema.sql | Editing `schema.sql` | Create migration file |
| --no-verify | Git history | Never use it |
| Inconsistent errors | Review route responses | Use error helper |
| Types in routes | `grep "interface" api/src/routes` | Move to `shared/` |
| Magic numbers | `grep -E "\d{4,}"` | Use named constants |
| Missing transactions | Multiple `pool.query` calls | Use `BEGIN`/`COMMIT` |
| Type re-export barrels | `export type { X } from '…'` with no local definition | Import `X` from defining module (`@ship/shared`, `@/api/schemas`, etc.) |
