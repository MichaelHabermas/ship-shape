**Description**

When closing a parent issue with incomplete children, the 409 response lists all child issues without visibility filtering.

**Affected code**

- `api/src/routes/issues.ts` (~L619–644)

**Attack scenario**

Attacker creates private sub-issues under a workspace-visible parent they can edit. Victim attempts to close parent → 409 exposes private children `id`, `title`, `ticket_number`, `state`.

**Evidence**

```sql
-- issues.ts ~L619-627 — no VISIBILITY_FILTER_SQL on children
SELECT d.id, d.title, d.ticket_number, d.properties->>'state' as state
FROM documents d
JOIN document_associations da ON ...
WHERE da.related_id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'
```

**Recommended fix**

Filter children query with visibility predicate; or return counts only without titles.
