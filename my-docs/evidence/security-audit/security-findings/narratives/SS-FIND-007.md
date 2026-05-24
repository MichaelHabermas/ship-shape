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
