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
