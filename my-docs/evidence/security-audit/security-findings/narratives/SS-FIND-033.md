**Description**

`POST /api/api-tokens` requires only `authMiddleware` — any workspace member can create a bearer token with full user privileges for that workspace. **SS-FIND-016** covers token scope once minted; this finding covers who can mint.

**Affected code**

- `api/src/routes/api-tokens.ts` (~L32+) — no `adminMiddleware` or role check

**Attack scenario**

Low-privilege member creates token, exfiltrates it, uses it for approval PATCH / document writes / team changes without CSRF (Bearer bypass).

**Recommended fix**

Restrict token creation to workspace admins; optional re-auth; audit log on create/revoke.

**Related**

SS-FIND-016 (privilege of token once created).
