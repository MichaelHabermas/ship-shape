# Unified Document Model

This document describes the unified document architecture where all content types are stored as documents with different properties.

> **Related**: See [Document Model Conventions](./document-model-conventions.md) for architectural decisions, terminology, and guiding principles.

## Core Concept

Following Notion's paradigm: **everything is a document with properties**. The difference between a "wiki page" and an "issue" is not the underlying data structure—it's the properties and workflows associated with it.

## Architecture Overview

### Tech Stack

| Layer         | Technology                      | Rationale                                           |
| ------------- | ------------------------------- | --------------------------------------------------- |
| **Server DB** | PostgreSQL (direct SQL, no ORM) | Simplicity, full control, no abstraction overhead   |
| **Client DB** | IndexedDB                       | Offline-tolerant storage, fast reads                |
| **Rich Text** | TipTap + Yjs                    | Collaborative editing with CRDT conflict resolution |
| **Sync**      | Hybrid (see below)              | Properties full-sync, content CRDT-sync             |
| **API**       | REST endpoints                  | Well-understood, good tooling                       |
| **Real-time** | WebSocket + Yjs Awareness       | Presence, cursors, live updates                     |

### Permissions Model

**Workspace membership plus document visibility** - no per-program ACLs:

- You're in the workspace or you're not
- Workspace-visible documents are visible to workspace members
- Private documents are visible to their creator and workspace admins
- No per-program ACLs
- Roles (admin, member) are workspace-scoped

### Authorization vs Content Separation

**Critical architecture principle:** Authorization and content are separate layers.

| Layer | Table | Purpose |
|-------|-------|---------|
| Authorization | `workspace_memberships` | Who can access what workspace, with what role |
| Content | `documents (type='person')` | User profile, editable content |

**How they connect:**
- Person documents have `properties.user_id` linking to `users.id`
- Membership table has NO reference to person documents
- Auth checks query `workspace_memberships`
- Display (Directory, Allocation) queries `documents WHERE document_type = 'person'`

**Why separate:**
- Security: Authorization changes are auditable, separate from content edits
- Independence: Creating membership doesn't require creating person doc atomically
- Clarity: No "repair logic" to keep layers in sync

### Caching Strategy

The application uses stale-while-revalidate caching for performance:

- **Query cache**: TanStack Query with IndexedDB persistence for fast startup
- **Rich text content**: Yjs CRDT documents with y-indexeddb for editor state persistence
- **Read from cache**: Stale data shown immediately, fresh data fetched in background
- **Write requires network**: Mutations use optimistic updates with rollback on error

## Document Types

The `document_type` field describes **what kind** of document it is:

| Type           | Description                | Key Properties                                   |
| -------------- | -------------------------- | ------------------------------------------------ |
| `wiki`         | Documentation content      | Prose content, no workflow state                 |
| `issue`        | Work item (tracked task)   | State, assignees, priority, ticket number, dates |
| `program`      | Product/Initiative         | Long-lived container, has members, ticket prefix |
| `project`      | Time-bounded deliverable   | Groups issues, has dates, belongs to program     |
| `sprint`       | Week container (historical DB name) | Week number, relationship associations, contains week's work |
| `weekly_plan`  | Weekly planning doc        | Child of week, required before week starts       |
| `weekly_retro` | Weekly retrospective       | Child of week, required after week ends          |
| `weekly_review` | Week review document      | Child of week, manager/accountability review     |
| `standup`      | Daily standup notes        | Child of week/person workflow                    |
| `person`       | User profile page          | `properties.user_id` links to auth user, capacity, skills |

Full enum values are defined in `shared/src/enums/document-enums.ts` (source of truth).

## Document Location

`parent_id` is the hierarchy column. Program, project, and week membership live in `document_associations`, not legacy `program_id`, `project_id`, or `sprint_id` columns.

| Relationship | Storage | Example |
| ------------ | ------- | ------- |
| Hierarchy | `documents.parent_id` | A child page under a parent issue |
| Program membership | `document_associations` with `relationship_type = 'program'` | Program specs, program issues |
| Project membership | `document_associations` with `relationship_type = 'project'` | Issues grouped under a project |
| Week membership | `document_associations` with `relationship_type = 'sprint'` | Issues assigned to a week |

## Week Model

### Week Windows (Derived)

Weeks are **derived 7-day time windows** calculated from the workspace start date, not stored entities:

