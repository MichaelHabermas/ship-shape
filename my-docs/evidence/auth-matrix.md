# Authorization matrix (Slice 1.1)

**Date:** 2026-05-24 (OWASP hardening pass: 2026-05-29)  
**Purpose:** Inventory every production auth gate before Epic 1 code changes.  
**Canonical checklist:** `my-docs/CODE_QUALITY_REMEDIATION_PLAN.md` (Wave 1, Epic 1).  
**Agent context:** `docs/context-manifest.md` (`security` profile) → this file + `docs/claude-reference/security.md`.

**Note:** Route LOC in the D077 table below are pre–Wave 2 splits; handlers may now live in `api/src/services/*` with thinner route files.

---

## Summary counts

| Pattern | Production count | Gap |
|---------|------------------|-----|
| `authorize(` call sites | **Growing** (documents reads, commands, comments, programs/projects writes) | List/aggregation routes still use `VISIBILITY_FILTER_SQL` |
| `requireCapability` callers | **removed (Slice 1.2)** | Deleted per D080 |
| `canAccessDocument` (local duplicates) | **1** (collaboration wrapper only) | `comments.ts` migrated to `requireDocumentCapability` (2026-05-29) |
| `workspaceAccessMiddleware` | **removed** | Was dead code |
| `Principal.kind === 'setup'` | **0 constructors** | `setup.ts` uses env token, not capability layer |
| Mutation entrypoints without token scope | **Reduced** | Programs/projects writes use `require*Write`; document mutations use `authorizeDocumentMutation` |

### OWASP hardening (2026-05-29)

- **Governance mass assignment:** `submitted_at` added to `GOVERNANCE_PROPERTY_KEYS`; generic PATCH/create rejects all governance keys for every principal (including workspace admins). Tests: `documents-governance-patch.test.ts`, probe `input-governance-mass-assignment`.
- **Programs/projects:** `requireProgramWrite` / `requireProjectWrite` + `requireDocumentCreate` on mutating routes; token scope tests in `programs-projects-token-scope.test.ts`.
- **Comments / undo-conversion:** `comments.ts` uses `authorize` read; `undo-conversion` uses write + `creator_or_admin` with converter fallback.

---

## Production `authorize()` call sites

| # | File | Line | Resource | Action | Notes |
|---|------|------|----------|--------|-------|
| 1–6 | `api/src/routes/files.ts` | 121, 200, 295, 380, 437, 490 | `file` | upload/complete/serve/read/delete | Linked doc uses read-level document gate |
| 7–8 | `api/src/collaboration/index.ts` | 146, 427 | `collaboration` | persist, join | WS parity with REST read gate |
| 9 | `api/src/routes/documents.ts` | 701 | `document` | `capabilityForCommand(command)` | **Gap:** session path same as read |
| 10 | `api/src/routes/api-tokens.ts` | 52 | `api_token` | create | Workspace admin |
| 11 | `api/src/routes/accountability.ts` | 44 | `document` | read | Per-item filter in loop |

**Tests only:** `capabilities.test.ts` (4 calls).

---

## `documents.ts` routes (2026-05-29)

| Method | Path | Gate today |
|--------|------|------------|
| GET | `/:id`, `/:id/content` | `loadDocumentForRead` → `authorize` read |
| PATCH/POST/DELETE/convert | mutations | `*DocumentMutation` → `authorizeDocumentMutation` + token scope |
| POST | `/:id/commands` | `documentCommandCapability` + `authorize` with honest action |
| POST | `/:id/undo-conversion` | `authorize` write (`creator_or_admin`) + converter fallback |

---

## `document-mutations.ts` entrypoints (post D084)

| Export | `authorizeDocumentMutation` at entry? | Field-level enforce |
|--------|--------------------------------------|---------------------|
| `updateDocumentContentMutation` | Yes (`write`) | — |
| `createDocumentMutation` | Yes (`write`) | `authorize` `document_reference` for associations |
| `updateDocumentMutation` | Yes (`write` or caller capability) | `creator_or_admin` (visibility/type), `governance`+`workspace_admin` (reports_to) |
| `deleteDocumentMutation` | Yes (`write` + `creator_or_admin`) | — |
| `convertDocumentMutation` | Yes (`write` + `creator_or_admin`) | — |

`loadAccessibleDocument` uses `authorizeDocumentMutation` read gate (write action without extra enforce). No `decide*` exports remain.

---

## `document-policy.ts`

Seed only: `DOCUMENT_POLICY_CASES` + types. Runtime policy is `authorize()` in `capabilities.ts`.

---

## Setup vs capabilities (post D082)

| Surface | Mechanism |
|---------|-----------|
| `setup-access.ts` | Token parse/accept (unchanged semantics) |
| `setup.ts` | `setupPrincipalFromRequest` → `req.principal`; `authorize({ resource: 'setup', action: 'initialize' })` |

---

## Flagged gaps (remaining)

1. **List/aggregation routes** — `GET /api/issues`, team grids, bootstrap rows still use `VISIBILITY_FILTER_SQL` without per-row `authorize()` (intentional N+1 avoidance).
2. **Dead deny reasons** — `file_not_bound`, `file_not_owned_or_admin` never returned from `authorize()`.
3. **Collaboration `canAccessDocumentForCollab`** — thin wrapper over `authorize`; rename/consolidate optional.

### Closed in OWASP pass (2026-05-29)

- Token scope on programs/projects/document mutations
- Commands use `documentCommandCapability` + enforce rules in `enforceDocumentSessionRule`
- Comments unified with `authorize`
- Governance keys on generic PATCH (incl. `submitted_at`, admin bypass removed)
- `workspaceAccessMiddleware` removed

---

## D077 phase-2 route backlog (preview for Slice 1.6)

| Route file | ~LOC | Handlers | Auth today | Risk |
|------------|------|----------|------------|------|
| `issues.ts` | 1454 | 16 | Partial `DocumentActor` | Med — finish first |
| `projects.ts` | 1865 | 14 | Visibility SQL | Med–High |
| `programs.ts` | 992 | 11 | Visibility SQL | Med |
| `team.ts` | 1762 | 11 | Visibility + allocation admin | Med |
| `admin.ts` | 2021 | 23 | Super-admin only | Epic 8 (platform) |

**Epic 8 + D083 tail (2026-05-24):** `route-capability.ts` on issues/projects/programs reads; issue route writes (history, delete, accept/reject/iterations); `issue-mutations-service.ts` uses `authorize` for create/update/bulk/accept/reject/iterations; `weeks/week-access.ts` (`requireWeekRead`/`requireWeekWrite`) on all `weeks/*` `:id` handlers (sprints, reviews, approvals, standups); `team` `GET /people/:personId/sprint-metrics` uses `requirePersonRead` + self-or-admin.

**Intentionally unchanged (aggregation / list N+1):** `GET /api/issues` list + bootstrap issue rows (`VISIBILITY_FILTER_SQL`); `team.ts` grid/assignments/programs list routes; child-row filters inside week handlers after parent sprint guard.

None use inline `authorize()` in route files except via wrappers above. Full handler lists in remediation plan Appendix D.
