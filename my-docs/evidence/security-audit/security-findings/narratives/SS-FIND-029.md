**Description**

Super-admins can switch into any workspace without membership and are treated as workspace admin for all document access checks.

**Affected code**

- `api/src/routes/workspaces.ts` (~L409) — `POST /api/workspaces/:id/switch` allows super-admin without membership row
- `api/src/services/document-access.ts` (~L46–48) — `getDocumentAccessContext` returns `isAdmin: true` for all super-admins

**Attack scenario**

Compromised super-admin session (phishing, stolen cookie, insider) switches into any tenant workspace and reads/writes private documents, manages members, approves accountability items — with no membership audit trail tying them to that workspace.

**Recommended fix**

Break-glass model: step-up auth for cross-workspace switch, explicit impersonation logging, optional requirement for time-limited grant; do not blanket `isAdmin: true` on all document paths.

**Verification plan**

- API test: super-admin without membership can switch — document intended behavior after fix (403 or audited impersonation only).
