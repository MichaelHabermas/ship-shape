# Security Findings Ledger

> **Generated** from `security-findings.json`. Do not edit by hand. Regenerate: `pnpm security:findings:render`

## Discovery

- **Date:** 2026-05-22
- **Method:** deep_review
- **Session:** Single deep authorization review; migrated from hand-edited ledger

## Summary

| ID | Title | Severity | Status | Discovered | Last verification | Active | Primary location |
|----|-------|----------|--------|------------|-------------------|--------|------------------|
| SS-FIND-001 | — Governance approval forgery via document `properties` mass assignment | critical | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/documents.ts |
| SS-FIND-002 | — RACI self-elevation grants real approval authority | critical | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/programs.ts, documents.ts |
| SS-FIND-003 | — Week lifecycle bypass via ungoverned `status` PATCH | critical | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/weeks/sprints.ts, documents.ts |
| SS-FIND-004 | — Weekly plan IDOR via generic documents REST API | high | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/documents.ts vs weekly-plans.ts |
| SS-FIND-005 | — Weekly plan IDOR via collaboration WebSocket | high | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/collaboration/index.ts |
| SS-FIND-006 | — Collaboration audit trail attributes edits to document creator | medium | open | 2026-05-22 | — | yes | api/src/collaboration/index.ts |
| SS-FIND-007 | — Bulk issue move to private sprint/project without visibility check | medium | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/issues.ts |
| SS-FIND-008 | — File access is workspace-scoped, not document-scoped | medium | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/files.ts |
| SS-FIND-009 | — Private sub-issue metadata leaked in parent close warning | medium | open | 2026-05-22 | — | yes | api/src/routes/issues.ts |
| SS-FIND-010 | — Dashboard `my-focus` leaks private project/program metadata | medium | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/dashboard.ts |
| SS-FIND-011 | — Team grid leaks private program metadata via visible issues | medium | open | 2026-05-22 | — | yes | api/src/routes/team.ts |
| SS-FIND-012 | — Public feedback lacks dedicated anti-abuse controls | medium | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/feedback.ts |
| SS-FIND-013 | — S3 upload confirm without object verification | medium | fixed | 2026-05-22 | 2026-05-24 (manual/status_change) | no | api/src/routes/files.ts |
| SS-FIND-014 | — File extension blocklist checks last extension only | medium | fixed | 2026-05-22 | 2026-05-24 (manual/status_change) | no | api/src/routes/files.ts |
| SS-FIND-015 | — WebSocket session not re-validated after upgrade | medium | open | 2026-05-22 | — | yes | api/src/collaboration/index.ts |
| SS-FIND-016 | — API tokens inherit full user privileges | medium | fixed | 2026-05-22 | 2026-05-24 (manual/status_change) | no | api/src/middleware/auth.ts |
| SS-FIND-017 | — Session IP/User-Agent stored but never enforced | medium | open | 2026-05-22 | — | yes | session-auth.ts, auth.ts |
| SS-FIND-018 | — Setup race: first caller becomes super-admin | critical | fixed | 2026-05-22 | 2026-05-24 (manual/status_change) | no | api/src/routes/setup.ts |
| SS-FIND-019 | — CAIA `returnTo` weak validation | low | open | 2026-05-22 | — | yes | api/src/routes/caia-auth.ts |
| SS-FIND-020 | — Super-admin SSRF via CAIA issuer URL | medium | open | 2026-05-22 | — | yes | admin-credentials.ts, services/caia.ts |
| SS-FIND-021 | — Setup status reveals uninitialized instance | low | fixed | 2026-05-22 | 2026-05-24 (manual/status_change) | no | api/src/routes/setup.ts |
| SS-FIND-022 | — Accountability may expose private sprint titles | low | open | 2026-05-22 | — | yes | api/src/services/accountability.ts |
| SS-FIND-023 | — AI routes accept unvalidated bodies | low | open | 2026-05-22 | — | yes | api/src/routes/ai.ts |
| SS-FIND-024 | — Breadcrumbs may expose hidden program UUID | low | open | 2026-05-22 | — | yes | api/src/routes/associations.ts |
| SS-FIND-025 | — Pending file upload hijacking | high | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/routes/files.ts |
| SS-FIND-026 | — Cross-site WebSocket session riding (no Origin validation) | high | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | api/src/collaboration/index.ts |
| SS-FIND-027 | — Unbounded in-memory Y.Doc cache (WebSocket DoS) | high | open | 2026-05-22 | — | yes | api/src/collaboration/index.ts |
| SS-FIND-028 | — Invite accept uses weaker session IDs | medium | fixed | 2026-05-22 | 2026-05-24 (manual/status_change) | no | api/src/routes/invites.ts |
| SS-FIND-029 | — Super-admin cross-workspace access without membership | high | fixed | 2026-05-22 | 2026-05-24 (probe/pass) | no | workspaces.ts, document-access.ts |
| SS-FIND-030 | — Member can enable public feedback via ungoverned PATCH | medium | open | 2026-05-22 | — | yes | api/src/routes/documents.ts, programs.ts |
| SS-FIND-031 | — Production `SameSite=None` — cross-site cookies, CSRF-only REST defense | medium | open | 2026-05-22 | — | yes | session-cookies.ts, app.ts |
| SS-FIND-032 | — Unauthenticated invite lookup leaks metadata | medium | fixed | 2026-05-22 | 2026-05-24 (manual/status_change) | no | api/src/routes/invites.ts |
| SS-FIND-033 | — Any workspace member can mint full-privilege API tokens | medium | fixed | 2026-05-22 | 2026-05-24 (manual/status_change) | no | api/src/routes/api-tokens.ts |
| SS-FIND-034 | — Full OpenAPI schema exposed without authentication | low | open | 2026-05-22 | — | yes | api/src/swagger.ts |

