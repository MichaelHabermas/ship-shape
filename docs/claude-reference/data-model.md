# Ship Data Model

This document describes the database schema and data model for the Ship application.

## Core Architecture: Everything is a Document

Ship uses a **Unified Document Model** where all content types are stored in a single `documents` table with a `document_type` discriminator. This follows Notion's paradigm: the difference between content types is properties, not structure.

## Tables Overview

| Table | Purpose |
|-------|---------|
| `documents` | All content (wiki, issue, program, project, week, person, standup, weekly_review) |
| `document_associations` | Junction table for flexible document relationships |
| `document_history` | Audit trail of all document field changes |
| `document_links` | Backlinks between documents |
| `workspaces` | Multi-tenant isolation |
| `users` | Global identity (users can belong to multiple workspaces) |
| `workspace_memberships` | Authorization: who can access what workspace |
| `workspace_invites` | Email invite flow |
| `sessions` | Cookie-based auth with 15-min inactivity timeout |
| `api_tokens` | Long-lived tokens for CLI/programmatic access |
| `files` | S3 file references for attachments |
| `audit_logs` | Compliance-grade action logging |
| `sprint_iterations` | Claude Code work session tracking (historical table name) |

---

## 1. Documents Table

The core table storing all content types.

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_type document_type NOT NULL DEFAULT 'wiki',
  title TEXT NOT NULL DEFAULT 'Untitled',

  -- Content (shared by ALL document types)
  content JSONB DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
  yjs_state BYTEA,  -- Yjs CRDT state for collaboration

  -- Hierarchy
  parent_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,

  -- Program/project/week membership uses document_associations.

  -- Type-specific properties (JSONB)
  properties JSONB DEFAULT '{}',

  -- Indexed columns
  ticket_number INTEGER,  -- Auto-increment per workspace for display_id
  archived_at TIMESTAMPTZ,

  -- Status timestamps (for issues)
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('private', 'workspace'))
);
```

### Document Type Enum

<!-- docs:generated start id="document-type-enum" source="shared/src/enums/document-enums.ts" -->
- `wiki`
- `issue`
- `program`
- `project`
- `sprint`
- `person`
- `weekly_plan`
- `weekly_retro`
- `standup`
- `weekly_review`
<!-- docs:generated end id="document-type-enum" -->

### Type-Specific Properties (JSONB)

Properties are stored as schema-less JSONB, with structure enforced at the application layer:

| Document Type | Key Properties |
|---------------|----------------|
| `issue` | `state`, `priority`, `assignee_id`, `source`, `rejection_reason`, `feedback_status`, `estimate_hours`, `claude_metadata` |
| `program` | `prefix` (e.g., "AUTH"), `color`, `emoji` |
| `project` | `prefix`, `color`, `emoji` |
| `sprint` | `sprint_number` (historical field), `owner_id`, `plan`, `success_criteria`, `confidence` |
| `person` | `user_id` (links to users.id), `email`, `capacity_hours`, `skills` |
| `standup` | `author_id`, `posted_at` |
| `weekly_plan` | `sprint_id`, `author_id`, plan approval fields |
| `weekly_retro` | `sprint_id`, `author_id`, retro content |
| `weekly_review` | `plan_validated`, `key_learnings` (week review properties) |

### Issue States

Issues have a `state` property. Valid values (from `ISSUE_STATE_VALUES` in `shared/src/enums/document-enums.ts`):
- `triage`
- `backlog`
- `todo`
- `in_progress`
- `in_review`
- `done`
- `cancelled`

### Key Indexes

```sql
CREATE INDEX idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX idx_documents_parent_id ON documents(parent_id);
CREATE INDEX idx_documents_document_type ON documents(document_type);
CREATE INDEX idx_document_associations_related_type ON document_associations(related_id, relationship_type);
CREATE INDEX idx_document_associations_document_type ON document_associations(document_id, relationship_type);
CREATE INDEX idx_documents_properties ON documents USING GIN (properties);
CREATE INDEX idx_documents_visibility ON documents(visibility);

-- Unique program prefix per workspace
CREATE UNIQUE INDEX idx_documents_workspace_prefix
  ON documents(workspace_id, (properties->>'prefix'))
  WHERE document_type = 'program' AND properties->>'prefix' IS NOT NULL;
```

---

## 2. Document Associations

Junction table for flexible document relationships, replacing direct FK columns.

```sql
CREATE TYPE relationship_type AS ENUM ('parent', 'project', 'sprint', 'program');

