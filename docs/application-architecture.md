# Application Architecture

This document describes the application architecture for the Ship greenfield rebuild.

> **Related**: See [Unified Document Model](./unified-document-model.md) for data model and [Document Model Conventions](./document-model-conventions.md) for terminology.

## Design Principles

1. **Maximally simple** - Avoid complexity until proven necessary
2. **Boring technology** - Use well-understood tools over cutting-edge
3. **Single codebase** - One repo, shared types, unified tooling
4. **Server is source of truth** - Offline-tolerant, not offline-first

## Tech Stack

| Layer              | Technology               | Rationale                                 |
| ------------------ | ------------------------ | ----------------------------------------- |
| **Runtime**        | Node.js                  | JavaScript everywhere, large ecosystem    |
| **API Framework**  | Express                  | Battle-tested, simple, ubiquitous         |
| **Frontend**       | React + Vite             | Fast dev experience, TipTap/Yjs ecosystem |
| **Database**       | PostgreSQL               | Reliable, feature-rich, direct SQL        |
| **DB Client**      | pg (raw SQL)             | Maximum simplicity, no abstraction        |
| **Client Storage** | IndexedDB (y-indexeddb)  | Editor content cache (implemented)        |
| **Real-time**      | WebSocket (y-websocket)  | Yjs sync for collaborative editing        |
| **Rich Text**      | TipTap + Yjs             | Offline-tolerant via IndexedDB cache      |
| **State Mgmt**     | TanStack Query           | Caching, optimistic updates, persistence  |
| **UI Components**  | shadcn/ui                | Tailwind + Radix, copy-paste ownership    |
| **Router**         | React Router v7          | Boring, ubiquitous, works with Vite       |
| **Forms**          | React Hook Form          | Performant, good validation               |
| **Dates**          | date-fns                 | Modular, tree-shakeable, immutable        |
| **i18n**           | react-i18next            | Structured for future translations        |
| **Secrets**        | SSM Parameter Store      | AWS-native, gov-compliant                 |

## Repository Structure

Single repo with separate builds:

```
ship/
├── api/                    # Express backend
│   ├── src/
│   │   ├── routes/         # REST endpoints
│   │   ├── db/             # Database client + schema
│   │   ├── collaboration/  # WebSocket + Yjs handlers
│   │   ├── middleware/     # Auth, etc.
│   │   └── index.ts        # Entry point
│   ├── package.json
│   └── tsconfig.json
│
├── web/                    # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/          # Route pages
│   │   ├── hooks/          # Custom hooks
│   │   ├── stores/         # Zustand stores
│   │   ├── db/             # IndexedDB access
│   │   └── main.tsx        # Entry point
│   ├── package.json
│   └── vite.config.ts
│
├── shared/                 # Shared code
│   ├── types/              # TypeScript types
│   └── constants/          # Shared constants
│
├── package.json            # Workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## API Architecture

### Express Server

Single Express process handles both REST and WebSocket:

```typescript
// api/src/index.ts
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// REST routes
app.use("/api/documents", documentsRouter);
app.use("/api/programs", programsRouter);
app.use("/api/auth", authRouter);

// WebSocket for real-time
wss.on("connection", handleConnection);

server.listen(3000);
```

### Database Access (pg)

Direct SQL queries for maximum simplicity:

```typescript
// api/src/db/pool.ts
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// api/src/db/documents.ts
import { pool } from "./pool";

export async function getDocument(id: string) {
  const result = await pool.query(
    "SELECT * FROM documents WHERE id = $1",
    [id]
  );
  return result.rows[0];
}

