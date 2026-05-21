# Ship Architecture

Comprehensive architecture documentation for the Ship project management application with real-time collaboration.

## System Overview

Ship is a government-focused project management application built for teams that need real-time collaborative editing, offline-tolerant operation, and Section 508 accessibility compliance. It follows Notion's "everything is a document" paradigm where all content types (wikis, issues, programs, projects, weeks) share a unified data structure.

**Core Purpose:**
- Project and week-based planning with real-time collaboration
- Unified document model for consistent UX across content types
- Offline-tolerant architecture (works on planes/subways)
- Government compliance (Section 508, PIV authentication support)

## Monorepo Structure

Ship uses a pnpm workspace monorepo with three packages:

```
ship/
├── api/                    # Express backend
│   ├── src/
│   │   ├── routes/         # REST endpoints (documents, issues, weeks, etc.)
│   │   ├── db/             # PostgreSQL client + schema
│   │   ├── collaboration/  # WebSocket + Yjs handlers
│   │   ├── middleware/     # Auth, CSRF, visibility checks
│   │   └── index.ts        # Entry point
│
├── web/                    # React frontend
│   ├── src/
│   │   ├── components/     # UI components (Editor, SelectableList, etc.)
│   │   ├── pages/          # Route pages
│   │   ├── hooks/          # Custom hooks (useDocumentsQuery, etc.)
│   │   ├── lib/            # Utilities (queryClient, api helpers)
│   │   └── main.tsx        # Entry point
│
├── shared/                 # Shared TypeScript types
│   └── src/
│       ├── types/          # Document, User, Workspace types
│       └── constants.ts    # Session timeouts, shared constants
```

**Package Responsibilities:**

| Package | Purpose | Key Files |
|---------|---------|-----------|
| `api/` | REST API, WebSocket collaboration, database access | `api/src/index.ts:1-44`, `api/src/collaboration/index.ts` |
| `web/` | React SPA with TipTap editor | `web/src/components/Editor.tsx`, `web/src/main.tsx` |
| `shared/` | TypeScript types imported by both api and web | `shared/src/types/document.ts:34-45` |

## Unified Document Model

The central architectural pattern: **everything is a document with properties**.

### Document Types

All content lives in a single `documents` table with a `document_type` discriminator:

```sql
-- api/src/db/schema.sql:83-87
-- Note: document_type enum uses 'sprint' for historical compatibility
CREATE TYPE document_type AS ENUM (
  'wiki', 'issue', 'program', 'project', 'sprint',
  'person', 'sprint_plan', 'sprint_retro'
);
```

| Type | Description | Key Properties |
|------|-------------|----------------|
| `wiki` | Documentation pages | maintainer_id |
| `issue` | Work items (tasks/bugs) | state, priority, assignee_id, ticket_number |
| `program` | Long-lived product/initiative | color, emoji |
| `project` | Time-bounded deliverable | impact, confidence, ease (ICE scores), owner_id |
| `sprint` | Week container (historical DB name for "week") | sprint_number, owner_id |
| `person` | User profile document | email, role, capacity_hours |

### Document Schema

```typescript
// shared/src/types/document.ts:159-190
interface Document {
  id: string;                    // UUID
  workspace_id: string;
  document_type: DocumentType;
  title: string;                 // Always "Untitled" for new docs
  content: Record<string, unknown>;  // TipTap JSON
  yjs_state?: Uint8Array;        // CRDT state for collaboration

  // Hierarchy column
  parent_id?: string | null;
  // Program/project/week membership lives in document_associations.

  // Type-specific properties (JSONB)
  properties: Record<string, unknown>;

  // Visibility
  visibility: 'private' | 'workspace';
}
```

### Properties System

Properties use schema-less JSONB with TypeScript enforcement:

```typescript
// shared/src/types/document.ts:60-68
interface IssueProperties {
  state: IssueState;        // 'triage' | 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled'
  priority: IssuePriority;  // 'low' | 'medium' | 'high' | 'urgent'
  assignee_id?: string;
  estimate?: number;
  source: IssueSource;      // 'internal' | 'external'
  [key: string]: unknown;   // Custom properties allowed
}
```

**Why JSONB:** Custom properties without schema migrations. TypeScript provides compile-time safety. GIN index on `properties` column for efficient queries.

## 4-Panel Editor Layout

Every document editor uses a consistent 4-panel layout:

