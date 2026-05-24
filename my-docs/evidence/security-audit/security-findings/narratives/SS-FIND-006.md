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
