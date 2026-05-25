# Week vs sprint terminology

Ship uses **week** in product language and **sprint** in several historical identifiers. This document is the canonical map for agents and contributors.

**Scope (Epic 7):** documentation only. Do **not** mass-rename DB enums, API paths, query params, or TypeScript fields in the code-quality remediation program. See `my-docs/CODE_QUALITY_REMEDIATION_PLAN.md` (reject big-bang rename).

**Deeper model:** [Document Model Conventions](../document-model-conventions.md) (week windows, week documents, associations). **Workflow:** [Week Documentation Philosophy](../week-documentation-philosophy.md).

---

## What to say (canonical)

| Concept | Say in UI, docs, comments | Meaning |
|---------|--------------------------|---------|
| **Week** | User-facing label, nav, copy | A 7-day work window (workspace cadence) |
| **Week document** | "Week" in program/project context | Stored `documents` row for one program's commitment in one week window |
| **Week window** | "Week N", dates | Derived from workspace `sprint_start_date` + `sprint_number` — not a separate table |
| **My Week** | Dashboard route `/my-week` | Person-centric view of active work |

Avoid introducing new user-visible "sprint" labels unless quoting legacy API/DB names in technical docs.

---

## What stays `sprint` (legacy identifiers)

These names are **intentional debt** until a dedicated rename program. New code should follow existing patterns, not invent parallel naming.

| Layer | Legacy name | Notes |
|-------|-------------|--------|
| **DB** | `document_type = 'sprint'` | Week **document** row type |
| **DB** | `relationship_type = 'sprint'` in `document_associations` | Issue/week membership (not `week`) |
| **DB** | `properties.sprint_number` | Which week window (1-based) |
| **DB** | `workspaces.sprint_start_date` | Workspace cadence anchor |
| **DB** | `sprint_id` column on `documents` | **Dropped** (migration 027); use associations |
| **API paths** | `/api/weeks`, `/api/weeks/:id/...` | Primary week CRUD and lifecycle |
| **API paths** | `/api/programs/:id/sprints`, `/api/projects/:id/sprints` | Nested list/create under parent doc |
| **API paths** | `/api/projects/:id/weeks` | Also registered (OpenAPI); prefer one style per feature area when extending |
| **Query/body** | `sprint_id` | Issue filters, standups, dashboard, Claude context (`?sprint_id=` = week document id) |
| **Query** | `sprint_number` | Week lookup by number within project |
| **OpenAPI / JSON** | `SprintDocumentView`, `sprint_id` on issues | Wire names; map mentally to "week" |
| **Shared TS** | `document_type: 'sprint'`, `SprintDocumentView` | Editor and list types |
| **Code** | `getSprintAssociation`, `sprints.ts`, `sprint-calendar.ts` | File/function names; behavior is week-related |
| **Claude API** | Response key `sprint`, query `sprint_id` | Historical compatibility (`docs/solutions/integration-issues/claude-context-api-for-ai-skills.md`) |

---

## API route map (quick reference)

```
/api/weeks                          # collection + :id CRUD, plan/review, standups, approvals
/api/weeks/lookup                   # resolve week doc by project + sprint_number
/api/dashboard/my-week              # My Week dashboard (not under /weeks)
/api/programs/:id/sprints           # program's week documents
/api/projects/:id/sprints           # project's week documents (create/list)
/api/issues?sprint_id=              # filter by week document id
/api/claude/context?sprint_id=      # AI context (week document id)
```

Implementation lives under `api/src/routes/weeks/` (`sprints.ts` mounts collection handlers). `api/src/routes/weeks.ts` re-exports the package.

---

## Web routes (two families)

| Pattern | Example | Use |
|---------|---------|-----|
| **Program/project tabs** | `/documents/:programId/weeks`, `/documents/:projectId/weeks/:weekId` | Preferred navigation for week timelines |
| **Legacy sprint URLs** | `/sprints/:id`, `/sprints/:id/view`, `/sprints/:id/plan` | Still linked from command palette, backlinks, some E2E; do not assume removed |

When adding links in UI, prefer `/documents/.../weeks/...` for program mode. When fixing E2E, match the route the feature actually uses (see `DECISION_LOG` D-series program-week navigation fixes).

---

## Associations vs columns

- **Issue in a week:** `document_associations` with `relationship_type = 'sprint'` (historical enum value).
- **Helpers:** `getSprintAssociation` / `updateWeekAssociation` — function names mix eras; both refer to the week document id.
- **Do not** reintroduce `documents.sprint_id`; use associations or `belongs_to` on issues per current model.

---

## Guidance for new work

1. **User-visible strings:** "Week", "My Week", "Week plan", not "Sprint".
2. **API contracts:** Keep `sprint_id` / `document_type: 'sprint'` unless an approved rename epic changes OpenAPI and clients together.
3. **Variables in new TS:** Prefer `weekId` / `weekDocument` in local code when the value is a week document UUID, even if assigning to `sprint_id` on a DTO.
4. **Tests:** Seed and assert using real paths (`/api/weeks`, `/documents/.../weeks`) where the feature under test uses them; `sprint_id` in JSON bodies is still valid.
5. **E2E slash/upload:** Unrelated to this naming doc; see `e2e/security.spec.ts` helper `uploadImageViaSlashCommand`.

---

## Future rename (out of scope)

A full rename would need coordinated migration: `document_type`, association enum, OpenAPI paths/fields, shared types, web routes, seed data, security probe fixtures, and external Claude/skill scripts. Track appetite in remediation plan Wave 4+ / product decision — not Epic 7.
