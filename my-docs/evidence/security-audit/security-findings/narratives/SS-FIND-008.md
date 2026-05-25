**Description**

File serve/download checks `files.workspace_id = req.workspaceId` only. No link to document visibility. Attachment on a private document is readable by any workspace member with the file UUID.

**Affected code**

- `api/src/routes/files.ts` — GET `/:id`, GET `/:id/serve` (~L287–317, ~L299–303)
- Production CDN URL construction (~L258–263) — separate infra risk if CDN is world-readable

**Discovery log**

Related to historical note in `my-docs/project-weeks-sot/week-4/discovery-research-log.md` (~file authorization theme).

**Recommended fix**

Tie files to parent documents and enforce document visibility on read/serve; or use short-lived signed URLs scoped to authorized users.