export async function createDocument(doc: NewDocument) {
  const result = await pool.query(
    `INSERT INTO documents (workspace_id, document_type, title, content, properties)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [doc.workspace_id, doc.document_type, doc.title, doc.content, doc.properties]
  );
  return result.rows[0];
}
```

### REST API Design

Simple RESTful endpoints:

| Method | Endpoint             | Description                   |
| ------ | -------------------- | ----------------------------- |
| GET    | `/api/documents`     | List documents (with filters) |
| GET    | `/api/documents/:id` | Get single document           |
| POST   | `/api/documents`     | Create document               |
| PATCH  | `/api/documents/:id` | Update document               |
| DELETE | `/api/documents/:id` | Delete document               |
| GET    | `/api/programs`      | List programs                 |

The `/docs` UI filters loaded documents by title on the client. Ship does not expose `/api/search/documents`; server search endpoints are reserved for narrower workflows such as mentions and learning lookup.

### WebSocket Protocol

For real-time collaboration (TipTap/Yjs) and presence:

```typescript
// Message types
type WSMessage =
  | { type: "yjs-sync"; docId: string; update: Uint8Array }
  | { type: "presence-join"; docId: string; user: User }
  | { type: "presence-leave"; docId: string; userId: string }
  | { type: "doc-update"; docId: string; changes: Change[] };
```

## Frontend Architecture

### State Management

#### TanStack Query + IndexedDB Persistence

Server state uses TanStack Query with IndexedDB persistence for stale-while-revalidate caching:

```typescript
// web/src/hooks/useDocumentsQuery.ts
const { data: documents } = useQuery({
  queryKey: ["documents", "wiki"],
  queryFn: () => fetchDocuments("wiki"),
  staleTime: 1000 * 60 * 5, // 5 minutes
  refetchOnMount: 'always',
});

// Mutations with optimistic updates + rollback on error
const mutation = useMutation({
  mutationFn: createDocument,
  onMutate: async (newDoc) => {
    await queryClient.cancelQueries({ queryKey: documentKeys.lists() });
    const previousDocs = queryClient.getQueryData(documentKeys.wikiList());
    // Optimistic update - show immediately with temp ID
    queryClient.setQueryData(documentKeys.wikiList(), (old) => [optimisticDoc, ...old]);
    return { previousDocs, optimisticId };
  },
  onError: (_err, _newDoc, context) => {
    // Rollback on error
    if (context?.previousDocs) {
      queryClient.setQueryData(documentKeys.wikiList(), context.previousDocs);
    }
  },
  onSuccess: (data, _variables, context) => {
    // Replace temp ID with real ID
    queryClient.setQueryData(documentKeys.wikiList(), (old) =>
      old?.map(d => d.id === context.optimisticId ? data : d)
    );
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: documentKeys.lists() }),
});
```

**IndexedDB Persistence** - Query cache persists across sessions:

```typescript
// web/src/lib/queryClient.ts
import { createStore, get, set, del } from 'idb-keyval';

const queryStore = createStore('ship-query-cache', 'queries');

export const queryPersister: Persister = {
  persistClient: (client) => set('tanstack-query', client, queryStore),
  restoreClient: () => get('tanstack-query', queryStore),
  removeClient: () => del('tanstack-query', queryStore),
};
```

**Zustand** for UI-only state (unchanged):

```typescript
// Minimal UI state - does not need offline persistence
const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  currentMode: "programs",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

### Caching Strategy

**Design Philosophy**: Stale-while-revalidate - fast page loads from cache, background refresh.

**Model**: Server is source of truth, optimistic updates with rollback on error.

#### Two-Layer Caching Architecture

| Layer | Data Type | Technology | Behavior |
|-------|-----------|------------|----------|
| **Editor Content** | Yjs documents | y-indexeddb | Content cached locally for instant load + offline editing |
| **Lists/Metadata** | Documents, issues, programs | TanStack Query + IndexedDB | Stale-while-revalidate caching |

#### Layer 1: Editor Content (Yjs)

Collaborative document editing uses Yjs CRDTs with IndexedDB persistence:

```typescript
// web/src/components/Editor.tsx
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';

// IndexedDB caches content locally - loads instantly
const indexeddbProvider = new IndexeddbPersistence(`ship-${roomPrefix}-${documentId}`, ydoc);

// WebSocket syncs with server - handles real-time collaboration
const wsProvider = new WebsocketProvider(wsUrl, `${roomPrefix}:${documentId}`, ydoc);
```

**How it works:**
1. **Open document**: IndexedDB loads cached content instantly
2. **WebSocket connects**: Merges server changes via CRDT
3. **Edit offline**: Changes saved to IndexedDB
4. **Reconnect**: Yjs auto-merges local + server changes

#### Layer 2: Lists/Metadata (TanStack Query)

Document lists and metadata use TanStack Query with IndexedDB persistence:

```
┌─────────────────────────────────────────────────────────────┐
│                        Architecture                          │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (React Components)                                │
├─────────────────────────────────────────────────────────────┤
│  TanStack Query                     │  Yjs (Editor)         │
│  - Stale-while-revalidate cache     │  - Y.Doc (in-memory)  │
│  - Optimistic updates + rollback    │  - CRDT operations    │
│  ↕                                  │  ↕                    │
│  IndexedDB Persister                │  y-indexeddb          │
│  (cache persists across sessions)   │  (doc persists)       │
│  ↕                                  │  ↕                    │
│  REST API (/api/*)                  │  WebSocket (/collab)  │
├─────────────────────────────────────────────────────────────┤
│                    PostgreSQL (source of truth)              │
└─────────────────────────────────────────────────────────────┘
```

**Mutation pattern (optimistic updates with rollback):**

```typescript
const mutation = useMutation({
  mutationFn: createDocument,
  onMutate: async (newDoc) => {
    // Cancel queries, save previous state, update cache optimistically
    const previousDocs = queryClient.getQueryData(['documents']);
    queryClient.setQueryData(['documents'], (old) => [...old, newDoc]);
    return { previousDocs };
  },
  onError: (_err, _newDoc, context) => {
    // Rollback on error - restore previous state
    queryClient.setQueryData(['documents'], context.previousDocs);
  },
  onSettled: () => queryClient.invalidateQueries(['documents']),
});
```

**Error handling:** Global mutation error listener shows toast notifications when operations fail.

**No offline writes:** Mutations require network connectivity. If offline, the mutation fails and the optimistic update is rolled back. This keeps the architecture simple while providing instant UI feedback.

## Real-Time Collaboration

**Offline-tolerant editor** - editor content can persist locally through y-indexeddb, and collaboration resumes on reconnect. Metadata/list mutations do not queue offline.

### TipTap + Yjs Integration

```typescript
// web/src/components/Editor.tsx
const editor = useEditor({
  extensions: [
    StarterKit,
    Collaboration.configure({
      document: ydoc,
    }),
    CollaborationCursor.configure({
      provider: wsProvider,
    }),
  ],
});
```

### Presence

Show who's viewing/editing:

```typescript
// Presence state via Yjs Awareness
awareness.setLocalState({
  user: { id: currentUser.id, name: currentUser.name },
  cursor: null,
});
```

**Offline behavior**:

- Document opens with cached content (IndexedDB)
- No presence indicators when offline
- Editor content may be saved locally by y-indexeddb
- On reconnect: Yjs CRDT sync resumes and presence is restored
- Metadata/list mutations still require network connectivity and roll back on failure
- Network recovery and data preservation must be verified with E2E/runtime checks

## Authentication

### Session-Based (Browser)

**PIV/CAC primary, password fallback**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Flow                       │
│                                                              │
│  ┌─────────┐         ┌─────────────┐         ┌───────────┐  │
│  │ Browser │ ──────> │ CloudFront  │ ──────> │ ALB (mTLS)│  │
│  │ (PIV)   │  HTTPS  │             │         │           │  │
│  └─────────┘         └─────────────┘         └─────┬─────┘  │
│                                                    │         │
│                                              PIV cert        │
│                                              extracted       │
│                                                    │         │
│                                                    ▼         │
│                                              ┌───────────┐   │
│                                              │  Express  │   │
│                                              │  (auth)   │   │
│                                              └───────────┘   │
└─────────────────────────────────────────────────────────────┘
```

For non-PIV users (testing, external):

- Username/password authentication
- Session stored in secure cookie
- Configurable per environment

### API Tokens (Programmatic Access)

For CLI tools and automation (e.g., Claude Code integration):

**Token format:** `ship_<64 hex characters>`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/api-tokens` | POST | Generate new token (requires session auth) |
| `/api/api-tokens` | GET | List user's tokens (prefix only, never full token) |
| `/api/api-tokens/:id` | DELETE | Revoke a token |

**Security properties:**
- Tokens are SHA-256 hashed before storage (plaintext never stored)
- Token shown only once on creation - user must save immediately
- Soft-delete on revoke (audit trail preserved)
- Optional expiration (default: no expiry)
- CSRF protection skipped for Bearer token requests (not browser-vulnerable)

**Usage:**
```bash
# Configure in ~/.claude/.env
SHIP_API_TOKEN=ship_<your_token>
SHIP_API_URL=https://ship.example.com/api

# Use in requests
curl -H "Authorization: Bearer $SHIP_API_TOKEN" \
  "$SHIP_API_URL/api/issues"
```

## Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │     CloudFront Distribution   │
              │                              │
              │  /            → S3 (React)   │
              │  /api/*       → ALB          │
              │  /ws/*        → ALB          │
              └──────────────┬───────────────┘
                             │
              ┌──────────────┴───────────────┐
              │                              │
              ▼                              ▼
     ┌─────────────────┐           ┌─────────────────┐
     │   S3 Bucket     │           │      ALB        │
     │   (React app)   │           │   (mTLS opt)    │
     └─────────────────┘           └────────┬────────┘
                                            │
                                            ▼
                              ┌──────────────────────────┐
                              │  Elastic Beanstalk       │
                              │  (Docker / Node.js)      │
                              │                          │
                              │  ┌────────────────────┐  │
                              │  │  Express + WS      │  │
                              │  │  (single process)  │  │
                              │  └────────────────────┘  │
                              └────────────┬─────────────┘
                                           │
                              ┌────────────┴─────────────┐
                              │                          │
                              ▼                          ▼
                    ┌─────────────────┐       ┌─────────────────┐
                    │   PostgreSQL    │       │   S3 (files)    │
                    │   (Aurora)      │       │                 │
                    └─────────────────┘       └─────────────────┘
```

### Container

Single Docker container:

```dockerfile
# Dockerfile
FROM node:20-slim

WORKDIR /app
COPY api/dist ./dist
COPY api/package.json ./

RUN npm ci --production

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Infrastructure

- **Frontend**: S3 + CloudFront (static files)
- **API**: Elastic Beanstalk (Docker) or ECS Fargate
- **Database**: Aurora Serverless v2 (PostgreSQL)
- **Files**: S3 (attachments)

## Testing Strategy

**E2E-heavy approach** - test real user flows, not implementation details.

### Playwright E2E Tests

Primary testing strategy. **Chromium only** - Firefox/Safari add maintenance burden without meaningful coverage benefit for our use case.

```typescript
// e2e/documents.spec.ts
test("create and edit document", async ({ page }) => {
  await page.goto("/programs/auth");
  await page.click('[data-testid="new-document"]');
  await page.fill('[data-testid="document-title"]', "Test Doc");
  await page.click('[data-testid="save"]');
  await expect(page.locator(".document-title")).toHaveText("Test Doc");
});
```

```bash
# Run tests through the safe background runner
pnpm test:e2e:run

# Run specific test file
pnpm test:e2e:run e2e/weeks.spec.ts
```

For lane scripts, worker tuning, sharding, and result directory isolation, see `docs/claude-reference/testing.md`.

### Test Categories

| Category  | Scope                       | When to Run  |
| --------- | --------------------------- | ------------ |
| **Smoke** | Critical paths only         | Every commit |
| **E2E**   | All user flows              | PR merge     |
| **Unit**  | Complex business logic only | As needed    |

### Test Data

- Seed scripts for consistent test state
- Clean database before each E2E run
- No shared state between tests

## UI Components

**shadcn/ui** - Tailwind-based components with copy-paste ownership.

### Why shadcn/ui

- Copy components into codebase (not npm dependency)
- Full control over styling and behavior
- Radix primitives for accessibility
- Tailwind for consistent styling

### Component Structure

```
web/src/components/
├── ui/                    # shadcn/ui components (copied)
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── dropdown-menu.tsx
│   └── ...
├── documents/             # Feature components
│   ├── DocumentList.tsx
│   ├── DocumentEditor.tsx
│   └── ...
└── layout/                # Layout components
    ├── Sidebar.tsx
    └── Header.tsx
```

### Styling

```typescript
// Tailwind + cn() utility for conditional classes
import { cn } from "@/lib/utils";

<Button className={cn("w-full", isLoading && "opacity-50")} />;
```

## Accessibility

**Section 508 strict compliance** required for government deployment.

### Requirements

- WCAG 2.1 AA minimum
- Keyboard navigation for all interactions
- Screen reader support (NVDA, JAWS, VoiceOver)
- Focus management for modals/dialogs
- Color contrast ratios (4.5:1 text, 3:1 UI)

### Implementation

shadcn/ui (Radix primitives) helps with:

- Proper ARIA attributes
- Focus trapping in modals
- Keyboard shortcuts
- Screen reader announcements

These primitives do not prove Section 508/WCAG compliance by themselves; the app still needs axe, keyboard, screen reader, and contrast verification.

### Testing

- axe-core automated checks in E2E tests
- Manual screen reader testing before release
- Keyboard-only navigation testing

## Observability

**CloudWatch only** - AWS-native, government-compliant.

### Logging

```typescript
// Structured JSON logs
const logger = {
  info: (message: string, context?: object) =>
    console.log(JSON.stringify({ level: "info", message, ...context, timestamp: new Date().toISOString() })),
  error: (message: string, error?: Error, context?: object) =>
    console.error(
      JSON.stringify({
        level: "error",
        message,
        error: error?.message,
        stack: error?.stack,
        ...context,
        timestamp: new Date().toISOString(),
      })
    ),
};
```

### Metrics

- CloudWatch Container Insights for EB
- Custom metrics via AWS SDK when needed
- No external APM tools (gov restriction)

### Alerting

- CloudWatch Alarms for error rates
- SNS notifications to on-call
- No PagerDuty/OpsGenie (use email/SMS)

## Database Migrations

**Manual SQL + reviewed** - safe for government deployments.

### Migration Workflow

```bash
# 1. Create migration file
touch api/src/db/migrations/YYYYMMDD_migration_name.sql

# 2. Write SQL migration
cat api/src/db/migrations/20241230_add_sprint_number.sql

# 3. Test locally
psql $DATABASE_URL -f api/src/db/migrations/20241230_add_sprint_number.sql

# 4. PR review includes migration review

# 5. Run in production (manually or via deploy script)
```

### SQL Migration Example

```sql
-- api/src/db/migrations/20241230_add_sprint_number.sql

-- UP
ALTER TABLE documents ADD COLUMN sprint_number INTEGER;

-- DOWN (in separate rollback file or commented)
-- ALTER TABLE documents DROP COLUMN sprint_number;
```

For complex migrations, use a simple runner:

```typescript
// api/src/db/migrate.ts
import { pool } from "./pool";
import fs from "fs";
import path from "path";

async function migrate() {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await pool.query(sql);
    console.log(`Applied: ${file}`);
  }
}
```

### Safety Rules

- Write rollback SQL for every migration
- Test rollback locally before deploy
- No destructive changes without data backup
- Large data migrations run separately from schema changes

## Development

### Local Setup

```bash
# Install dependencies
pnpm install

# Start database
docker compose -f docker-compose.local.yml up -d postgres

# Run migrations
pnpm db:migrate

# Start dev servers (parallel)
pnpm dev
```

### Dev Server Ports

| Service         | Port |
| --------------- | ---- |
| Vite (frontend) | 5173 |
| Express (API)   | 3000 |
| PostgreSQL      | 5432 |

### Scripts

```json
{
  "dev": "./scripts/dev.sh",
  "build": "pnpm --recursive run build",
  "test": "pnpm --filter @ship/api test",
  "test:e2e:run": "./scripts/run-e2e.sh",
  "db:migrate": "pnpm --filter @ship/api db:migrate"
}
```

## Claude Code Integration

Ship integrates with Claude Code CLI for AI-assisted development workflows. See [Ship + Claude CLI Integration Guide](./ship-claude-cli-integration.md) for full documentation.

### Key Integration Points

| API Endpoint | Purpose | Claude Workflow |
|--------------|---------|-----------------|
| `POST /api/weeks` | Create week from PRD | `/prd` |
| `POST /api/issues` | Create issues from user stories | `/prd` |
| `PATCH /api/issues/:id` | Update issue state, add telemetry | `/work` |
| `POST /api/weeks/:id/iterations` | Log iteration attempts | `/work` |
| `POST /api/issues/:id/history` | Log verification failures | `/work` |
| `GET /api/weeks/:id/iterations` | Get week progress | `/standup` |
| `POST /api/documents` | Create retro/wiki docs | `/document` |
| `GET /api/search/learnings` | Query past learnings | `/prd` |

### Issue Metadata for Claude

Issues track Claude-specific metadata in `properties.claude_metadata`:

```typescript
interface ClaudeMetadata {
  updated_by: 'claude';           // Attribution flag
  story_id?: string;              // PRD story ID reference
  prd_name?: string;              // Source PRD name
  session_context?: string;       // Session info
  confidence?: number;            // 0-100 completion confidence
  telemetry?: {
    iterations: number;           // Fix attempt count
    feedback_loops: {
      type_check: number;
      test: number;
      build: number;
    };
    time_elapsed_seconds: number;
    files_changed: string[];
  };
}
```

### Week Iterations

The `sprint_iterations` table (historical name) logs each attempt at completing a story:

| Column | Type | Description |
|--------|------|-------------|
| `sprint_id` | UUID | Parent week (historical column name) |
| `story_id` | VARCHAR | PRD story ID |
| `story_title` | VARCHAR | Story name |
| `status` | ENUM | `pass`, `fail`, `in_progress` |
| `what_attempted` | TEXT | What was tried |
| `blockers_encountered` | TEXT | What failed |
| `author_id` | UUID | Who logged it |

This enables:
- Real-time progress visibility in Ship dashboard
- Week velocity analysis
- Learning extraction from failed attempts

## Decision Log

### 2024-12-30: Application Architecture Interview

**Attendees:** User + Claude

**Key Decisions:**

1. **Backend**: Node.js + Express (simple, ubiquitous)
2. **Frontend**: React + Vite (ecosystem support for TipTap/Yjs)
3. **Database access**: pg (raw SQL, not ORM)
4. **Repo structure**: Single repo, separate builds (web/, api/, shared/)
5. **Deployment**: Single container (EB or ECS) + S3/CloudFront
6. **Real-time**: WebSocket on same Express process
7. **Auth**: PIV + password fallback
8. **State management**: TanStack Query + light Zustand
9. **Offline model**: Superseded by 2025-01-15 decision; current metadata/list mutations do not queue offline
10. **Collab editing**: Superseded by 2025-01-15 decision; editor content uses Yjs/y-indexeddb for offline-tolerant content caching

**Rationale for Key Choices:**

- **Express over Fastify**: More ubiquitous, "boring technology"
- **pg over Kysely/ORM**: Maximum simplicity, full SQL control, no abstraction overhead
- **Offline-tolerant over offline-first**: Much simpler, meets "works on plane" requirement
- **Single container**: Simplest deployment, no microservices
- **WebSocket same process**: Avoids separate service, sticky sessions if scaling

### 2024-12-30: Implementation Decisions Interview

**Attendees:** User + Claude

**Key Decisions:**

1. **Migration strategy**: Clean break (no data migration from old system)
2. **Testing approach**: E2E-heavy (Playwright focus, minimal unit tests)
3. **Error tracking**: CloudWatch only (AWS-native, gov-compliant)
4. **UI components**: shadcn/ui (Tailwind + Radix primitives)
5. **Database migrations**: Manual + reviewed (safe, auditable)
6. **Expected scale**: Department-level (20-200 users)
7. **Bulk operations**: One-at-a-time REST (simple, client batches)
8. **WebSocket recovery**: Simple reconnect + refetch from REST
9. **Accessibility**: Section 508 strict compliance

**Rationale:**

- **Clean break over migration**: Greenfield rebuild, don't carry technical debt
- **E2E-heavy**: Tests real user flows, shadcn/ui components don't need unit tests
- **CloudWatch only**: Gov-compliant, no external services (Sentry blocked)
- **shadcn/ui**: Copy-paste ownership, Radix accessibility, Tailwind consistency
- **Manual migrations**: Government deployments favor safety over convenience

### 2024-12-30: Library & Tooling Decisions

**Attendees:** User + Claude

**Key Decisions:**

1. **Secrets management**: SSM Parameter Store (AWS-native, gov-compliant)
2. **CI/CD**: Manual deploys initially (scripts, not pipeline)
3. **Router**: React Router v7 (boring technology, ubiquitous)
4. **i18n**: react-i18next (structure for future, English only initially)
5. **Forms**: React Hook Form (performant, good validation)
6. **Document export**: Not initially (browser print if needed)
7. **API errors**: Simple JSON `{ error: string, code?: string }`
8. **Feature flags**: None (ship to everyone, simplest)
9. **Date library**: date-fns (modular, tree-shakeable)

**Rationale:**

- **SSM over Secrets Manager**: Simpler, cheaper, sufficient for most secrets
- **Manual deploys**: Start simple, add CI/CD when it becomes painful
- **React Router over TanStack Router**: "Boring technology" - everyone knows it
- **i18n structure early**: Easier than retrofitting, low overhead with react-i18next
- **No feature flags**: YAGNI - add when needed, don't over-engineer

### 2024-12-30: UX & Infrastructure Decisions

**Attendees:** User + Claude

**Key Decisions:**

1. **File uploads**: Direct to S3 via presigned URLs
2. **Notifications**: In-app toasts only (no inbox, no email)
3. **Dark mode**: Yes, user toggle (not system preference)
4. **URL structure**: Resource-based (`/programs/:id`, `/documents/:id`)
5. **Pagination**: Cursor-based (handles real-time better)
6. **Keyboard shortcuts**: Comprehensive (CMD+K palette, vim-like nav)

**Rationale:**

- **Direct S3 uploads**: Better for large files, offloads API server
- **In-app toasts only**: Simplest notification pattern, add inbox later if needed
- **User toggle dark mode**: Users expect theme control, shadcn/ui makes it easy
- **Resource-based URLs**: Clean, bookmarkable, RESTful
- **Cursor pagination**: Robust with real-time updates and offline sync
- **Comprehensive shortcuts**: Power user focus - productivity apps need this

### 2024-12-30: Security & Compliance Decisions

**Attendees:** User + Claude

**Key Decisions:**

1. **Audit logging**: Yes, basic (log CRUD operations to DB)
2. **Session timeout**: 15 minutes strict (government standard)

**Implementation Notes:**

- **Audit log schema**: `audit_logs(id, user_id, action, resource_type, resource_id, changes_json, ip, timestamp)`
- **Session timeout**: Cookie expiry + server-side session validation
- **Idle timeout**: Warn at 14 min, auto-logout at 15 min
- **Re-auth for sensitive actions**: Consider requiring fresh auth for destructive operations

### 2025-01-15: Local-First Architecture Removal

**Attendees:** User + Claude

**Context:** The local-first architecture with offline mutation queues was overly complex and causing bugs. Decided to simplify to a stale-while-revalidate caching model.

**What was removed:**
- Pending mutations queue and sync handlers
- Service worker (sw.js, PWA dependencies)
- Offline UI components (OfflineBanner, PendingSyncBadge, ConnectionStatus, etc.)
- Complex online/offline state tracking

**What was kept:**
1. **TanStack Query + IndexedDB persistence**: Stale-while-revalidate caching for fast page loads
2. **y-indexeddb for editor content**: Yjs document persistence for instant editor loads and offline editing
3. **Optimistic updates with rollback**: Simple pattern - update UI immediately, rollback on error
4. **Error toasts**: Global mutation error listener shows toast when operations fail

**Key Decisions:**
1. **No offline writes**: Mutations require network connectivity; if offline, mutation fails and optimistic update is rolled back
2. **Cache schema versioning**: Bump version to auto-clear old cached data on architecture changes
3. **Two-layer caching preserved**: Editor content (Yjs/y-indexeddb) and lists/metadata (TanStack Query/IndexedDB) remain separate

**Rationale:**
- **Complexity vs value**: The offline mutation queue added significant complexity for a rarely-used feature
- **Bugs**: The sync handlers had edge cases causing data inconsistencies
- **Simpler model**: "Works when online, shows cached data when offline" is easier to reason about
- **Editor still works offline**: y-indexeddb preserves the most important offline capability (editing documents)

### 2026-01-03: Offline Architecture Clarification (Historical)

**Attendees:** User + Claude

**Context:** Architecture review that led to the local-first implementation. This was later simplified in Jan 2025.

**Original decisions** (many now superseded):
- Two-layer sync architecture
- Offline mutation queue (removed)
- Full offline for everything (simplified to cache-only)

**See 2025-01-15 decision log for current architecture.**

---

## Roadmap

Features planned but not yet implemented:

### Type-Safe Query Builder

Consider adding Kysely or similar for complex queries:

```typescript
// Future: Type-safe queries for complex operations
const results = await db
  .selectFrom("documents")
  .where("document_type", "=", "issue")
  .where("properties", "@>", '{"state": "in_progress"}')
  .selectAll()
  .execute();
```

**Why:** Raw SQL is sufficient for simple CRUD. Type-safe builder may help with complex filtering/reporting queries.

---

## References

- [Unified Document Model](./unified-document-model.md) - Data model
- [Document Model Conventions](./document-model-conventions.md) - Terminology
- [Week Documentation Philosophy](./week-documentation-philosophy.md) - Week workflow
