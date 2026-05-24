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