CREATE TABLE document_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  related_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  relationship_type relationship_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',

  CONSTRAINT unique_association UNIQUE (document_id, related_id, relationship_type),
  CONSTRAINT no_self_reference CHECK (document_id != related_id)
);
```

**Relationship types:**
- `parent` - Hierarchy/nesting
- `project` - Issue belongs to project
- `sprint` - Issue assigned to week (historical relationship name; replaces the dropped sprint_id column)
- `program` - Document belongs to program

**Why junction table:**
- Supports multi-parent relationships (issue in multiple projects)
- Cleaner than nullable FK columns
- Metadata per association (e.g., position, added_by)

---

## 3. Document History

Audit trail tracking all field changes.

```sql
CREATE TABLE document_history (
  id SERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES users(id),
  automated_by TEXT,  -- 'claude' for Claude Code changes
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Use cases:**
- Activity timeline on documents
- Analytics (time in state, who changed what)
- Compliance auditing

---

## 4. Document Links

Tracks backlinks between documents (when one doc mentions another).

```sql
CREATE TABLE document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id)
);
```

---

## 5. Files Table

Document attachments stored in S3.

```sql
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  s3_key TEXT NOT NULL,        -- S3 object key (or local path for dev)
  cdn_url TEXT,                -- CloudFront URL after processing
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Notes:**
- Files are NOT stored in database, only references
- Actual files in S3 or compatible blob storage
- `status` tracks upload progress

---

## 6. Sessions and Auth

### Sessions Table

Cookie-based auth with strict timeouts.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,  -- Hex string, not UUID for enhanced security
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  user_agent TEXT,
  ip_address TEXT
);
```

**Timeout rules:**
- 15-minute inactivity timeout (last_activity)
- 12-hour absolute timeout (expires_at)

### API Tokens Table

Long-lived tokens for CLI/programmatic access.

```sql
CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,           -- User-provided name (e.g., "Claude Code")
  token_hash TEXT NOT NULL,     -- SHA-256 hash (never store plain token)
  token_prefix TEXT NOT NULL,   -- First 8 chars for identification
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,       -- NULL = never expires
  revoked_at TIMESTAMPTZ,       -- NULL = active
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, workspace_id, name)
);
```

**Token format:** `ship_{random_32_bytes_hex}`

---

## 7. Workspaces

Multi-tenant isolation.

```sql
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sprint_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Key concept:** `sprint_start_date` (historical field name) is the anchor for computing week windows. Week N = days (N-1)*7 to N*7-1 from start date.

---

## 8. Users and Authorization

### Users Table

Global identity (users can belong to multiple workspaces).

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,           -- NULL if using PIV-only auth
  name TEXT NOT NULL,
  is_super_admin BOOLEAN DEFAULT FALSE,
  last_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  last_auth_provider TEXT,      -- 'password', 'piv', 'oauth'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Workspace Memberships

Authorization layer (separate from content).

```sql
CREATE TABLE workspace_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);
```

**Critical separation:**
- `workspace_memberships` = Authorization (who can access)
- `documents WHERE document_type = 'person'` = Content (user profile)
- Person docs link to users via `properties.user_id`

### Workspace Invites

```sql
CREATE TABLE workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 9. Week Iterations (historical table name: sprint_iterations)

Claude Code work session tracking.

```sql
-- Table name retained for historical compatibility
CREATE TABLE sprint_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  story_id TEXT,                -- External PRD story ID
  story_title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'in_progress')),
  what_attempted TEXT,
  blockers_encountered TEXT,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Use cases:**
- Real-time `/work` progress visibility
- Week velocity analysis
- Learning extraction from failed attempts

---

## 10. Audit Logs

Compliance-grade action logging.

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  impersonating_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Migrations

Schema changes are managed via numbered migration files in `api/src/db/migrations/`.

**Rules:**
- Files named `NNN_description.sql` (e.g., `003_document_history.sql`)
- Migrations run automatically on deploy via `api/src/db/migrate.ts`
- `schema_migrations` table tracks applied migrations
- Each migration runs in a transaction with rollback on failure
- **Never modify schema.sql directly for existing tables** - use migrations

**Current migrations (45 files):**
- 001-013: Initial properties, person decoupling, history, visibility, oauth, PIV support
- 014-022: API tokens, sprint iterations, associations, document conversion
- 023-033: Snapshots, issue iterations, goal→plan renames, sprint→week terminology
- 034-040: Weekly accountability, comments, search index, access guards

---

## Key Design Principles

1. **Everything is a document** - No separate tables for different content types
2. **Properties in JSONB** - Type-specific data without schema migrations
3. **Authorization separate from content** - `workspace_memberships` vs `person` documents
4. **Weeks are computed** - Dates derived from `sprint_number` (historical field) + workspace start date
5. **Junction tables for relationships** - `document_associations` enables multi-parent
6. **Audit everything** - `document_history` and `audit_logs` for compliance
