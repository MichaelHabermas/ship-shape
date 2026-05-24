**Description**

`POST /api/files/:id/confirm` marks file `uploaded` without S3 `HeadObject` / size verification in production.

**Affected code**

- `api/src/routes/files.ts` (~L253–272) — comment acknowledges gap

**Impact**

Authenticated user can confirm pending upload record without bytes in S3 — broken links, integrity issue (not cross-tenant).

**Recommended fix**

Verify object exists and size matches before status transition.