- Workspace has `sprint_start_date` setting (historical name retained in database)
- Week 1 = days 1-7 from start date
- Week 2 = days 8-14
- Week N = computed from date

**No Week table exists.** The week window is calculated.

### Week Documents (Explicit)

What IS stored is the **Week document** - one per program per week window:

```
Program (AUTH)
├── Project (Login Revamp)
│   └── Issues (backlog)
└── Week (AUTH's Week of Jan 27)   ← document_type: 'sprint'
    ├── Weekly Plan                ← document_type: 'weekly_plan'
    ├── Weekly Retro               ← document_type: 'weekly_retro'
    └── Issues (active work)       ← assigned to this week
```

Week documents have:

- Program/project/week membership through `document_associations`
- `properties.sprint_number`: which 7-day window (REQUIRED, historical field name)
- `properties.owner_id`: person accountable for this week (REQUIRED)
- Document body: week goals, context, description (everything is a document)
- Children: weekly plan, weekly retro, assigned issues

**Creating a week document is intentional.** It means "we commit to doing work on this program during this 7-day window." Programs may skip week windows if no work is planned.

### Week Dates (Computed)

Week dates are **computed from sprint_number + workspace start date**, not stored:

```typescript
function computeWeekDates(weekNumber: number, workspaceStartDate: Date) {
  const start = addDays(workspaceStartDate, (weekNumber - 1) * 7);
  const end = addDays(start, 6); // 7 days total
  return { start, end };
}
```

### Week Status (Computed)

Week status is **computed from the computed dates**, not stored:

| Condition | Status |
|-----------|--------|
| `today < start` | `upcoming` |
| `start <= today <= end` | `active` |
| `today > end` | `completed` |

This eliminates the need for manual "Start Week" / "Complete Week" workflows and avoids storing redundant data.

### Week Owner Constraint

Each week requires exactly **one owner** (`owner_id`). A person can only own one week per week window across all programs. This ensures:
- Clear accountability
- Resource visibility
- No overallocation

### Week Iterations (Claude Code Integration)

The `sprint_iterations` table (historical name) tracks story completion attempts during Claude Code `/work` sessions:

```
sprint_iterations
├── id: UUID
├── sprint_id: UUID (FK → documents, points to week document)
├── workspace_id: UUID
├── story_id: VARCHAR(200) - PRD story ID
├── story_title: VARCHAR(500)
├── status: ENUM('pass', 'fail', 'in_progress')
├── what_attempted: TEXT - Description of work done
├── blockers_encountered: TEXT - What failed/blocked
├── author_id: UUID (FK → users)
└── created_at, updated_at
```

**Use cases:**
- Real-time progress visibility during `/work` execution
- Week velocity analysis (iterations per story)
- Learning extraction from failed attempts
- Historical record for retrospectives

**API endpoints:**
- `POST /api/weeks/:id/iterations` - Log an iteration
- `GET /api/weeks/:id/iterations` - List iterations (filterable by status, story_id)

## Issue Lifecycle

Issues flow from backlog to week (the "conveyor belt"):

```
Backlog (in Project)  →  Assigned to Week  →  Done
     ↓                         ↓
 project association      week association set
 no week association      project association kept
```

Issues maintain **multiple associations**:

- Program association - always set when scoped to a program
- Project association - set when belongs to a project
- Week assignment - set when assigned to active week work

## Data Model

### Document Schema

```typescript
interface Document {
  // Identity
  id: string; // UUID
  workspace_id: string;
  document_type: DocumentType;

  // Hierarchy column
  parent_id: string | null; // document tree nesting
  // Program/project/week membership is stored in document_associations.

  // Content
  title: string; // Always "Untitled" for new docs
  content: TipTapJSON; // Rich text content
  yjs_state: Uint8Array; // CRDT state for collaboration

  // Properties (schema-less JSONB, type-enforced in code)
  properties: Record<string, any>;

  // Timestamps
  created_at: string;
  updated_at: string;
  created_by: string;
}
```

### Relationship Strategy

`parent_id` is the only relationship column. Program, project, and week assignments use the `document_associations` table. Everything else type-specific goes in `properties` JSONB.

### Properties System

Properties are stored in a **schema-less JSONB column**, with structure enforced via TypeScript:

