**Description**

Bearer tokens authenticate as user with workspace membership. Only `superAdminMiddleware` blocks tokens. Tokens can call approval endpoints, document PATCH, team assign, etc.

**Affected code**

- `api/src/middleware/auth.ts` (~L75–117, ~L204–212)

**Note**

Likely intentional for CLI automation, but high risk if tokens are long-lived or widely distributed. Bearer auth correctly skips CSRF (browsers do not auto-attach `Authorization`). **See SS-FIND-033** — any workspace member can create tokens today, not just admins.

**Recommended fix (product)**

Scoped tokens (read-only vs write vs admin); restrict token creation to workspace admins; default short TTL.
