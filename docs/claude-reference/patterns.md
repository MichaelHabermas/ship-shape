# Ship Codebase Patterns

Established patterns used throughout the Ship codebase. Follow these when adding new features.

## 1. API Route Patterns

### Router Setup with authMiddleware

All routes use Express Router with `authMiddleware` for session/token authentication.

```typescript
// api/src/routes/issues.ts:1-8
import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();
```

Apply `authMiddleware` to all route handlers:

```typescript
// api/src/routes/issues.ts:160
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.userId!;      // Set by authMiddleware
  const workspaceId = req.workspaceId!;  // Set by authMiddleware
  // ...
});
```

### Zod Validation for Inputs

Define schemas at the top of route files, validate in handlers:

```typescript
// api/src/routes/issues.ts:17-23
const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  state: z.enum(['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional().default('backlog'),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional().default('medium'),
  assignee_id: z.string().uuid().optional().nullable(),
  belongs_to: z.array(belongsToEntrySchema).optional().default([]),
});

// Usage in handler:
// api/src/routes/issues.ts:517
const parsed = createIssueSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
  return;
}
```

### Row Extractors for Database Results

Extract typed objects from raw database rows using `extract*FromRow` functions:

```typescript
// api/src/routes/issues.ts:132-157
function extractIssueFromRow(row: any) {
  const props = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    assignee_id: props.assignee_id || null,
    estimate: props.estimate ?? null,
    // ... other fields
  };
}
```

Other examples:
- `api/src/routes/programs.ts:11` - `extractProgramFromRow`
- `api/src/routes/projects.ts:16` - `extractProjectFromRow`
- `api/src/routes/weeks/shared.ts`:44 - `extractWeekFromRow`

### Error Response Formats

Standard error responses use consistent JSON structure:

```typescript
// 400 Bad Request - validation errors
res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });

// 404 Not Found
res.status(404).json({ error: 'Issue not found' });

// 403 Forbidden
res.status(403).json({ error: 'Only the author or admin can update this standup' });

// 409 Conflict - business logic warnings
res.status(409).json({
  warning: 'cascade_required',
  message: 'Closing parent will orphan children',
  children: [/* incomplete child issues */],
});

// 500 Internal Server Error
res.status(500).json({ error: 'Internal server error' });
```

## 2. Database Patterns

### Raw SQL with pg Pool (No ORM)

Direct SQL queries using the `pg` pool singleton:

```typescript
// api/src/db/client.ts - Pool singleton
import { pool } from '../db/client.js';

// Simple query
const result = await pool.query(
  'SELECT * FROM documents WHERE id = $1',
  [documentId]
);
const document = result.rows[0];
```

### Parameterized Queries

Always use parameterized queries ($1, $2, etc.) to prevent SQL injection:

```typescript
// api/src/routes/issues.ts:74-78
await pool.query(
  `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by, automated_by)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [documentId, field, oldValue, newValue, changedBy, automatedBy ?? null]
);
```

### Transaction Handling

Use client from pool with explicit BEGIN/COMMIT/ROLLBACK:

```typescript
// api/src/routes/issues.ts:523-582
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Multiple related operations
  const issueResult = await client.query(/*...*/);
  await client.query(/*...*/);  // Additional operations

  await client.query('COMMIT');
  res.status(201).json(issue);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### JSONB Property Access

Access JSONB `properties` column using `->>` for text or `->` for JSON:

```typescript
// api/src/routes/claude.ts:123-141
SELECT
  s.properties->>'sprint_number' as sprint_number,
  s.properties->>'status' as sprint_status,
  p.properties->>'color' as program_color,
  (d.properties->>'priority')::text as priority
FROM documents d
LEFT JOIN document_associations da ON da.document_id = d.id AND da.relationship_type = 'sprint'
LEFT JOIN documents s ON s.id = da.related_id
```

Store properties as JSONB:

