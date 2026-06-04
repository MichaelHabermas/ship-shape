# New Developer Onboarding Guide

Welcome to Ship - a collaborative project management application with real-time editing capabilities.

## Prerequisites

### Required Software

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 20+ | Runtime for API and build tools |
| **pnpm** | 9+ | Package manager (monorepo workspaces) |
| **PostgreSQL** | 14+ | Database (local installation, not Docker) |

### Environment Setup

1. Install PostgreSQL locally:
   ```bash
   # macOS
   brew install postgresql@14
   brew services start postgresql@14
   ```

2. Verify PostgreSQL is running:
   ```bash
   psql -l  # Should list databases
   ```

## Getting Started

### Initial Setup

```bash
# Clone the repository
git clone <repo-url> ship
cd ship

# Install dependencies
pnpm install

# Start development servers
pnpm dev
```

### What `pnpm dev` Does

The `scripts/dev.sh` script handles setup automatically:

1. Creates `api/.env.local` with DATABASE_URL if missing
2. Creates database (e.g., `ship_auth_jan_6`) if it does not exist
3. Runs migrations and seeds on fresh databases
4. Finds available ports (API: 3000+, Web: 5173+)
5. Starts both servers in parallel

After running, you will see:
- **API**: http://localhost:3000
- **Web**: http://localhost:5173

## Key Files to Read First

Read these files in order to understand the codebase:

| File | Purpose |
|------|---------|
| `.claude/CLAUDE.md` | Development commands, patterns, conventions |
| `docs/unified-document-model.md` | Core data model - everything is a document |
| `docs/application-architecture.md` | Tech stack, deployment, testing strategy |
| `docs/document-model-conventions.md` | Terminology, UI patterns, 4-panel layout |
| `api/src/db/schema.sql` | Database schema - single source of truth |

## Understanding the Codebase

### Monorepo Structure

```
ship/
├── api/                    # Express backend
│   ├── src/
│   │   ├── routes/         # REST endpoints
│   │   ├── db/             # Database client + schema + migrations
│   │   ├── collaboration/  # WebSocket + Yjs handlers
│   │   └── middleware/     # Auth, etc.
│   └── package.json
│
├── web/                    # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/          # Route pages
│   │   ├── hooks/          # Custom hooks
│   └── package.json
│
├── shared/                 # Shared TypeScript types
│   └── src/
│       └── types/
│
└── package.json            # Workspace root
```

### Unified Document Model

**Core concept:** Everything is a document with properties. Following Notion's paradigm, the difference between a "wiki page" and an "issue" is the properties and workflows - not the data structure.

Document types stored in `document_type` field:
- `wiki` - Documentation pages
- `issue` - Work items (tracked tasks)
- `program` - Products/initiatives
- `project` - Time-bounded deliverables
- `sprint` - Week containers (historical DB name for "week")
- `person` - User profiles

Key relationships:
- `program_id` - Which program a document belongs to
- `project_id` - Which project an issue belongs to
- `parent_id` - Document hierarchy
- Week assignments use the `document_associations` table (the `sprint_id` column was dropped by migration 027)

### 4-Panel Editor Layout

Every document editor follows this canonical layout:

```
┌──────┬────────────────┬─────────────────────────────────┬────────────────┐
│ Icon │   Contextual   │                                 │   Properties   │
│ Rail │    Sidebar     │        Main Content             │    Sidebar     │
│ 48px │    224px       │         (flex-1)                │     256px      │
└──────┴────────────────┴─────────────────────────────────┴────────────────┘
```

All four panels are always visible when editing a document.

## Common Developer Tasks

### Adding a New API Endpoint

1. Create or edit route file in `api/src/routes/`:
   ```typescript
   // api/src/routes/my-resource.ts
   import { Router } from 'express';
   import { pool } from '../db/client';
   import { authMiddleware } from '../middleware/auth';

   const router = Router();

   router.get('/', authMiddleware, async (req, res) => {
     const { workspaceId } = req.session;
     const result = await pool.query(
       'SELECT * FROM documents WHERE workspace_id = $1',
       [workspaceId]
     );
     res.json(result.rows);
   });

   export default router;
   ```

2. Register in `api/src/index.ts`:
   ```typescript
   import myResourceRouter from './routes/my-resource';
   app.use('/api/my-resource', myResourceRouter);
   ```

### Creating a New Document Type

1. **Add to enum** in `api/src/db/schema.sql` (reference only - use migration):
   ```sql
   ALTER TYPE document_type ADD VALUE 'my_new_type';
   ```

2. **Create migration** in `api/src/db/migrations/`:
   ```sql
   -- NNN_add_my_new_type.sql
   ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'my_new_type';
   ```

3. **Add TypeScript types** in `shared/src/types/`:
   ```typescript
   export interface MyNewTypeProperties {
     custom_field: string;
   }
   ```

4. **Create properties sidebar** in `web/src/components/sidebars/`:
   ```typescript
   // MyNewTypeSidebar.tsx
   export function MyNewTypeSidebar({ document }: Props) {
     // Render type-specific properties
   }
   ```

### Adding a TipTap Extension

TipTap extensions live in `web/src/components/editor/`:

