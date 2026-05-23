# Security Architecture

This document describes Ship's security implementation. All authentication and authorization flows follow NIST SP 800-63B-4 guidelines for government applications.

## 1. Authentication

Ship supports three authentication methods with session-based state management.

### Session Management

Sessions use cryptographically secure IDs (256-bit entropy) with dual timeout enforcement:

| Timeout | Duration | Standard |
|---------|----------|----------|
| Inactivity | 15 minutes | NIST SP 800-63B-4 |
| Absolute | 12 hours | NIST SP 800-63B-4 AAL2 |

**Constants** (`shared/src/constants.ts:28-31`):
```typescript
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;      // 15 minutes
export const ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000;  // 12 hours
```

**Session validation** (`api/src/services/session-auth.ts:36-80`, used by `api/src/middleware/auth.ts:135`):
- Shared `validateAuthenticatedSession()` for HTTP and WebSocket paths
- Validates inactivity timeout against `last_activity`
- Validates absolute timeout against `created_at`
- Deletes expired sessions and returns structured failure reasons
- Updates `last_activity` when `updateActivity: true`
- Enforces workspace membership revocation (fail-closed)

### Password Authentication

**Login flow** (`api/src/routes/auth.ts:18-221`):
1. Case-insensitive email lookup
2. bcrypt password verification
3. Session fixation prevention (deletes old session before creating new)
4. Cryptographically secure session ID generation (`crypto.randomBytes(32)`)
5. Stores session binding data (user_agent, ip_address) for audit

**PIV-only users**: Users with `password_hash = NULL` cannot use password login and receive error `"This account uses PIV authentication only"` (`auth.ts:60-74`).

### CAIA OAuth (Government PIV)

**CAIA** (Customer Authentication & Identity Architecture) provides OAuth-based PIV smartcard authentication for Treasury applications.

**Flow** (`api/src/routes/caia-auth.ts`):
1. `/api/auth/caia/login` - Generates authorization URL with PKCE
2. OAuth state stored in database (survives server restarts)
3. `/api/auth/caia/callback` - Validates state, exchanges code for tokens
4. Validates `.gov/.mil` email format (`caia-auth.ts:36-39`)
5. Validates `returnTo` URL is same-origin to prevent open redirect (`caia-auth.ts:44-47`)
6. Creates user from pending invite if no existing account

**Key security notes**:
- CAIA's `sub` claim is NOT persistent (changes on re-provisioning)
- Email is primary identifier (no `x509_subject_dn` exposed)
- Users must be pre-invited before first CAIA login

### API Tokens

**Token format** (`api/src/routes/api-tokens.ts:13-19`):
```typescript
const token = `ship_${crypto.randomBytes(32).toString('hex')}`;
const hash = crypto.createHash('sha256').update(token).digest('hex');
```

**Security properties**:
- Only SHA-256 hash stored in database (never plaintext)
- Token shown only once at creation time
- Token prefix stored for identification (`ship_` + first 7 chars)
- Optional expiration (`expires_in_days`)
- Soft-delete revocation (maintains audit trail)
- `last_used_at` updated on each use

**Validation** (`api/src/middleware/auth.ts:25-63`):
- Checks `Authorization: Bearer` header first, falls back to session cookie
- Validates token not revoked (`revoked_at IS NULL`)
- Validates token not expired
- Sets `req.isApiToken = true` to distinguish from session auth

## 2. Authorization

### Workspace Membership

Users belong to workspaces with roles: `admin` or `member`.

**Membership validation** (`api/src/middleware/auth.ts:182-202`):
```sql
SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2
```

If user no longer has workspace access, session is deleted and `FORBIDDEN` returned.

### Authorization Middleware Stack

**authMiddleware** (`api/src/middleware/auth.ts:65-240`):
- Required on all protected routes
- Validates session or API token
- Attaches `userId`, `workspaceId`, `isSuperAdmin` to request

**superAdminMiddleware** (`api/src/middleware/auth.ts:243-260`):
- Requires `isSuperAdmin = true`
- Used for system-wide administrative operations

**workspaceAdminMiddleware** (`api/src/middleware/auth.ts:263-317`):
- Requires workspace admin role OR super-admin
- Used for workspace-specific admin operations

**workspaceAccessMiddleware** (`api/src/middleware/auth.ts:320-372`):
- Verifies user has any membership in the workspace
- Super-admins bypass this check

### Document Visibility

Documents have visibility: `private` (creator and admins only) or `workspace` (all members).

**Pattern** (`api/src/middleware/visibility.ts:26-55`):
```typescript
export async function getVisibilityContext(userId: string, workspaceId: string) {
  const isAdmin = await isWorkspaceAdmin(userId, workspaceId);
  return { isAdmin };
}

export function VISIBILITY_FILTER_SQL(tableAlias: string, userIdParam: string, isAdminParam: string) {
  return `(${tableAlias}.visibility = 'workspace' OR ${tableAlias}.created_by = ${userIdParam} OR ${isAdminParam} = TRUE)`;
}
```

**Usage in routes** (`api/src/routes/issues.ts:167-168`):
```typescript
const { isAdmin } = await getVisibilityContext(userId, workspaceId);
// ... query with VISIBILITY_FILTER_SQL('d', '$2', '$3') ...
```

**Real-time visibility enforcement** (`api/src/collaboration/index.ts:489-534`):
- When document visibility changes to `private`, non-authorized WebSocket connections are closed with code `4403`
- `handleVisibilityChange()` exported for routes to call after visibility updates

## 3. CSRF Protection

Mutating API routes use `csrf-sync` (`api/src/app.ts:54-67`):

