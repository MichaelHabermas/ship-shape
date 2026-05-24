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
