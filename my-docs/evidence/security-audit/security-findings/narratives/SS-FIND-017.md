**Description**

Login stores `user_agent` and `ip_address` on session row for audit. `validateAuthenticatedSession` never compares current request to stored values.

**Affected code**

- Stored: `api/src/routes/auth.ts` (~L151–163)
- Not checked: `api/src/services/session-auth.ts` (~L36–100)

**Impact**

Stolen `session_id` cookie works from any client/IP until timeout.


## Low / conditional