```typescript
// api/src/routes/issues.ts - properties column
await pool.query(
  `INSERT INTO documents (workspace_id, document_type, title, properties)
   VALUES ($1, 'issue', $2, $3)`,
  [workspaceId, title, JSON.stringify({ state: 'backlog', priority: 'medium' })]
);
```

## 3. React Patterns

### Context + Hooks Pattern

Create context with provider and typed hook:

```typescript
// web/src/contexts/WorkspaceContext.tsx:1-71
import { createContext, useContext, useState, type ReactNode } from 'react';

interface WorkspaceContextType {
  currentWorkspace: Workspace | null;
  workspaces: WorkspaceWithRole[];
  switchWorkspace: (workspaceId: string) => Promise<boolean>;
  // ...
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  // ...
  return (
    <WorkspaceContext.Provider value={{ currentWorkspace, /* ... */ }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return context;
}
```

Other contexts:
- `web/src/contexts/IssuesContext.tsx`
- `web/src/contexts/ProjectsContext.tsx`
- `web/src/contexts/ProgramsContext.tsx`
- `web/src/hooks/useAuth.tsx` - AuthContext

### TanStack Query for Data Fetching

#### Query Keys Pattern

Use factory pattern for consistent query keys:

```typescript
// web/src/hooks/useIssuesQuery.ts:72-79
export const issueKeys = {
  all: ['issues'] as const,
  lists: () => [...issueKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...issueKeys.lists(), filters] as const,
  details: () => [...issueKeys.all, 'detail'] as const,
  detail: (id: string) => [...issueKeys.details(), id] as const,
};
```

#### useQuery Hook Pattern

```typescript
// web/src/hooks/useProjectsQuery.ts:139-145
export function useProjectsQuery() {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: fetchProjects,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
```

#### useMutation with Optimistic Updates

```typescript
// web/src/hooks/useProjectsQuery.ts:148-206
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProjectData) => createProjectApi(data),
    onMutate: async (newProject) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });
      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());

      // Optimistic update
      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => [optimisticProject, ...(old || [])]
      );

      return { previousProjects, optimisticId: optimisticProject.id };
    },
    onError: (_err, _newProject, context) => {
      // Rollback on error
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}
```

### useQuery Naming Conventions

- List queries: `use{Resource}Query()` - e.g., `useProjectsQuery()`
- Detail queries: `use{Resource}Query(id)` - e.g., `useWeekQuery(weekId)`
- Create mutations: `useCreate{Resource}()` - e.g., `useCreateProject()`
- Update mutations: `useUpdate{Resource}()` - e.g., `useUpdateProject()`
- Delete mutations: `useDelete{Resource}()` - e.g., `useDeleteProject()`

### Component File Organization

Query hooks go in `web/src/hooks/use{Resource}Query.ts`:
- `useIssuesQuery.ts`
- `useProjectsQuery.ts`
- `useWeeksQuery.ts`
- `useProgramsQuery.ts`
- `useDocumentsQuery.ts`

## 4. Editor Patterns

### TipTap Extension System

Extensions are in `web/src/components/editor/`:

```typescript
// web/src/components/editor/DetailsExtension.ts:36-64
export const DetailsExtension = Node.create<DetailsOptions>({
  name: 'details',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: 'block',
  content: 'detailsSummary detailsContent',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.hasAttribute('open'),
        renderHTML: (attributes) => ({ 'data-open': attributes.open ? 'true' : 'false' }),
      },
    };
  },

  parseHTML() { /* ... */ },
  renderHTML() { /* ... */ },
});
```

Available extensions:
- `DragHandleExtension` - Block drag and drop
- `MentionExtension` - @mentions for documents/people
- `ImageUploadExtension` - Image upload handling
- `FileAttachmentExtension` - File attachments
- `DetailsExtension` - Collapsible toggle blocks
- `EmojiExtension` - Emoji picker
- `TableOfContentsExtension` - Auto-generated TOC

