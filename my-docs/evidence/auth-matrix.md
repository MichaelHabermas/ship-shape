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
| Mutation entrypoints without token scope | **Closed for project/program/issue writes** | Service `guardDocumentMutation` / `guardDocumentCreate` / `guardDocumentMutationsBatch` in [`mutation-capability-guard.ts`](../../api/src/services/mutation-capability-guard.ts); program/project routes only validate UUID params |

### OWASP hardening (2026-05-29)

- **Governance mass assignment:** `submitted_at` in `GOVERNANCE_PROPERTY_KEYS` (blocked on generic PATCH/create for all principals). Server sets `submitted_at` on first weekly plan/retro content save via `stampWeeklyAccountabilitySubmittedAt`. Tests: `documents-governance-patch.test.ts`, `document-governance.test.ts`, probe `input-governance-mass-assignment`.
- **Programs/projects:** `requireProgramWrite` / `requireProjectWrite` on routes; writes in `programs-service.ts` / `projects-service.ts` call `guardDocument*`; token scope tests in `programs-projects-token-scope.test.ts`, `projects-mutation-guard.test.ts`.
- **Issue bulk:** `bulkUpdateIssuesMutation` guards each id (`creator_or_admin` on delete; `includeArchived` / `includeDeleted` on restore); all-auth-fail → 403; sprint/project refs use `requireReferenceableDocument`; `issue-bulk-mutation-guard.test.ts`.
- **Week lifecycle:** `requireWeekLifecycleAuthority` uses capability write on sprint row, not visibility-only SQL; `governance-auth.test.ts`.
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

### Closed — service-layer project/program writes (2026-05-29)

- [`projects-service.ts`](../../api/src/services/projects-service.ts), [`project-nested-service.ts`](../../api/src/services/project-nested-service.ts), [`project-retro-service.ts`](../../api/src/services/project-retro-service.ts): write paths take `Principal` and call `guardDocumentMutation` / `guardDocumentCreate` before SQL (no `VISIBILITY_FILTER_SQL` on writes).
- [`programs.ts`](../../api/src/routes/programs.ts) POST/PATCH/DELETE/merge: same guards after route `require*Write`.
- Tests: service-layer [`projects-mutation-guard.test.ts`](../../api/src/services/__tests__/projects-mutation-guard.test.ts) (direct `Principal`, bypasses routes); route token scope [`programs-projects-token-scope.test.ts`](../../api/src/routes/programs-projects-token-scope.test.ts) (PATCH/DELETE/POST create).

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
| `projects.ts` | 1865 | 14 | Route `require*Write` + service `guardDocument*` on writes; visibility SQL on list/get only | Low (writes) |
| `programs.ts` | ~900 | 11 | Route `require*Write`; writes delegate to `programs-service.ts` (`guardDocument*`); visibility SQL on list/get/merge-preview | Low (writes) |
| `team.ts` | 1762 | 11 | Visibility + allocation admin | Med |
| `admin.ts` | 2021 | 23 | Super-admin only | Epic 8 (platform) |

**Epic 8 + D083 tail (2026-05-24):** `route-capability.ts` on issues/projects/programs reads; issue route writes (history, delete, accept/reject/iterations); `issue-mutations-service.ts` uses `authorize` for create/update/bulk/accept/reject/iterations; `weeks/week-access.ts` (`requireWeekRead`/`requireWeekWrite`) on all `weeks/*` `:id` handlers (sprints, reviews, approvals, standups); `team` `GET /people/:personId/sprint-metrics` uses `requirePersonRead` + self-or-admin.

**Intentionally unchanged (aggregation / list N+1):** `GET /api/issues` list + bootstrap issue rows (`VISIBILITY_FILTER_SQL`); `team.ts` grid/assignments/programs list routes; child-row filters inside week handlers after parent sprint guard.

None use inline `authorize()` in route files except via wrappers above. Full handler lists in remediation plan Appendix D.