```
┌──────┬────────────────┬─────────────────────────────────┬────────────────┐
│      │                │ Header: ← Badge Title    Saved ●│                │
│ Icon │   Contextual   ├─────────────────────────────────┤   Properties   │
│ Rail │    Sidebar     │                                 │    Sidebar     │
│      │                │   Large Title                   │                │
│ 48px │    224px       │   Body content...               │     256px      │
│      │  (mode list)   │                                 │  (doc props)   │
│      │                │         (flex-1)                │                │
└──────┴────────────────┴─────────────────────────────────┴────────────────┘
```

| Panel | Width | Purpose |
|-------|-------|---------|
| **Icon Rail** | 48px | Mode icons (Docs, Issues, Projects, Team), Settings |
| **Contextual Sidebar** | 224px | List of items for active mode with + button |
| **Main Content** | flex-1 | Header + TipTap Editor |
| **Properties Sidebar** | 256px | Type-specific properties (status, assignee, etc.) |

**Key Rules:**
- All four panels always visible when editing
- Properties sidebar content varies by document type via `sidebar` prop on Editor
- See `web/src/components/Editor.tsx:103-123` for prop interface

## Real-time Collaboration

### Architecture Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **CRDT** | Yjs | Conflict-free collaborative data type |
| **Transport** | WebSocket (y-websocket) | Real-time sync |
| **Editor** | TipTap | Rich text with Yjs integration |
| **Persistence** | y-indexeddb | Client-side caching for instant load |

### Collaboration Flow

```
┌─────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Client A  │      │  Server (WS)    │      │   Client B      │
│  (TipTap)   │      │  (Yjs sync)     │      │  (TipTap)       │
└──────┬──────┘      └────────┬────────┘      └────────┬────────┘
       │                      │                        │
       │  Yjs sync message    │                        │
       │─────────────────────>│                        │
       │                      │  Broadcast update      │
       │                      │───────────────────────>│
       │                      │                        │
       │                      │  Persist to PostgreSQL │
       │                      │  (debounced 2s)        │
       │                      │                        │
```

### Server Implementation

```typescript
// api/src/collaboration/index.ts:598-720 (key sections)
export function setupCollaboration(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    // 1. Validate session from cookie
    const sessionData = await validateWebSocketSession(request);
    if (!sessionData) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 2. Check document access (visibility)
    const canAccess = await canAccessDocumentForCollab(docId, sessionData.userId, sessionData.workspaceId);

    // 3. Handle upgrade and emit connection
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, docName, sessionData);
    });
  });
}
```

### Client Implementation

```typescript
// web/src/components/Editor.tsx:197-329 (simplified)
useEffect(() => {
  // 1. Load from IndexedDB first (instant)
  const indexeddbProvider = new IndexeddbPersistence(`ship-${roomPrefix}-${documentId}`, ydoc);

  // 2. Connect WebSocket after cache loads
  waitForCache.then(() => {
    wsProvider = new WebsocketProvider(wsUrl, `${roomPrefix}:${documentId}`, ydoc);

    // Track sync status
    wsProvider.on('status', (event) => {
      setSyncStatus(event.status === 'connected' ? 'synced' : 'disconnected');
    });

    // Setup awareness for presence
    wsProvider.awareness.setLocalStateField('user', { name: userName, color });
  });
}, [documentId]);
```

### Room Naming Convention

Documents connect to rooms by type prefix:
- `doc:{uuid}` - Wiki documents
- `issue:{uuid}` - Issues
- `program:{uuid}` - Programs
- `project:{uuid}` - Projects
- `sprint:{uuid}` - Weeks (historical room prefix)

## Data Flow

