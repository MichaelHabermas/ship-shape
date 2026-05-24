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