## Findings

### SS-FIND-001: — Governance approval forgery via document `properties` mass assignment

| Field | Value |
|-------|-------|
| Severity | critical |
| Status | fixed |
| OWASP | A01 |
| Category | business-logic-authorization-bypass |
| Discovered | 2026-05-22 |
| Definition | Member cannot set governance approval fields via PATCH /api/documents/:id |
| Probes | authorization-governance-properties-injection, input-governance-mass-assignment |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

Dedicated approval routes (`POST /api/weeks/:id/approve-plan`, etc.) enforce supervisor checks via `checkSprintSupervisorAuth`. Generic `PATCH /api/documents/:id` accepts arbitrary `properties: z.record(z.unknown())` and merges client-supplied keys with no denylist for governance fields (`plan_approval`, `review_approval`, `review_rating`, `submitted_at`, etc.).

**Affected code**

- Schema: `api/src/routes/documents.ts` — `updateDocumentSchema` (~L201–206), `properties: z.record(z.unknown())`
- Merge: `api/src/routes/documents.ts` (~L912–929) — `{ ...currentProps, ...dataProps, ...topLevelProps }`
- Bypassed controls: `api/src/routes/weeks/approvals.ts`, `api/src/routes/projects.ts` (approve-plan flows), `api/src/utils/approval-workflow.ts`

**Attack scenario**

1. Attacker is any workspace **member** with read access to a sprint (default visibility: `workspace`).
2. Attacker sends authenticated PATCH with CSRF token:

```http
PATCH /api/documents/{sprintUuid}
X-CSRF-Token: {token}
Cookie: session_id=...

{
  "properties": {
    "plan_approval": {
      "state": "approved",
      "approved_by": "{attackerUserId}",
      "approved_at": "2026-01-01T00:00:00Z",
      "approved_version_id": null
    }
  }
}
```

3. Sprint appears approved in dashboard, team views, and accountability flows without supervisor action.

Same pattern applies to `review_approval`, `review_rating`, and `submitted_at` on weekly plans.

**Evidence**

```typescript
// api/src/routes/documents.ts ~L201-206
properties: z.record(z.unknown()).optional(),

// api/src/routes/documents.ts ~L912-920
let newProps = {
  ...currentProps,
  ...dataProps,
  ...topLevelProps,
  ...
};
```

**Why probes missed it**

No probe sends governance-field injection to `PATCH /api/documents/:id`.

**Recommended fix (deferred)**

- Denylist or strip governance keys on all document PATCH merge paths.
- Route approval state changes only through governed endpoints.

**Verification plan (when fixing)**

- New probe: member injects `plan_approval` via documents PATCH → expect 400/403.
- API test: non-supervisor cannot set `plan_approval` through generic PATCH.

### SS-FIND-002: — RACI self-elevation grants real approval authority

| Field | Value |
|-------|-------|
| Severity | critical |
| Status | fixed |
| OWASP | A01 |
| Category | privilege-escalation |
| Discovered | 2026-05-22 |
| Definition | Member cannot self-assign accountable_id to gain approval authority |
| Probes | authorization-governance-accountable-self-assign |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

Any workspace member who can **read** a program (workspace visibility) can set `accountable_id` to their own user ID. Only `reports_to` on **person** documents is admin-gated. After self-assignment, legitimate approval endpoints succeed because `checkSprintSupervisorAuth` treats `programAccountableId === userId` as authorized.

**Affected code**

- `api/src/routes/programs.ts` — `updateProgramSchema` (~L165–174), PATCH handler (~L367–370)
- `api/src/routes/documents.ts` — top-level and properties RACI fields (~L879–899)
- `api/src/utils/approval-workflow.ts` — `checkSprintSupervisorAuth` (~L112–120)

**Attack scenario**

1. `PATCH /api/programs/{programId}` with `{"accountable_id": "<self-user-id>"}` (requires program visibility only).
2. `POST /api/weeks/{sprintId}/approve-plan` — succeeds with **legitimate** audit trail showing attacker as authorized approver.

Alternate: set `accountable_id` via `PATCH /api/documents/:id` on program/project documents.

**Evidence**

```typescript
// api/src/routes/programs.ts ~L367-370
if (data.accountable_id !== undefined) {
  newProps.accountable_id = data.accountable_id;
  propsChanged = true;
}

// api/src/utils/approval-workflow.ts ~L119
if (programAccountableId === userId || ownerReportsTo === userId || isAdmin) {
  return { authorized: true };
}
```

