# Ship Codebase Gotchas

Things that might trip you up when working on Ship. Each gotcha includes specific file:line references.

## 1. Cascade Deletes

Deleting parent documents cascades to children. This is intentional but can surprise you.

**Affected tables:**

- `documents.parent_id` - deleting a parent wiki deletes all child pages
- `document_associations` - deleting either document removes the association
- `workspace_memberships` - deleting workspace or user removes membership

**Key locations:**

- `api/src/db/schema.sql:119` - `parent_id UUID REFERENCES documents(id) ON DELETE CASCADE`
- `api/src/db/migrations/020_document_associations.sql:17-18` - Both `document_id` and `related_id` cascade

**Risk:** Deleting a project document does NOT cascade to issues (uses `ON DELETE SET NULL` at schema.sql:108), but deleting a parent wiki page DOES delete all children.

## 2. Session Timeout (NIST Compliance)

Sessions have **two** independent timeouts - missing either one logs users out.

| Timeout | Duration | Trigger |
|---------|----------|---------|
| Inactivity | 15 minutes | No API calls or activity |
| Absolute | 12 hours | Since session creation |

**Key locations:**

- `shared/src/constants.ts:28` - `SESSION_TIMEOUT_MS = 15 * 60 * 1000`
- `shared/src/constants.ts:31` - `ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000`
- `api/src/middleware/auth.ts:154-169` - Both timeouts checked
- `api/src/collaboration/index.ts:446-452` - WebSocket connections also enforce these

**Gotcha:** The collaboration WebSocket enforces the same timeouts. Long-idle editing sessions will disconnect.

## 3. Document Associations - Junction Table Plus Parent Hierarchy

Documents use `parent_id` for hierarchy and `document_associations` for program, project, and week membership.

**Hierarchy column:**

```sql
parent_id UUID REFERENCES documents(id) ON DELETE CASCADE
```

**Membership junction table:**

```sql
-- api/src/db/migrations/020_document_associations.sql
document_associations(document_id, related_id, relationship_type)
```

**Gotcha:** Do not recreate legacy `program_id`, `project_id`, or `sprint_id` document columns. They were removed by migrations; code should use `document_associations` for program/project/week membership and `parent_id` only for hierarchy.

## 4. Error Response Inconsistency

Newer routes use structured `{ success, data, error }` format. Older routes use plain `{ error: string }`.

**New format (auth, admin, workspaces, invites):**

```typescript
// api/src/routes/auth.ts:22-28
res.status(400).json({
  success: false,
  error: {
    code: ERROR_CODES.VALIDATION_ERROR,
    message: 'Email and password are required',
  },
});
```

**Old format (standups, team, search):**

```typescript
// api/src/routes/standups.ts:45
res.status(404).json({ error: 'Workspace not found' });

// api/src/routes/team.ts:189
res.status(500).json({ error: 'Internal server error' });
```

**Key locations:**

- `shared/src/types/api.ts:2-12` - Canonical `ApiResponse` type
- Routes using old format: `standups.ts`, `team.ts`, `search.ts`
- Routes using new format: `auth.ts`, `admin.ts`, `workspaces.ts`, `invites.ts`, `api-tokens.ts`

**Gotcha:** Frontend error handling must check for both `error.message` (new) and plain `error` string (old).

## 5. Empty Tests Pass Silently

Tests with only TODO comments pass with no warning. This is a major footgun.

**Bad (silently passes):**

```typescript
test('my test', async ({ page }) => {
  // TODO: implement this
});
```

**Good (properly skipped):**

```typescript
test.fixme('my test', async ({ page }) => {
  // TODO: implement this
});
```

**Key locations:**

- `scripts/check-empty-tests.sh` - Pre-commit hook catches these
- `.husky/pre-commit:1-3` - Hook runs on every commit

**Gotcha:** The pre-commit hook only catches empty tests at commit time. During development, you won't see failures.

## 6. E2E Test Output Explosion

Never run `pnpm test:e2e` directly (it exits with guidance and can flood agent output).

**Instead:** Use the `/e2e-test-runner` skill; if unavailable, use `pnpm test:e2e:run`. The skill/runner:

- Runs tests in background
- Polls `test-results/summary.json` for progress
- Supports `--last-failed` for iterative fixing

