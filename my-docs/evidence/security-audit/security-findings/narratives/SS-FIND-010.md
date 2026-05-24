**Description**

`GET /api/dashboard/my-focus` returns project/program titles for allocations without `VISIBILITY_FILTER_SQL` on joined program/project rows. Recent activity issues similarly omit issue visibility filter.

**Affected code**

- `api/src/routes/dashboard.ts` (~L469–533)

**Policy question**

Is sprint `assignee_ids` allocation equivalent to read grant on private project/program? Current code behaves as yes for metadata.

**Recommended fix**

Apply visibility predicates on joined documents or document explicit allocation-read policy.