Contrast — admin-only field on person docs:

```typescript
// api/src/routes/documents.ts ~L903-909
if (existing.document_type === 'person' && data.properties?.reports_to !== undefined) {
  const isAdmin = await isWorkspaceAdmin(userId, workspaceId);
  if (!isAdmin) { res.status(403)... }
}
```

**Recommended fix (deferred)**

Restrict RACI mutations (`accountable_id`, `owner_id`, `consulted_ids`, `informed_ids`) to workspace admins or document owners.

**Verification plan**

- Probe: member sets `accountable_id` to self → 403.
- Probe: after fix, supervisor-only approve-plan still works for real accountable person.

### SS-FIND-003: — Week lifecycle bypass via ungoverned `status` PATCH

| Field | Value |
|-------|-------|
| Severity | critical |
| Status | fixed |
| OWASP | A01 |
| Category | workflow-/-governance-bypass |
| Discovered | 2026-05-22 |
| Definition | Member cannot PATCH sprint/week status to completed without authorization |
| Probes | authorization-governance-week-status-bypass |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

`POST /api/weeks/:id/start` uses `requireWeekLifecycleAuthority`. Generic `PATCH /api/weeks/:id` applies `status` directly with no lifecycle check. Same bypass exists via `PATCH /api/documents/:id` top-level `status` field.

**Affected code**

- Ungoverned: `api/src/routes/weeks/sprints.ts` (~L736–758) — `if (data.status !== undefined) { newProps.status = data.status; }`
- Governed contrast: `api/src/routes/weeks/sprints.ts` (~L834–836) — `requireWeekLifecycleAuthority` on start
- Alternate vector: `api/src/routes/documents.ts` (~L890) — `if (data.status !== undefined) topLevelProps.status = data.status`

**Attack scenario**

Any member with sprint visibility:

```http
PATCH /api/weeks/{sprintUuid}
{"status": "completed"}
```

Forces week to completed without supervisor/owner approval path.

**Evidence**

```typescript
// weeks/sprints.ts ~L736-739
if (data.status !== undefined) {
  newProps.status = data.status;
  propsChanged = true;
}
```

**Recommended fix (deferred)**

Remove `status` from generic PATCH schemas; require lifecycle endpoints with `requireWeekLifecycleAuthority`.

**Verification plan**

- Probe: member PATCH week status → 403.
- Member POST `/start` still works when authorized.


## High

### SS-FIND-004: — Weekly plan IDOR via generic documents REST API

| Field | Value |
|-------|-------|
| Severity | high |
| Status | fixed |
| OWASP | A01 |
| Category | accountability-integrity |
| Discovered | 2026-05-22 |
| Definition | Member cannot read peer weekly plan via generic documents API |
| Probes | authorization-weekly-plan-idor-documents |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

`/api/weekly-plans` list and get enforce **self-or-admin** person ownership. Weekly plans are created with `visibility: 'workspace'`. Generic `/api/documents` uses workspace visibility only — any member can list, read, and PATCH any colleague's weekly plan.

**Affected code**

- Correct enforcement: `api/src/routes/weekly-plans.ts` (~L429, L567) — `((p.properties->>'user_id')::uuid = $2 OR $3 = TRUE)`
- Creation visibility: `api/src/routes/weekly-plans.ts` (~L348–349) — `'workspace'`
- Weak enforcement: `api/src/routes/documents.ts` — `canAccessDocument` (~L163–171), list (~L241–257), GET/PATCH `/:id` (~L371+, ~L757+)

**Attack scenario**

1. `GET /api/documents?type=weekly_plan` → enumerate all plan UUIDs and content.
2. `PATCH /api/documents/{victimPlanId}` → overwrite content or inject `submitted_at` via properties (see SS-FIND-001).
3. Supervisor reviews plan believing it belongs to assignee.

**Evidence**

```typescript
// weekly-plans.ts ~L348-349 — created workspace-visible
VALUES (..., 'workspace', ...)

// documents.ts ~L169-171 — no person ownership
(d.visibility = 'workspace' OR d.created_by = $2 OR admin) as can_access
```

**Recommended fix (deferred)**

Enforce `requireSelfOrAdminPerson` on all weekly_plan/weekly_retro paths (REST list, get, patch, patch/content) **or** default visibility to `private`.

**Verification plan**

- Probe: member GET `/api/documents/{otherPersonWeeklyPlanId}` → 404.
- Probe: member PATCH same → 403/404.

### SS-FIND-005: — Weekly plan IDOR via collaboration WebSocket

| Field | Value |
|-------|-------|
| Severity | high |
| Status | fixed |
| OWASP | A01 |
| Category | real-time-editing-bypass |
| Discovered | 2026-05-22 |
| Definition | Member cannot open peer weekly plan collaboration WebSocket room |
| Probes | authorization-weekly-plan-idor-websocket |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

WebSocket upgrade uses `canAccessDocumentForCollab` with the same workspace-visibility model as generic documents — no person-ownership check.

**Affected code**