```typescript
// web/src/components/editor/extensions/MyExtension.ts
import { Extension } from '@tiptap/core';

export const MyExtension = Extension.create({
  name: 'myExtension',

  addCommands() {
    return {
      myCommand: () => ({ commands }) => {
        // Extension logic
      },
    };
  },
});
```

Register in the Editor component's extensions array.

### Writing Database Migrations

Schema changes must be in numbered migration files:

```
api/src/db/migrations/
├── 001_properties_jsonb.sql
├── 002_person_membership_decoupling.sql
└── NNN_your_migration.sql
```

Migration file pattern:
```sql
-- api/src/db/migrations/NNN_description.sql

-- Add new column
ALTER TABLE documents ADD COLUMN new_field TEXT;

-- Create new index
CREATE INDEX IF NOT EXISTS idx_documents_new_field ON documents(new_field);
```

**Never modify `schema.sql` directly for existing tables.** Migrations run automatically on deploy via `api/src/db/migrate.ts`.

## Development Workflow

### Available Commands

```bash
# Development
pnpm dev              # Start API + Web servers in parallel
pnpm dev:api          # API only (port 3000)
pnpm dev:web          # Web only (port 5173)

# Building
pnpm build            # Build all packages
pnpm build:shared     # Build shared types (required before api/web)

# Type checking
pnpm type-check       # Check all packages

# Database
pnpm db:migrate       # Run database migrations
pnpm db:seed          # Seed with test data

# Unit tests
pnpm test             # Run API unit tests via vitest
```

### Running E2E Tests

**Always use the `/e2e-test-runner` skill** — if unavailable, use `pnpm test:e2e:run`. Never run `pnpm test:e2e` directly. The skill and fallback handle:
- Background execution (prevents output explosion)
- Progress tracking via `test-results/summary.json`
- Iterative fixing with `--last-failed`

### Working with Git Worktrees

For parallel development, use git worktrees:

```bash
# Create a new worktree for a feature
git worktree add ../ship-feature-x feature-x

# Each worktree gets its own database and ports
cd ../ship-feature-x
pnpm dev  # Auto-creates ship_feature_x database
```

The `scripts/dev.sh` script automatically handles:
- Unique database names per worktree
- Available port detection
- `.ports` file for port reference

## Where to Find Help

### Documentation

| Location | Content |
|----------|---------|
| `docs/` | Architecture decisions, data model, conventions |
| `.claude/CLAUDE.md` | Commands, patterns, philosophy |
| `.claude/rules/` | Claude-specific rules and skills |

### Finding Examples

When implementing something new, search for similar existing code:

```bash
# Find route patterns
ls api/src/routes/*.ts

# Find component patterns
ls web/src/components/

# Search for specific patterns
grep -r "useQuery" web/src/hooks/
```

### Key Patterns to Follow

1. **REST endpoints**: Follow patterns in `api/src/routes/documents/index.ts`
2. **React hooks**: Follow patterns in `web/src/hooks/useDocumentsQuery.ts`
3. **Components**: Follow patterns in `web/src/components/Editor.tsx`
4. **Migrations**: Follow patterns in `api/src/db/migrations/`

### Philosophy Enforcement

Run `/ship-philosophy-reviewer` to audit changes against Ship's core philosophy:
- Everything is a document (no new content tables)
- Reuse `Editor` component (no type-specific editors)
- `"Untitled"` for all new docs (not "Untitled Issue")
- YAGNI, boring technology, 4-panel layout

## Quick Reference

### Database Access

Ship uses raw SQL via `pg` (no ORM):

```typescript
import { pool } from '../db/client';

// Query
const result = await pool.query(
  'SELECT * FROM documents WHERE id = $1',
  [documentId]
);

// Insert
await pool.query(
  `INSERT INTO documents (workspace_id, document_type, title)
   VALUES ($1, $2, $3) RETURNING *`,
  [workspaceId, 'wiki', 'Untitled']
);
```

### Authentication

Session-based auth with 15-minute timeout:

```typescript
// In routes, use authMiddleware
router.get('/protected', authMiddleware, async (req, res) => {
  const { userId, workspaceId } = req.session;
  // ...
});
```

### Frontend State

- **Server state**: TanStack Query with IndexedDB persistence
- **UI state**: React context and component state
- **Editor content**: Yjs CRDTs via y-indexeddb

### Real-Time Collaboration

WebSocket connection at `/collaboration/{documentType}:{docId}`:

```typescript
// Room name uses document_type (legacy "doc:" accepted for wiki only)
const wsProvider = new WebsocketProvider(wsUrl, `${documentType}:${documentId}`, ydoc);
```

## Troubleshooting

### Database Issues

```bash
# Check if PostgreSQL is running
brew services list | grep postgresql

# Connect to database manually
psql postgresql://localhost/ship_<your_worktree>

# Reset database (destructive)
dropdb ship_<your_worktree>
rm api/.env.local
pnpm dev  # Recreates everything
```

### Port Conflicts

If ports are in use, `pnpm dev` automatically finds available ones. Check `.ports` file for assigned ports.

### Type Errors After Pulling

```bash
# Rebuild shared types
pnpm build:shared

# Then restart dev servers
pnpm dev
```

### Migration Errors

Migrations track state in `schema_migrations` table. To check applied migrations:

```sql
SELECT * FROM schema_migrations ORDER BY applied_at;
```