```typescript
import { csrfSync } from 'csrf-sync';

const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] ?? '',
});

// Skip CSRF for Bearer token auth (not auto-attached by browsers)
const conditionalCsrf = (req, res, next) => {
  if (req.headers.authorization?.startsWith('Bearer ')) return next();
  return csrfSynchronisedProtection(req, res, next);
};
```

Clients fetch a token from `GET /api/csrf-token` and send it as `X-CSRF-Token` on mutating requests.

**Session cookie settings** (`api/src/config/session-cookies.ts`, used by `api/src/routes/auth.ts:185`):

```typescript
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: sessionSameSitePolicy(), // 'none' on Render production, 'strict' locally
    maxAge: SESSION_TIMEOUT_MS,
    path: '/',
  };
}
```

**Note**: CAIA OAuth always uses `secure: true` since OAuth requires HTTPS (`caia-auth.ts`).

## 4. Rate Limiting

### WebSocket Rate Limiting

**Configuration** (`api/src/collaboration/index.ts:17-24`):
```typescript
const RATE_LIMIT = {
  CONNECTION_WINDOW_MS: 60_000,    // 1 minute window
  MAX_CONNECTIONS_PER_IP: 30,      // 30 connections per minute per IP
  MESSAGE_WINDOW_MS: 1_000,        // 1 second window
  MAX_MESSAGES_PER_SECOND: 50,     // 50 messages per second per connection
};
```

**Connection limiting** (`collaboration/index.ts:46-61`):
- Tracks connection timestamps per IP (sliding window)
- Returns `429 Too Many Requests` when limit exceeded
- Old timestamps cleaned up every 30 seconds

**Message limiting** (`collaboration/index.ts:64-79`):
- Tracks message timestamps per WebSocket connection
- Exceeding rate silently drops messages (Yjs protocol retries)
- Timestamps cleaned up on connection close

## 5. Input Validation

All API endpoints use Zod schemas for request validation.

### Schema Examples

**Issue validation** (`api/src/routes/issues.ts:17-58`):
```typescript
const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  state: z.enum(['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']),
  assignee_id: z.string().uuid().optional().nullable(),
  belongs_to: z.array(belongsToEntrySchema).optional(),
});
```

**API token validation** (`api/src/routes/api-tokens.ts:26-29`):
```typescript
const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  expires_in_days: z.number().int().positive().optional(),
});
```

**Document validation** (`api/src/routes/documents.ts:43-85`):
```typescript
const createDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional().default('Untitled'),
  document_type: z.enum(['wiki', 'issue', 'program', 'project', 'sprint', 'person']),
  visibility: z.enum(['private', 'workspace']).optional(),
  // ...
});
```

### Validation Pattern

All endpoints follow this pattern:
```typescript
const parsed = schema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
  return;
}
```

## 6. WebSocket Security

**Session validation** (`api/src/collaboration/index.ts:421-467`):
1. Parses session cookie from upgrade request
2. Validates session exists and not expired (same timeouts as HTTP)
3. Updates `last_activity` on successful validation
4. Returns `401 Unauthorized` if invalid

**Document access check** (`collaboration/index.ts:470-493`):
1. Validates user can access document (visibility check)
2. Returns `403 Forbidden` if access denied

**Connection flow** (`collaboration/index.ts:601-643`):
```
HTTP Upgrade Request
    |
    v
Rate limit check (429 if exceeded)
    |
    v
Session validation (401 if invalid)
    |
    v
Document access check (403 if denied)
    |
    v
WebSocket established
```

## 7. Audit Logging

Security events are logged via `logAuditEvent()` (`api/src/services/audit.ts`):

**Logged events include**:
- `auth.login` / `auth.logout`
- `auth.login_failed` (with reason: user_not_found, invalid_password, no_workspace_access)
- `auth.caia_login` / `auth.caia_login_failed`
- `auth.extend_session`
- `api_token.created` / `api_token.revoked`
- `invite.accept_caia`

**Event data includes**:
- `workspaceId`, `actorUserId`
- `resourceType`, `resourceId`
- Request metadata (IP, user agent)
- Custom details per event type

## 8. Pre-commit Security Hooks

Pre-commit hooks are configured in `.husky/pre-commit`:

```bash
# Open source compliance checks (secrets scan + AI analysis)
comply opensource --hook --staged --exclude e2e --skip-trivy
```

**Checks performed**:
- **gitleaks**: Scans for embedded secrets (API keys, tokens, passwords)
- **AI analysis**: Analyzes changes for sensitive information patterns
- **trivy**: Vulnerability scanning (temporarily skipped due to compliance-toolkit bug)

**Important**: Never bypass hooks with `git commit --no-verify`. Fix issues instead.

## Security Quick Reference

| Area | Implementation | File:Line |
|------|----------------|-----------|
| Session timeout (inactivity) | 15 minutes | `shared/src/constants.ts:28` |
| Session timeout (absolute) | 12 hours | `shared/src/constants.ts:31` |
| Password hashing | bcrypt | `api/src/routes/auth.ts:76` |
| Session ID generation | crypto.randomBytes(32) | `api/src/routes/auth.ts:13-15` |
| API token hashing | SHA-256 | `api/src/middleware/auth.ts:20-22` |
| Cookie protection | httpOnly, secure, conditional SameSite | `api/src/config/session-cookies.ts` |
| WS connection limit | 30/min per IP | `api/src/collaboration/index.ts:19-20` |
| WS message limit | 50/sec per connection | `api/src/collaboration/index.ts:22-23` |
| Input validation | Zod schemas | All route files |
| Visibility filter | VISIBILITY_FILTER_SQL() | `api/src/middleware/visibility.ts:49-55` |
