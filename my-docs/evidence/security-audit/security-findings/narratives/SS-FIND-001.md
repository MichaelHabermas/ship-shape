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
