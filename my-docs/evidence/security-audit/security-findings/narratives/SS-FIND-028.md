**Description**

`POST /api/invites/:token/accept` creates sessions with `uuidv4()` (~122 bits). Login uses `crypto.randomBytes(32)` (256 bits). Inconsistent session security model.

**Affected code**

- `api/src/routes/invites.ts` (~L225–232)
- Contrast: `api/src/routes/auth.ts` — `generateSecureSessionId()`

**Recommended fix**

Use shared `generateSecureSessionId()` for all session creation paths.

**Verification plan**

- Code audit: no `uuidv4()` session IDs outside tests.
