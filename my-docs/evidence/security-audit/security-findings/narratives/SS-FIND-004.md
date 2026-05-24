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