### Yjs Integration

Collaboration transport lives in `web/src/hooks/useCollabSession.ts`. `Editor.tsx` creates a Y.Doc per document and delegates WebSocket/IndexedDB setup to the hook:

```typescript
// web/src/components/Editor.tsx
const ydoc = useMemo(() => new Y.Doc(), [documentId]);
const { provider, syncStatus } = useCollabSession({ documentId, documentType, userName, userColor, ydoc });
```

Room names use `{documentType}:{documentId}` (see `shared/src/collab-protocol.ts`).

Server-side Yjs handling:

```typescript
// api/src/collaboration/index.ts:82-97
const docs = new Map<string, Y.Doc>();

async function persistDocument(docName: string, doc: Y.Doc) {
  const state = Y.encodeStateAsUpdate(doc);
  // Store in database...
}
```

### Document Conversion (JSON <-> Yjs)

```typescript
// api/src/collaboration/index.ts:227
function jsonToYjs(doc: Y.Doc, fragment: Y.XmlFragment, content: any) {
  // Convert TipTap JSON to Yjs XML structure
}
```

## 5. Testing Patterns

### Vitest Unit Tests

Configuration at `api/vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,  // Sequential to prevent DB conflicts
  },
});
```

Test file naming: `*.test.ts` (e.g., `documents.test.ts`)

Test setup cleans database before all tests via `TRUNCATE CASCADE` (see `api/src/test/setup.ts`):

### Unit Test Structure

```typescript
// api/src/routes/documents.test.ts:1-71
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';

describe('Documents API - PATCH with Issue Fields', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let sessionCookie: string;
  let testWorkspaceId: string;

  beforeAll(async () => {
    // Create test workspace, user, session
    const workspaceResult = await pool.query(/*...*/);
    testWorkspaceId = workspaceResult.rows[0].id;
    // ...
  });

  afterAll(async () => {
    // Clean up test data in reverse order (FK constraints)
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  it('should update issue fields', async () => {
    const res = await request(app)
      .patch(`/api/documents/${testIssueId}`)
      .set('Cookie', sessionCookie)
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
  });
});
```

### Playwright E2E Tests

Test file naming: `*.spec.ts` (e.g., `issues.spec.ts`)

Tests use isolated fixtures with per-worker database containers:

```typescript
// e2e/fixtures/isolated-env.ts
export const test = base.extend<{}, WorkerFixtures>({
  dbContainer: [
    async ({}, use, workerInfo) => {
      const container = await new PostgreSqlContainer('postgres:15')
        .withDatabase('ship_test')
        .start();
      await runMigrations(container.getConnectionUri());
      await use(container);
      await container.stop();
    },
    { scope: 'worker' },
  ],
  // ... apiServer, webServer fixtures
});
```

E2E test structure:

```typescript
// e2e/issues.spec.ts
import { test, expect } from './fixtures/isolated-env';

test.describe('Issues', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL('/login');
  });

  test('can create a new issue', async ({ page }) => {
    await page.goto('/issues');
    await page.getByRole('button', { name: 'New Issue' }).click();
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/);
  });
});
```

### Per-Worker Database Isolation

Each Playwright worker gets:
- Own PostgreSQL container (testcontainers)
- Own API server instance (dynamic port)
- Own Vite preview server (lightweight static server)

Port allocation uses worker-specific ranges to avoid collisions:

```typescript
// e2e/fixtures/isolated-env.ts:37-44
async function getWorkerPort(workerIndex: number): Promise<number> {
  const BASE_PORT = 10000;
  const PORTS_PER_WORKER = 100;
  const startPort = BASE_PORT + workerIndex * PORTS_PER_WORKER;
  return getPort({ port: portNumbers(startPort, startPort + 99) });
}
```

**Important:** Use the `/e2e-test-runner` skill when running E2E tests; if unavailable, use `pnpm test:e2e:run`. Never run `pnpm test:e2e` directly.
