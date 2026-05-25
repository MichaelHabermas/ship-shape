# Authorization matrix (Slice 1.1)

**Date:** 2026-05-24  
**Purpose:** Inventory every production auth gate before Epic 1 code changes.  
**Canonical checklist:** `my-docs/CODE_QUALITY_REMEDIATION_PLAN.md` (Wave 1, Epic 1).

---

## Summary counts

| Pattern | Production count | Gap |
|---------|------------------|-----|
| `authorize(` call sites | **11** | Document/collaboration paths ignore per-action for session users |
| `requireCapability` callers | **0** | Exported, unused — adopt or delete in Slice 1.2 |
| `canAccessDocument` (local duplicates) | **3 implementations**, 7 call sites | Not unified with `authorize` |
| `workspaceAccessMiddleware` | **1 definition**, **0 mounts** | Dead middleware |
| `Principal.kind === 'setup'` | **0 constructors** | `setup.ts` uses env token, not capability layer |
| Mutation entrypoints without token scope | **5** | All use `DocumentActor` only |

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

## `documents.ts` routes without `authorize`

| Method | Path | Gate today | Target (Epic 1) |
|--------|------|------------|-------------------|
| GET | `/:id` | Local `canAccessDocument` | `authorize` read |
| GET | `/:id/content` | Inline visibility SQL | `authorize` read |
| PATCH | `/:id/content` | → `updateDocumentContentMutation` | Mutation + token scope |
| POST | `/` | → `createDocumentMutation` | Mutation + token scope |
| PATCH | `/:id` | → `updateDocumentMutation` | Mutation + token scope |
| DELETE | `/:id` | → `deleteDocumentMutation` | Mutation + token scope |
| POST | `/:id/convert` | → `convertDocumentMutation` | Mutation + token scope |
| POST | `/:id/commands` | `authorize` (read-level) | Honest action + mutation parity |
| POST | `/:id/undo-conversion` | Local `canAccessDocument` | `authorize` write |

---

## `document-mutations.ts` entrypoints

| Export | `authorize` at entry? | Token scope? | Policy path |
|--------|----------------------|--------------|-------------|
| `updateDocumentContentMutation` | No | No | `decideDocumentAccess(..., 'write')` |
| `createDocumentMutation` | No | No | `decideReferenceAccess`, admin checks |
| `updateDocumentMutation` | No | No | `decideCreatorOrAdmin`, `decideWorkspaceAdmin` |
| `deleteDocumentMutation` | No | No | `decideCreatorOrAdmin(..., 'delete')` |
| `convertDocumentMutation` | No | No | Inline creator check |

---

## `document-policy.ts` production callers

All production `decide*` usage is inside `document-mutations.ts` only (6 call sites). No route calls `decideDocumentAccess` directly.

---

## Setup vs capabilities

| Surface | Mechanism |
|---------|-----------|
| `setup.ts` | `SHIP_SETUP_TOKEN` / header `x-setup-token` — no `Principal`, no `authorize` |
| `capabilities.ts` | `{ resource: 'setup', action: 'initialize' }` requires `principal.kind === 'setup'` — **never constructed in production** |

---

## Flagged gaps (Slice 1.1 → 1.3)

1. **Token scope on mutations** — Scoped API tokens can hit legacy REST write routes that bypass `authorize`.
2. **Commands read-level pass** — `capabilityForCommand` maps delete/governance actions but `authorize()` treats session document actions as read.
3. **Triple `canAccessDocument`** — `documents.ts`, `comments.ts`, collaboration wrapper.
4. **`workspaceAccessMiddleware`** — defined in `auth.ts:269`, never mounted.
5. **`requireCapability`** — zero callers.
6. **Dead deny reasons** — `file_not_bound`, `file_not_owned_or_admin` never returned from `authorize()`.
7. **Unused capability actions** — `read_content`, `rename`, `review_accountability`, `collaborate` (document resource) have no route mapping.

---

## D077 phase-2 route backlog (preview for Slice 1.6)

| Route file | ~LOC | Handlers | Auth today | Risk |
|------------|------|----------|------------|------|
| `issues.ts` | 1454 | 16 | Partial `DocumentActor` | Med — finish first |
| `projects.ts` | 1865 | 14 | Visibility SQL | Med–High |
| `programs.ts` | 992 | 11 | Visibility SQL | Med |
| `team.ts` | 1762 | 11 | Visibility + allocation admin | Med |
| `admin.ts` | 2021 | 23 | Super-admin only | Epic 8 (platform) |

None use `authorize()`. Full handler lists in remediation plan Appendix D.