```typescript
// Type-specific properties (enforced in code, not database)
interface IssueProperties {
  state: 'backlog' | 'todo' | 'in_progress' | 'done' | string; // 4 required + custom
  priority?: 'low' | 'medium' | 'high';
  assignee_id?: string;
  ticket_number?: number;
  estimate_hours?: number;
  claude_metadata?: ClaudeMetadata; // Claude Code integration
}

// Claude Code workflow tracking (see application-architecture.md)
interface ClaudeMetadata {
  updated_by: 'claude';           // Attribution flag
  story_id?: string;              // PRD story ID
  prd_name?: string;              // Source PRD
  confidence?: number;            // 0-100 completion confidence
  telemetry?: {                   // Completion metrics
    iterations: number;
    feedback_loops: { type_check: number; test: number; build: number };
    time_elapsed_seconds: number;
    files_changed: string[];
  };
}

interface WeekProperties {
  sprint_number: number;  // References 7-day week window - REQUIRED (historical field name)
  owner_id: string;       // Person who owns this week - REQUIRED
  // That's it. Dates computed from sprint_number + workspace start date.
  // Goal/description goes in document body (everything is a document).
  // Status computed from dates. See document-model-conventions.md.
}

interface ProgramProperties {
  prefix: string; // e.g., "AUTH" for ticket numbers
  color?: string;
}

interface PersonProperties {
  user_id: string; // Links to users.id (required)
  email?: string; // Denormalized for display
  capacity_hours?: number;
  skills?: string[];
}

// Example issue properties
document.properties = {
  state: "in_progress",
  priority: "high",
  assignee_id: "user_123",
  ticket_number: 42,
  estimate_hours: 4,
  custom_field: "any value", // user-defined
};
```

**Key principle:** The database stores raw JSONB. TypeScript interfaces enforce structure at the application layer. This allows custom properties without schema migrations.

### Workflow States

Issues have a `state` property. Built-in states (see `ISSUE_STATE_VALUES` in `@ship/shared`):

| State | Description |
|-------|-------------|
| `triage` | Needs triage |
| `backlog` | Not yet planned |
| `todo` | Planned for current week |
| `in_progress` | Actively being worked |
| `in_review` | In review |
| `done` | Completed |
| `cancelled` | Cancelled |

States are string values in `properties`, not foreign keys to a separate table.

### Computed Properties (Roll-ups)

Roll-ups are **computed on-demand client-side**:

| Computation        | Description        | Example                  |
| ------------------ | ------------------ | ------------------------ |
| `count`            | Count children     | Project: "12 issues"     |
| `sum`              | Sum child property | Week: "40 hours total"   |
| `percent_complete` | % with status=done | Project: "70% complete"  |

No precomputation or caching - compute when rendering. Optimize later if needed.

## Ticket Numbers

Issues get **workspace-scoped sequential display IDs**:

- Format: `#${ticket_number}` (e.g., `#42`, `#123`)
- `ticket_number` auto-increments per workspace
- API exposes this as `display_id` on issue responses
- Program prefixes (e.g., AUTH-42) were removed in migration 007b

## Sync Architecture

### Hybrid Sync Model

| Data Type         | Sync Strategy               | Conflict Resolution       |
| ----------------- | --------------------------- | ------------------------- |
| Properties        | Full sync to IndexedDB      | Last-write-wins or merge  |
| Rich text content | Yjs CRDT partial sync       | Automatic CRDT merge      |
| Relationships     | Full sync (IDs + snapshots) | Server is source of truth |

### Sync Flow

```
Client (IndexedDB)          Server (PostgreSQL)
      │                            │
      │  ──── push changes ────>   │
      │                            │
      │  <─── pull updates ─────   │
      │       (properties)         │
      │                            │
      │  <═══ Yjs sync ═══════>    │
      │       (rich text)          │
```

### Initial Sync Strategy

**Recent + accessed documents** - balance of coverage and speed:

- Sync last 30 days of documents
- Sync any document user has previously accessed
- Config entities (states, labels) sync fully (small payload)
- Rich text content fetched on-demand, cached locally

### Search