- `api/src/collaboration/index.ts` — `canAccessDocumentForCollab` (~L361–384)
- Upgrade flow (~L635–651)

**Attack scenario**

1. Obtain victim weekly plan UUID (via SS-FIND-004 enumeration).
2. Connect to `/collaboration/weekly_plan:{id}` with valid session cookie.
3. Push Yjs updates; server persists via `persistDocument`.

**Evidence**

```typescript
// collaboration/index.ts ~L369-370
(d.visibility = 'workspace' OR d.created_by = $2 OR admin) as can_access
```

**Recommended fix (deferred)**

Mirror `requireSelfOrAdminPerson` at WS upgrade for `weekly_plan` and `weekly_retro` document types.

**Verification plan**

- Probe: member WS connect to another member's weekly plan → 403 at upgrade.


## Medium

### SS-FIND-006: — Collaboration audit trail attributes edits to document creator

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | A09 |
| Category | non-repudiation-/-forensics |
| Discovered | 2026-05-22 |
| Definition | Collaboration audit trail attributes edits to document creator |

**Description**

When logging weekly plan/retro content changes to `document_history`, `changed_by` is set to the document's `created_by`, not the authenticated WebSocket user's `conn.userId`.

**Affected code**

- `api/src/collaboration/index.ts` (~L146–161)

**Attack scenario**

Attacker edits victim's weekly plan via WebSocket (SS-FIND-005). History shows victim as `changed_by`.

**Evidence**

```typescript
// collaboration/index.ts ~L157-160
INSERT INTO document_history (..., changed_by) VALUES (..., $4)
// $4 = createdBy from DB, not conn.userId
```

**Recommended fix**

Use `conn.userId` for `changed_by`.

### SS-FIND-007: — Bulk issue move to private sprint/project without visibility check

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A01 |
| Category | association-/-scope-manipulation |
| Discovered | 2026-05-22 |
| Definition | Bulk issue move to private sprint/project without visibility check |
| Probes | authorization-bulk-issue-foreign-target |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

Single-issue PATCH validates references with `requireReferenceableDocument` (visibility-aware). Bulk `POST /api/issues/bulk` with `action: "update"` checks sprint/project existence by workspace + type only — no `VISIBILITY_FILTER_SQL`.

**Affected code**

- Bulk (weak): `api/src/routes/issues.ts` (~L1116–1145)
- Single (strong): `api/src/routes/issues.ts` (~L829–834) — `requireReferenceableDocument`

**Attack scenario**

User moves issues they can edit to a **private** sprint UUID they cannot read. Issues become linked to hidden targets; metadata may leak through joins elsewhere.

**Evidence**

```sql
-- issues.ts ~L1135-1138 — no visibility predicate
SELECT id FROM documents
WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
  AND deleted_at IS NULL
```

**Recommended fix**

Reuse `requireReferenceableDocument` in bulk update path.

### SS-FIND-008: — File access is workspace-scoped, not document-scoped

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A01 |
| Category | attachment-confidentiality |
| Discovered | 2026-05-22 |
| Definition | File serve must respect parent document visibility (probe currently checks uploader-only; document scope still open) |
| Probes | authorization-file-document-scope |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

File serve/download checks `files.workspace_id = req.workspaceId` only. No link to document visibility. Attachment on a private document is readable by any workspace member with the file UUID.

**Affected code**

- `api/src/routes/files.ts` — GET `/:id`, GET `/:id/serve` (~L287–317, ~L299–303)
- Production CDN URL construction (~L258–263) — separate infra risk if CDN is world-readable

**Discovery log**

Related to historical note in `my-docs/discovery-research-log.md` (~file authorization theme).

**Recommended fix**

Tie files to parent documents and enforce document visibility on read/serve; or use short-lived signed URLs scoped to authorized users.

### SS-FIND-009: — Private sub-issue metadata leaked in parent close warning

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | A01 |
| Category | information-disclosure |
| Discovered | 2026-05-22 |
| Definition | Private sub-issue metadata leaked in parent close warning |

**Description**

When closing a parent issue with incomplete children, the 409 response lists all child issues without visibility filtering.

**Affected code**

- `api/src/routes/issues.ts` (~L619–644)

**Attack scenario**

Attacker creates private sub-issues under a workspace-visible parent they can edit. Victim attempts to close parent → 409 exposes private children `id`, `title`, `ticket_number`, `state`.

**Evidence**

```sql
-- issues.ts ~L619-627 — no VISIBILITY_FILTER_SQL on children
SELECT d.id, d.title, d.ticket_number, d.properties->>'state' as state
FROM documents d
JOIN document_associations da ON ...
WHERE da.related_id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'
```

**Recommended fix**

Filter children query with visibility predicate; or return counts only without titles.

### SS-FIND-010: — Dashboard `my-focus` leaks private project/program metadata

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A01 |
| Category | metadata-leak-(policy-dependent) |
| Discovered | 2026-05-22 |
| Definition | Dashboard `my-focus` leaks private project/program metadata |
| Probes | authorization-dashboard-private-metadata |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