### Request Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (React)                           │
├─────────────────────────────────────────────────────────────────┤
│  TanStack Query                     │  Yjs (Editor)             │
│  - Stale-while-revalidate cache     │  - Y.Doc (in-memory)      │
│  - Optimistic updates + rollback    │  - CRDT operations        │
│  ↕                                  │  ↕                        │
│  IndexedDB Persister                │  y-indexeddb              │
│  (cache persists across sessions)   │  (doc persists)           │
│  ↕                                  │  ↕                        │
│  REST API (/api/*)                  │  WebSocket (/collaboration)│
├─────────────────────────────────────────────────────────────────┤
│                    PostgreSQL (source of truth)                  │
└─────────────────────────────────────────────────────────────────┘
```

### Caching Architecture

**Two-Layer Model:**

| Layer | Data Type | Technology | Behavior |
|-------|-----------|------------|----------|
| **Editor Content** | Yjs documents | y-indexeddb | Instant load + offline editing |
| **Lists/Metadata** | Documents, issues | TanStack Query + IndexedDB | Stale-while-revalidate |

```typescript
// web/src/lib/queryClient.ts:136-174 (key config)
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,      // 5 minutes
      gcTime: 1000 * 60 * 60 * 24,   // 24 hours
    },
  },
});

// IndexedDB persister for cross-session cache
const queryStore = createStore('ship-query-cache', 'queries');
export const queryPersister = createIDBPersister();
```

### Mutation Pattern

```typescript
// Optimistic updates with rollback on error
const mutation = useMutation({
  mutationFn: createDocument,
  onMutate: async (newDoc) => {
    const previousDocs = queryClient.getQueryData(['documents']);
    queryClient.setQueryData(['documents'], (old) => [...old, optimisticDoc]);
    return { previousDocs };
  },
  onError: (_err, _newDoc, context) => {
    // Rollback on error
    queryClient.setQueryData(['documents'], context.previousDocs);
  },
  onSettled: () => queryClient.invalidateQueries(['documents']),
});
```

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Runtime** | Node.js | JavaScript everywhere |
| **API Framework** | Express | Battle-tested, simple |
| **Frontend** | React + Vite | Fast dev, TipTap ecosystem |
| **Database** | PostgreSQL | Reliable, direct SQL |
| **DB Client** | pg (raw SQL) | No ORM abstraction |
| **Rich Text** | TipTap + Yjs | Collaborative editing |
| **State** | TanStack Query | Server state caching |
| **UI Components** | shadcn/ui | Tailwind + Radix |
| **Secrets** | SSM Parameter Store | AWS-native, gov-compliant |

**Key Decisions:**
- **pg over ORM:** Maximum simplicity, full SQL control
- **Express over Fastify:** "Boring technology" - everyone knows it
- **shadcn/ui:** Copy-paste ownership, Radix accessibility

## Key Architectural Decisions

### 1. Everything is a Document

All content types share the same structure. Type differentiation via `document_type` field and `properties` JSONB.

**Why:** Consistent UX, single code path, flexible custom properties.

### 2. Server is Source of Truth

Offline-tolerant, not offline-first. Mutations require network; optimistic updates roll back on error.

**Why:** Simpler than offline mutation queues. Editor content (Yjs) still works offline via y-indexeddb.

### 3. Computed Week Dates/Status

Week dates computed from `sprint_number` (historical field name) + workspace `sprint_start_date`. Status computed from dates.

```typescript
// shared/src/types/document.ts:341-366
export function computeWeekDates(sprintNumber: number, workspaceStartDate: Date) {
  const start = new Date(workspaceStartDate);
  start.setDate(start.getDate() + (sprintNumber - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}
```

**Why:** YAGNI - don't store what you can compute. Single source of truth.

### 4. Session-Based Auth with 15-Minute Timeout

Government compliance requires strict session management.

```sql
-- api/src/db/schema.sql:68-80
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,          -- Hex string from crypto.randomBytes
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ DEFAULT now()
);
```

### 5. Properties in JSONB, Associations in Junction Table

`parent_id` is the hierarchy column. Program, project, and week membership use `document_associations`. Type-specific properties go in JSONB.

```sql
-- api/src/db/schema.sql
parent_id UUID REFERENCES documents(id) ON DELETE CASCADE,
properties JSONB DEFAULT '{}',
```

### 6. Rate Limiting on WebSocket

Protection against connection floods and message spam.

```typescript
// api/src/collaboration/index.ts:17-24
const RATE_LIMIT = {
  CONNECTION_WINDOW_MS: 60_000,     // 1 minute
  MAX_CONNECTIONS_PER_IP: 30,       // 30 per minute per IP
  MESSAGE_WINDOW_MS: 1_000,         // 1 second
  MAX_MESSAGES_PER_SECOND: 50,      // 50 per second per connection
};
```

## File References

| Concern | Primary Files |
|---------|--------------|
| Database Schema | `api/src/db/schema.sql` |
| API Entry | `api/src/index.ts` |
| Collaboration Server | `api/src/collaboration/index.ts` |
| Editor Component | `web/src/components/Editor.tsx` |
| Query Client | `web/src/lib/queryClient.ts` |
| Type Definitions | `shared/src/types/document.ts` |
| REST Routes | `api/src/routes/*.ts` |

## Related Documentation

- `docs/unified-document-model.md` - Data model details
- `docs/application-architecture.md` - Full tech stack decisions
- `docs/document-model-conventions.md` - Terminology, UI patterns
- `docs/week-documentation-philosophy.md` - Week workflow and documentation philosophy