Ship has two deliberate search contracts (see [Application Architecture](./application-architecture.md#rest-api-design)):

- `/api/search/documents` — title-only metadata search for the command palette
- `/api/search/content` — server-backed full-content search for `/docs`, backed by the rebuildable `document_search_index` table

`documents.content`, selected `properties`, and collaboration Yjs state remain source of truth; the index is derived state.

## Configuration

### Workflow States

States are **string values** stored directly in document properties, not foreign keys to a separate table:

```typescript
// States are just strings in the properties JSONB
document.properties.state = "in_progress";
```

**4 built-in states (legacy shorthand):** `backlog`, `todo`, `in_progress`, `done` — see full `ISSUE_STATE_VALUES` in `@ship/shared` for the complete set including `triage`, `in_review`, and `cancelled`.

### Labels (Future)

Labels will be stored as string arrays in properties:

```typescript
document.properties.labels = ["bug", "urgent", "frontend"];
```

Available labels per workspace stored in workspace settings. No separate labels table needed.

## File Attachments

**References only, files in S3/blob storage**:

- Documents store file references (URL, filename, size, mime type)
- Actual files stored in S3 or compatible blob storage
- Files not synced to IndexedDB (too large)
- Offline: Show placeholder, fetch when online

```typescript
interface FileAttachment {
  id: string;
  filename: string;
  url: string; // S3 presigned URL or CDN URL
  size_bytes: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_at: string;
}
```

## Real-Time Collaboration

**Full collaboration experience** (like Notion):

| Feature              | Technology                | Scope                                 |
| -------------------- | ------------------------- | ------------------------------------- |
| **Document editing** | Yjs CRDT                  | Conflict-free collaborative editing   |
| **Presence**         | Yjs Awareness + WebSocket | Who's viewing a document              |
| **Cursors**          | Yjs Awareness             | See others' cursor positions in docs  |
| **Live updates**     | WebSocket                 | Real-time list updates, new documents |

**Offline behavior:**

- **Editor rich text:** Yjs + IndexedDB tolerate offline editing; changes merge on reconnect via CRDT
- **Metadata writes:** Require network; optimistic updates roll back on failure
- **Presence/cursors:** Online only
- **List updates:** Apply on reconnect

## User Offboarding

When a user is removed from a workspace:

- **IndexedDB wiped immediately** for that workspace
- Server rejects further sync attempts
- In-flight changes are lost (security over data preservation)

## Mobile Strategy

**Web-only for now**:

- Responsive web design
- No native iOS/Android apps initially
- PWA possible future enhancement
- Revisit mobile apps based on user demand

## UI Filtering Rules

### Documents View (Workspace Level)

Shows documents with no program/project/week association:

- Org-level wikis like "Engineering Onboarding"
- Cross-program documentation

### Program View

Shows documents associated to the current program through `document_associations`:

- Program documentation (wikis)
- Projects and their issues
- Week documents and their contents

### Week View

Shows current week across programs:

- Filter by computed week window (current date)
- Group by program or assignee
- Show week docs, plans, retros, issues

### Resource View

Shows people and their work:

- Person documents
- Issues grouped by assignee
- Capacity and workload

## Modes (Use Cases)

Modes are **different lenses on the same data** for different personas:

| Mode         | Use Case       | Mental Model                                    |
| ------------ | -------------- | ----------------------------------------------- |
| **Programs** | Engineering/PM | "What are we building? How's it going?"       |
| **Weeks**    | Daily standup  | "What's happening this week? What's blocked?" |
| **Resource** | Manager/Lead   | "Who's doing what? Who's overloaded?"           |
| **Docs**     | Anyone         | "Where's that document?"                        |

**Key principle:** All modes query the same document graph. Mode changes grouping/filtering/layout—not the underlying data.

## Current Reality vs Target Architecture

Type-specific fields live in the `properties JSONB` column (migration 001). Legacy explicit columns were consolidated; program/project/week membership uses `document_associations`, not legacy FK columns on `documents`.

| Aspect | Implementation |
|--------|----------------|
| Properties | JSONB column (`properties`) |
| States | String in `properties.state` |
| Associations | `document_associations` junction table |
| Hierarchy | `parent_id` on `documents` |

---

## Roadmap

Features planned but not yet implemented:

### Denormalized Snapshots

`_snapshot` field on documents for offline display without joins:

```typescript
document._snapshot = {
  assignee: { id: "user_1", name: "Jane", avatar_url: "..." },
  program: { id: "prog_1", name: "Auth Service", prefix: "AUTH" },
};
```

### View Documents

Saved filters/queries as `document_type: 'view'`:
- Store query parameters, filters, display options
- Share views across team
- Not yet in schema enum

---

## References

- [Document Model Conventions](./document-model-conventions.md) - Architectural decisions and terminology
- [Week Documentation Philosophy](./week-documentation-philosophy.md) - Week workflow and documentation requirements
