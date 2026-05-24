**Description**

Collaboration upgrade validates session cookie but not `Origin`. On Render production, session cookies use `SameSite=None`, so browsers send cookies on cross-origin WebSocket upgrades. REST mutating routes require CSRF; WebSocket does not.

**Affected code**

- `api/src/collaboration/index.ts` (~L635–671) — upgrade handler
- `api/src/config/session-cookies.ts` — `SameSite=None` in production

**Attack scenario**

1. Victim logged into Ship visits `attacker.com`.
2. Attacker JS opens `wss://{api}/collaboration/{type}:{docId}`.
3. Cookie sent; upgrade succeeds; attacker reads/writes any document victim can access (amplifies SS-FIND-005 for weekly plans).

**Recommended fix**

Reject upgrade unless `Origin` matches allowed CORS origins. Optional: short-lived WS ticket from CSRF-protected HTTP endpoint.

**Verification plan**

- Probe: `websocket-origin-reject` — wrong Origin + valid cookie → 403.