`GET /api/dashboard/my-focus` returns project/program titles for allocations without `VISIBILITY_FILTER_SQL` on joined program/project rows. Recent activity issues similarly omit issue visibility filter.

**Affected code**

- `api/src/routes/dashboard.ts` (~L469–533)

**Policy question**

Is sprint `assignee_ids` allocation equivalent to read grant on private project/program? Current code behaves as yes for metadata.

**Recommended fix**

Apply visibility predicates on joined documents or document explicit allocation-read policy.

### SS-FIND-011: — Team grid leaks private program metadata via visible issues

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | A01 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Team grid leaks private program metadata via visible issues |

**Description**

`GET /api/team/grid` filters issue visibility but LEFT JOINs program without visibility filter — exposes `program_name`, emoji, color for private programs linked to visible issues.

**Affected code**

- `api/src/routes/team.ts` (~L161–171)

**Recommended fix**

Add `VISIBILITY_FILTER_SQL` on program join alias.

### SS-FIND-012: — Public feedback lacks dedicated anti-abuse controls

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A04 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Public feedback endpoint enforces dedicated rate limiting |
| Probes | abuse-public-feedback-rate-limit, abuse-login-rate-limit |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

`POST /api/feedback` is unauthenticated, no CSRF, creates real triage issues when program has `public_feedback_enabled`. Only general API rate limit (100 req/min prod).

**Affected code**

- `api/src/routes/feedback.ts` — `publicFeedbackRouter.post('/')` (~L66+)
- `api/src/app.ts` — mounted before auth (~L208); general `apiLimiter` (~L112–119)

**Attack scenario**

Mass-create triage issues; pollute ticket numbers; DoS triage workflows on enabled programs.

**Recommended fix**

Dedicated rate limit, CAPTCHA, or honeypot; per-program throttle.

### SS-FIND-013: — S3 upload confirm without object verification

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A08 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | S3 upload confirm without object verification |
| Last verification | 2026-05-24T19:32:06.347Z — manual status_change (stillActive: false) |

**Description**

`POST /api/files/:id/confirm` marks file `uploaded` without S3 `HeadObject` / size verification in production.

**Affected code**

- `api/src/routes/files.ts` (~L253–272) — comment acknowledges gap

**Impact**

Authenticated user can confirm pending upload record without bytes in S3 — broken links, integrity issue (not cross-tenant).

**Recommended fix**

Verify object exists and size matches before status transition.

### SS-FIND-014: — File extension blocklist checks last extension only

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A04 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | File extension blocklist checks last extension only |
| Last verification | 2026-05-24T19:31:59.960Z — manual status_change (stillActive: false) |

**Description**

`isAllowedFile` uses `filename.lastIndexOf('.')` — `malware.exe.txt` passes as `.txt`.

**Affected code**

- `api/src/routes/files.ts` (~L82–85)

**Mitigation in place**

Served as `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`.

**Recommended fix**

Scan all extensions or content-sniff; reject multi-extension executables.

### SS-FIND-015: — WebSocket session not re-validated after upgrade

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | A07 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | WebSocket session not re-validated after upgrade |

**Description**

Session validated once at HTTP upgrade. Expired session, revoked membership, or deleted session does not disconnect active WebSocket until client drops.

**Affected code**

- Upgrade: `api/src/collaboration/index.ts` (~L635–641, ~L603–608 for `/events`)
- Message handlers (~L711–738) — no re-validation

**Recommended fix**

Periodic session re-check on persist or ping; disconnect on failure.

### SS-FIND-016: — API tokens inherit full user privileges

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A07 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | API tokens inherit full user privileges (no route scoping) |
| Last verification | 2026-05-24T19:31:31.607Z — manual status_change (stillActive: false) |

**Description**

Bearer tokens authenticate as user with workspace membership. Only `superAdminMiddleware` blocks tokens. Tokens can call approval endpoints, document PATCH, team assign, etc.

**Affected code**

- `api/src/middleware/auth.ts` (~L75–117, ~L204–212)

**Note**

Likely intentional for CLI automation, but high risk if tokens are long-lived or widely distributed. Bearer auth correctly skips CSRF (browsers do not auto-attach `Authorization`). **See SS-FIND-033** — any workspace member can create tokens today, not just admins.

**Recommended fix (product)**

Scoped tokens (read-only vs write vs admin); restrict token creation to workspace admins; default short TTL.

### SS-FIND-017: — Session IP/User-Agent stored but never enforced

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | A07 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Session IP/User-Agent stored but never enforced |

**Description**

Login stores `user_agent` and `ip_address` on session row for audit. `validateAuthenticatedSession` never compares current request to stored values.

**Affected code**

- Stored: `api/src/routes/auth.ts` (~L151–163)
- Not checked: `api/src/services/session-auth.ts` (~L36–100)

**Impact**

Stolen `session_id` cookie works from any client/IP until timeout.


## Low / conditional

### SS-FIND-018: — Setup race: first caller becomes super-admin

| Field | Value |
|-------|-------|
| Severity | critical |
| Status | fixed |
| OWASP | A04 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Setup race — first caller becomes super-admin if API exposed pre-bootstrap |
| Last verification | 2026-05-24T19:31:18.646Z — manual status_change (stillActive: false) |

