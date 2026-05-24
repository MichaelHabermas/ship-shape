**Description**

`public_feedback_enabled` is stored on program `properties` and gates unauthenticated `POST /api/feedback`. Generic document/program PATCH accepts arbitrary `properties` with no admin gate on this flag (same class as SS-FIND-001).

**Affected code**

- `api/src/routes/feedback.ts` (~L97) — checks `properties->>'public_feedback_enabled' = 'true'`
- `api/src/routes/documents.ts` / `programs.ts` — property merge without denylist

**Attack scenario**

1. Workspace member PATCHes program with `{"properties": {"public_feedback_enabled": true}}`.
2. Attacker (or same user) floods `POST /api/feedback` (SS-FIND-012) to create triage issues.

**Recommended fix**

Admin-only toggle for `public_feedback_enabled`; include in governance property denylist (SS-FIND-001 fix).