**Key locations:**

- `.claude/CLAUDE.md:55-58` - Documents this requirement

**Sandbox false failures:** Agent sandboxes may lack Playwright browsers. Symptom: `0 passed`, every test fails with `browserType.launch: Executable doesn't exist` under `cursor-sandbox-cache/.../playwright/`. Run `pnpm test:e2e:setup`, rerun with full permissions, and smoke-gate with `pnpm test:e2e:smoke` before a full suite.

## 7. Yjs State - Binary Buffer Manipulation

`yjs_state` is stored as `BYTEA` (binary). Converting incorrectly corrupts collaborative state.

**Correct pattern:**

```typescript
// api/src/collaboration/index.ts:129-131
await pool.query(
  `UPDATE documents SET yjs_state = $1, properties = $2, updated_at = now() WHERE id = $3`,
  [Buffer.from(state), JSON.stringify(updatedProps), docId]
);
```

**Key locations:**

- `api/src/db/schema.sql` - Column definition (`yjs_state BYTEA`)
- `api/src/collaboration/index.ts:318-320` - Loading from DB
- `api/src/routes/documents/content.ts`:405-407 - Setting to NULL clears state

**Gotcha:** When updating `content` via REST API, `yjs_state` is set to NULL (line 407). This forces the collaboration server to regenerate state from the new content.

## 8. Worktree Ports

Multiple worktrees need different ports to run simultaneously.

**Port allocation:**

- API base: 3000, Web base: 5173
- Script finds first available port starting from base
- Worktree-init calculates offset from branch name hash

**Key locations:**

- `scripts/dev.sh:65-92` - Port finding logic
- `scripts/worktree-init.sh:17-27` - Deterministic port offset from branch name

**Gotcha:** If you manually start servers, check which ports are in use first. The dev script handles this automatically.

## 9. Migration System - Never Modify schema.sql

Schema changes for existing tables MUST go in migration files, not schema.sql.

**Migration files location:**

```
api/src/db/migrations/
├── 001_properties_jsonb.sql
├── 002_person_membership_decoupling.sql
├── ...
└── 040_relationship_mutation_guards.sql
```

**Key locations:**

- `api/src/db/migrate.ts:46` - Creates `schema_migrations` tracking table
- `api/src/db/migrate.ts:53` - Queries applied migrations
- `api/src/db/migrate.ts:76-91` - Runs each migration in transaction

**Gotcha:** `schema.sql` is only for initial database creation. Modifying it doesn't affect existing databases.

## 10. Type Locations - Some Types in Route Files

Not all types are in `shared/src/types/`. Some domain types are defined locally in route files.

**Types in route files:**

- `api/src/routes/dashboard/types.ts`:11-21 - `Urgency` type, `WorkItem` interface
- `api/src/routes/caia-auth.ts:381` - `interface PendingInvite`
- `api/src/routes/claude/types.ts`:21-43 - Multiple stat interfaces

**Types in shared:**

- `shared/src/types/api.ts` - `ApiResponse`, `ApiError`, `PaginationParams`
- `shared/src/types/document.ts` - Document types, `BelongsTo` (replaces legacy API-local `BelongsToEntry`)
- `shared/src/types/user.ts` - User types
- `shared/src/types/workspace.ts` - Workspace types

**Gotcha:** When adding types, decide: if used by both API and web, put in `shared/`. If API-only and route-specific, local definition is acceptable.

---

## Quick Reference

| Gotcha | Risk Level | Prevention |
|--------|------------|------------|
| Cascade deletes | High | Check foreign key constraints before delete |
| Session timeout | Medium | Test with time manipulation, use `useSessionTimeout` hook |
| Dual associations | Medium | Check both column and junction table when debugging |
| Error formats | Low | Use type guards to handle both formats |
| Empty tests | High | Always use `test.fixme()` for stubs |
| E2E output | High | Use `/e2e-test-runner` skill only |
| Yjs corruption | High | Use `Buffer.from()`, never string cast |
| Port conflicts | Low | Use `pnpm dev` which handles this |
| Schema.sql edits | High | Create migration file instead |
| Type locations | Low | Check route file if not in shared/ |
