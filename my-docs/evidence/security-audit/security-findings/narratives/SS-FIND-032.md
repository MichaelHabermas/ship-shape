**Description**

`GET /api/invites/:token` is unauthenticated. Anyone with the invite token receives invitee email, workspace name, role, and inviter display name.

**Affected code**

- `api/src/routes/invites.ts` (~L13–102)

**Attack scenario**

Leaked or guessed invite URL/token exposes PII (email) and org structure. Needed for UX on accept flow but no rate limit or minimal response option documented.

**Recommended fix**

Rate limit; return minimal fields until accept step; short token TTL; consider signed one-time preview tokens.