**Description**

`POST /api/setup/initialize` is unauthenticated (CSRF only). Advisory lock prevents concurrent double-init, not attacker-vs-admin race on fresh deploy.

**Affected code**

- `api/src/routes/setup.ts` (~L53–104)
- `api/src/app.ts` (~L205)

**Exploitability**

High only when API is internet-reachable before legitimate bootstrap.

**Recommended fix**

Firewall setup routes until complete; or require one-time setup token.

### SS-FIND-019: — CAIA `returnTo` weak validation

| Field | Value |
|-------|-------|
| Severity | low |
| Status | open |
| OWASP | A01 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | CAIA `returnTo` validation may allow open-redirect variants |

**Description**

`isValidReturnTo` allows paths starting with `/` and rejects `//` only. May not block backslash or encoding tricks (`/\evil.com`, `/%5C...`).

**Affected code**

- `api/src/routes/caia-auth.ts` (~L46–48)

**Exploitability**

Requires victim to complete OAuth on attacker-crafted callback URL; state/code are one-time.

**Recommended fix**

Allowlist paths; reject `\`, encoded slashes; or store redirect in session.

### SS-FIND-020: — Super-admin SSRF via CAIA issuer URL

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | A10 |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Super-admin SSRF via CAIA `issuer_url` on credentials save |

**Description**

Super-admin can set CAIA `issuer_url` to internal/metadata endpoints. Discovery validation performs outbound fetch.

**Affected code**

- `api/src/routes/admin-credentials.ts`
- `api/src/services/caia.ts` — `client.discovery(new URL(issuer_url))`

**Exploitability**

Requires compromised super-admin session.

**Recommended fix**

HTTPS only; block RFC1918/link-local/metadata IPs on save.

### SS-FIND-021: — Setup status reveals uninitialized instance

| Field | Value |
|-------|-------|
| Severity | low |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Setup status endpoint reveals uninitialized instance |
| Last verification | 2026-05-24T19:31:24.925Z — manual status_change (stillActive: false) |

**Description**

`GET /api/setup/status` returns `needsSetup: true` when zero users — deployment recon.

**Affected code**

- `api/src/routes/setup.ts` (~L16–38)

### SS-FIND-022: — Accountability may expose private sprint titles

| Field | Value |
|-------|-------|
| Severity | low |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Accountability action-items may expose private sprint titles |

**Description**

`GET /api/accountability/action-items` may return sprint `targetTitle` for sprints user participates in via assigned issues without sprint visibility check.

**Affected code**

- `api/src/services/accountability.ts` (~L210–221, ~L300–309, ~L506–527)

**Note**

Needs runtime confirmation with private sprint + visible issue fixture.

### SS-FIND-023: — AI routes accept unvalidated bodies

| Field | Value |
|-------|-------|
| Severity | low |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | AI analyze routes accept unvalidated request bodies |

**Description**

`/api/ai/analyze-plan` and `/analyze-retro` read raw `req.body.content` without Zod. Bounded downstream by `MAX_CONTENT_TEXT_LENGTH` (50KB) in `ai-analysis.ts`.

**Affected code**

- `api/src/routes/ai.ts` (~L30–77)

### SS-FIND-024: — Breadcrumbs may expose hidden program UUID

| Field | Value |
|-------|-------|
| Severity | low |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Document context breadcrumbs may expose hidden program UUID |

**Description**

Association context may include program UUID in breadcrumbs with redacted title (`Unknown Program`).

**Affected code**

- `api/src/routes/associations.ts` (~L366–375)

### SS-FIND-025: — Pending file upload hijacking

| Field | Value |
|-------|-------|
| Severity | high |
| Status | fixed |
| OWASP | A01 |
| Category | idor-on-file-completion |
| Discovered | 2026-05-22 |
| Definition | Member cannot complete another user pending upload |
| Probes | authorization-file-upload-hijack-denied |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

**Description**

`POST /api/files/:id/local-upload` and `POST /api/files/:id/confirm` authorize by `workspace_id` only. Any workspace member who learns a pending `fileId` can upload bytes or confirm another user's pending attachment. Delete correctly checks `uploaded_by`; complete paths do not.

**Affected code**

- `api/src/routes/files.ts` (~L162–166) — `local-upload` and `confirm` queries

**Attack scenario**

1. User A starts upload → receives `fileId`.
2. User B (same workspace) calls `local-upload` or `confirm` with that UUID.
3. User A's attachment slot contains attacker-controlled or falsely confirmed content.

**Recommended fix**

Require `uploaded_by = req.userId` (or admin) on all completion paths. Pair with SS-FIND-013 (`HeadObject` + size match on S3 confirm).

**Verification plan**

- API test: member B cannot complete member A's pending file → 403.
- Probe: `file-upload-hijack-denied`.

### SS-FIND-026: — Cross-site WebSocket session riding (no Origin validation)

| Field | Value |
|-------|-------|
| Severity | high |
| Status | fixed |
| OWASP | A07 |
| Category | csrf-equivalent-on-websocket |
| Discovered | 2026-05-22 |
| Definition | Cross-origin WebSocket upgrade is rejected |
| Probes | authorization-websocket-origin-reject |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

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

### SS-FIND-027: — Unbounded in-memory Y.Doc cache (WebSocket DoS)

| Field | Value |
|-------|-------|
| Severity | high |
| Status | open |
| OWASP | A05 |
| Category | resource-exhaustion |
| Discovered | 2026-05-22 |
| Definition | Unbounded in-memory Y.Doc cache — WS connection abuse / DoS |

**Description**

Each collaboration room loads a full `Y.Doc` into process memory (`docs` Map). Per-IP connection rate limits exist (30/min) but there is no cap on total cached documents, concurrent connections per user, or distinct rooms per workspace.

**Affected code**

- `api/src/collaboration/index.ts` — `docs` Map, `getOrCreateDoc`, cleanup (~L100–263, ~L757–776)

**Attack scenario**

Authenticated attacker opens WebSockets to many distinct document rooms (UUIDs from list APIs). Memory and CPU pressure from loaded Yjs state + debounced `persistDocument` writes.

**Recommended fix**

Global LRU cap on cached `Y.Doc` instances; per-user concurrent connection limit; per-workspace WS budget.

**Verification plan**

- Load test with connection budget; assert 429 or graceful eviction under threshold.

### SS-FIND-028: — Invite accept uses weaker session IDs

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A02 |
| Category | session-identifier-inconsistency |
| Discovered | 2026-05-22 |
| Definition | Invite accept creates sessions with `uuidv4()` not secure session IDs |
| Last verification | 2026-05-24T19:31:45.130Z — manual status_change (stillActive: false) |

**Description**

`POST /api/invites/:token/accept` creates sessions with `uuidv4()` (~122 bits). Login uses `crypto.randomBytes(32)` (256 bits). Inconsistent session security model.

**Affected code**

- `api/src/routes/invites.ts` (~L225–232)
- Contrast: `api/src/routes/auth.ts` — `generateSecureSessionId()`

**Recommended fix**

Use shared `generateSecureSessionId()` for all session creation paths.

**Verification plan**

- Code audit: no `uuidv4()` session IDs outside tests.

### SS-FIND-029: — Super-admin cross-workspace access without membership

| Field | Value |
|-------|-------|
| Severity | high |
| Status | fixed |
| OWASP | A01 |
| Category | break-glass-/-insider-threat |
| Discovered | 2026-05-22 |
| Definition | Super-admin cross-workspace access without membership / blanket admin |
| Probes | auth-session-member-audit-logs-denied, auth-session-member-impersonation-denied |
| Last verification | 2026-05-24T19:36:39.376Z — probe pass (stillActive: false) |

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

### SS-FIND-030: — Member can enable public feedback via ungoverned PATCH

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | A01 |
| Category | governance-property-injection-(feeds-ss-find-012) |
| Discovered | 2026-05-22 |
| Definition | Member can enable `public_feedback_enabled` via ungoverned PATCH |

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

### SS-FIND-031: — Production `SameSite=None` — cross-site cookies, CSRF-only REST defense

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | A05 |
| Category | defense-in-depth-/-architectural |
| Discovered | 2026-05-22 |
| Definition | Production `SameSite=None` — cross-site cookies; CSRF-only REST defense |

**Description**

On Render production, session cookies use `SameSite=None` (required for cross-origin frontend). Browsers send session cookies on cross-site requests. All mutating REST routes depend on CSRF middleware being present and correct; any future route mounted without `conditionalCsrf` is immediately cross-site exploitable. **SS-FIND-026** covers the WebSocket variant; this entry covers REST.

**Affected code**

- `api/src/config/session-cookies.ts` — `sessionSameSitePolicy()` returns `'none'` in production
- `api/src/app.ts` — `conditionalCsrf` on mutating routes

**Recommended fix**

Same-origin API where possible; CI test that fails if a mutating route lacks CSRF; optional `Origin`/`Referer` validation as second layer.

### SS-FIND-032: — Unauthenticated invite lookup leaks metadata

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A01 |
| Category | information-disclosure |
| Discovered | 2026-05-22 |
| Definition | Unauthenticated invite lookup leaks email and workspace metadata |
| Last verification | 2026-05-24T19:31:53.469Z — manual status_change (stillActive: false) |

**Description**

`GET /api/invites/:token` is unauthenticated. Anyone with the invite token receives invitee email, workspace name, role, and inviter display name.

**Affected code**

- `api/src/routes/invites.ts` (~L13–102)

**Attack scenario**

Leaked or guessed invite URL/token exposes PII (email) and org structure. Needed for UX on accept flow but no rate limit or minimal response option documented.

**Recommended fix**

Rate limit; return minimal fields until accept step; short token TTL; consider signed one-time preview tokens.

### SS-FIND-033: — Any workspace member can mint full-privilege API tokens

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | A01 |
| Category | credential-issuance |
| Discovered | 2026-05-22 |
| Definition | Any workspace member can mint full-privilege API tokens |
| Last verification | 2026-05-24T19:31:38.634Z — manual status_change (stillActive: false) |

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

### SS-FIND-034: — Full OpenAPI schema exposed without authentication

| Field | Value |
|-------|-------|
| Severity | low |
| Status | open |
| OWASP | A05 |
| Category | reconnaissance |
| Discovered | 2026-05-22 |
| Definition | Full OpenAPI schema exposed without authentication |

**Description**

`GET /api/openapi.json` and Swagger UI document the full API surface without auth — aids attackers mapping approval bypass and IDOR paths.

**Affected code**

- `api/src/swagger.ts` / `setupSwagger` in app bootstrap

**Recommended fix**

Accept for dev; gate or redact sensitive paths in production if threat model requires; never rely on obscurity for authorization.


## Remediation plan (draft — not started)

Phased approach for when fixes begin. **Do not implement until explicitly approved.**

### Phase 1 — Governance integrity (Critical)

| Finding | Action |
| --- | --- |
| SS-FIND-001 | Property denylist on document PATCH; block governance keys |
| SS-FIND-002 | Admin-gate RACI field mutations |
| SS-FIND-003 | Remove ungoverned `status` from generic PATCH; lifecycle-only |

**Exit criteria:** New probes for approval injection, accountable_id self-assign, status bypass — all pass.

### Phase 2 — Accountability documents & WebSocket auth (High)

| Finding | Action |
| --- | --- |
| SS-FIND-004, SS-FIND-005 | Person ownership on weekly_plan/weekly_retro (REST + WS) |
| SS-FIND-006 | Fix `changed_by` in collaboration history |
| SS-FIND-025 | Require `uploaded_by` on file complete paths |
| SS-FIND-026 | Validate `Origin` on WS upgrade |
| SS-FIND-027 | Cap in-memory Y.Doc cache and per-user WS connections |

**Exit criteria:** Member cannot read/write peer weekly plan via documents API or WS; cross-origin WS rejected; file hijack denied.

### Phase 3 — Data exposure hardening (Medium)

| Finding | Action |
| --- | --- |
| SS-FIND-007 | Bulk issue visibility on association targets |
| SS-FIND-008 | Document-linked file authorization |
| SS-FIND-009 | Filter incomplete-children query |
| SS-FIND-010, SS-FIND-011 | Visibility on dashboard/team joins |

### Phase 4 — Abuse surfaces & defense in depth

| Finding | Action |
| --- | --- |
| SS-FIND-012 | Public feedback rate limit / CAPTCHA |
| SS-FIND-013, SS-FIND-014 | S3 confirm + extension hardening |
| SS-FIND-015, SS-FIND-017, SS-FIND-028 | WS session re-validation; session binding; uniform secure session IDs |
| SS-FIND-016, SS-FIND-033 | Token scoping + admin-only token minting |
| SS-FIND-018–024, SS-FIND-029–034 | Deploy-hardening, break-glass, recon, and lower-priority items |

### Probe extensions needed

When fixing, add probes under `scripts/security-probe/probes/`. Phase 1–2 probes are implemented in **`probes/authorization.mjs`** (see `probe-finding-registry.json`). Extend registry + probes when additional SS-FIND rows are remediated.

1. `governance-properties-injection` — member PATCH sprint with `plan_approval`
2. `governance-accountable-self-assign` — member sets own `accountable_id`
3. `governance-week-status-bypass` — member PATCH week to `completed`
4. `weekly-plan-idor-documents` — member reads peer plan via `/api/documents/:id`
5. `weekly-plan-idor-websocket` — member WS to peer plan room
6. `websocket-origin-reject` — cross-origin upgrade with valid cookie → 403
7. `file-upload-hijack-denied` — member B cannot complete member A pending upload


## Verified fixes (for comparison)

These were found and **fixed** during Category 8 probe work. Documented in `my-docs/Cat-8-Sec-Audit-and-Tool-plan.md`:

| Issue | Before run | After run | Fix location |
| --- | --- | --- | --- |
| Local upload size mismatch | `before-file-size` | `after-file-size` | `api/src/routes/files.ts` |
| Unsafe file serve headers | `before-file-headers` | `after-file-headers-2` | `api/src/routes/files.ts` |
| WS malformed frame crash | `before-ws-malformed` | `after-ws-malformed` | `api/src/collaboration/index.ts` |
| WS oversized frame | — | `after-ws-oversized` | `api/src/collaboration/index.ts` |
| Verbose JSON parse errors | — | `after-verbose-errors` | `api/src/app.ts` |

Open findings in this ledger are **separate** from Cat 8 closeout — discovered by deeper authorization review after probes passed.


## Changelog

| Date | Change |
| --- | --- |
| 2026-05-22 | Ledger opened: SS-FIND-001…024 from deep OWASP / authorization review (probes already green at `cat8-final`) |
| 2026-05-22 | Same session: SS-FIND-025…034 added; related-finding clusters; removed mistaken duplicate `findings-ledger.md`; timeline metadata corrected (single session, not a second day) |

---

*Generated at 2026-05-24T19:36:39.617Z from security-findings.json*
