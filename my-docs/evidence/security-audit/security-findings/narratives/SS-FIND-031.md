**Description**

On Render production, session cookies use `SameSite=None` (required for cross-origin frontend). Browsers send session cookies on cross-site requests. All mutating REST routes depend on CSRF middleware being present and correct; any future route mounted without `conditionalCsrf` is immediately cross-site exploitable. **SS-FIND-026** covers the WebSocket variant; this entry covers REST.

**Affected code**

- `api/src/config/session-cookies.ts` — `sessionSameSitePolicy()` returns `'none'` in production
- `api/src/app.ts` — `conditionalCsrf` on mutating routes

**Recommended fix**

Same-origin API where possible; CI test that fails if a mutating route lacks CSRF; optional `Origin`/`Referer` validation as second layer.
