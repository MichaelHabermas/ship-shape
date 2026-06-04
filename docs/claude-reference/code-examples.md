# Ship Code Examples

Common patterns with real code examples from the codebase.

## API Route Pattern

From `api/src/routes/issues/index.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// 1. Zod schema at top
const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  state: z.enum(['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  belongs_to: z.array(belongsToEntrySchema).optional().default([]),
});

// 2. Row extractor function
function extractIssueFromRow(row: any): Issue {
  return {
    id: row.id,
    title: row.title,
    document_type: 'issue',
    properties: {
      state: row.state,
      priority: row.priority,
      assignee_id: row.assignee_id,
    },
    // ... other fields
  };
}

// 3. Route with authMiddleware
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId!;
    const { isAdmin } = await getVisibilityContext(req.userId!, workspaceId);

    const result = await pool.query(
      `SELECT d.*,
              d.properties->>'state' as state,
              d.properties->>'priority' as priority
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY d.created_at DESC`,
      [workspaceId, req.userId, isAdmin]
    );

    res.json(result.rows.map(extractIssueFromRow));
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
});

// 4. POST with Zod validation
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const parsed = createIssueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
    return;
  }

  const { title, state, priority, belongs_to } = parsed.data;

  // ... create logic
});

export default router;
```

## Database Transaction Pattern

From `api/src/routes/backlinks.ts:113-148`:

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');

  await client.query(
    'DELETE FROM document_links WHERE source_id = $1',
    [id]
  );

  if (target_ids.length > 0) {
    await client.query(
      `INSERT INTO document_links (source_id, target_id)
       VALUES ($1, $2)
       ON CONFLICT (source_id, target_id) DO NOTHING`,
      [id, target_ids[0]]
    );
  }

  await client.query('COMMIT');
  res.json({ success: true });
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

## TanStack Query Hook Pattern

From `web/src/hooks/useIssuesQuery.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, assertApiData } from '@/api/client';
import { issueKeys, type IssueFilters } from '@/hooks/issue-keys';

async function fetchIssues(filters?: IssueFilters) {
  const result = await apiClient.GET('/issues', {
    params: {
      query: {
        ...(filters?.programId ? { program_id: filters.programId } : {}),
        ...(filters?.projectId ? { project_id: filters.projectId } : {}),
      },
    },
  });
  return assertApiData(result, 'Failed to fetch issues');
}

export function useIssuesQuery(filters: IssueFilters = {}) {
  return useQuery({
    queryKey: issueKeys.list(filters),
    queryFn: () => fetchIssues(filters),
    staleTime: 30 * 1000,
  });
}

export function useCreateIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateIssueData) => {
      const result = await apiClient.POST('/issues', { body: data });
      return assertApiData(result, 'Failed to create issue');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
    },
  });
}
```

## Context + Hook Pattern

From `web/src/contexts/WorkspaceContext.tsx`:

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { api, Workspace } from '@/lib/api';

interface WorkspaceContextType {
  currentWorkspace: Workspace | null;
  workspaces: WorkspaceWithRole[];
  isWorkspaceAdmin: boolean;
  switchWorkspace: (workspaceId: string) => Promise<boolean>;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    const response = await api.workspaces.switch(workspaceId);
    if (response.success && response.data) {
      setCurrentWorkspace(response.data.workspace);
      return true;
    }
    return false;
  }, []);

  return (
    <WorkspaceContext.Provider value={{ currentWorkspace, workspaces, switchWorkspace, /* ... */ }}>
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

## TipTap Extension Pattern

From `web/src/components/editor/DetailsExtension.ts`:

```typescript
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DetailsNodeView } from './DetailsNodeView';

export const DetailsExtension = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary detailsContent',

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: element => element.hasAttribute('open'),
        renderHTML: attributes => {
          if (!attributes.open) return {};
          return { open: '' };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DetailsNodeView);
  },

  addCommands() {
    return {
      toggleDetails: () => ({ commands }) => {
        return commands.toggleWrap(this.name);
      },
    };
  },
});
```

## Visibility Filter Pattern

From `api/src/middleware/visibility.ts`:

```typescript
import { pool } from '../db/client.js';

export async function getVisibilityContext(userId: string, workspaceId: string) {
  const result = await pool.query(
    `SELECT role FROM workspace_memberships
     WHERE user_id = $1 AND workspace_id = $2`,
    [userId, workspaceId]
  );

  const isAdmin = result.rows[0]?.role === 'admin';
  return { isAdmin };
}

// SQL fragment for visibility filtering
// Usage: WHERE ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
export function VISIBILITY_FILTER_SQL(
  tableAlias: string,
  userIdParam: string,
  isAdminParam: string
): string {
  return `(
    ${tableAlias}.visibility = 'workspace'
    OR ${tableAlias}.created_by = ${userIdParam}
    OR ${isAdminParam} = TRUE
  )`;
}
```

## Migration Pattern

From `api/src/db/migrations/020_document_associations.sql`:

```sql
-- Migration: Create document_associations table
-- Purpose: Flexible many-to-many document relationships

-- Create the associations table
CREATE TABLE IF NOT EXISTS document_associations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    related_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    relationship_type relationship_type NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',

    CONSTRAINT unique_association
        UNIQUE (document_id, related_id, relationship_type),

    CONSTRAINT no_self_reference
        CHECK (document_id != related_id)
);

CREATE INDEX IF NOT EXISTS idx_document_associations_document_id
    ON document_associations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_associations_related_id
    ON document_associations(related_id);

COMMENT ON TABLE document_associations IS
    'Flexible document relationships replacing fixed FK columns';
```

## E2E Test Pattern

From `e2e/fixtures/isolated-env.ts`:

```typescript
import { test as base, expect } from '@playwright/test';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

// Extend base test with isolated environment
export const test = base.extend<{}, { workerDatabase: PostgreSqlContainer }>({
  // Worker-scoped database container
  workerDatabase: [async ({}, use, workerInfo) => {
    const container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('ship_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    // Run migrations
    await runMigrations(container.getConnectionUri());

    // Seed minimal test data
    await seedMinimalTestData(container.getConnectionUri());

    await use(container);

    await container.stop();
  }, { scope: 'worker' }],

  // Page with authenticated session
  page: async ({ page, workerDatabase }, use) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('#email', 'dev@ship.local');
    await page.fill('#password', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    await use(page);
  },
});

// Usage in test file
test('can create issue', async ({ page }) => {
  await page.goto('/projects/test-project/issues');
  await page.click('[data-testid="create-issue"]');
  await page.fill('[data-testid="issue-title"]', 'Test Issue');
  await page.click('[data-testid="save-issue"]');

  await expect(page.locator('text=Test Issue')).toBeVisible();
});
```

## Yjs Collaboration Setup

From `web/src/hooks/useCollabSession.ts`:

```typescript
import { useMemo } from 'react';
import * as Y from 'yjs';
import { buildCollaborationRoomName, COLLAB_CLOSE_CODE_CONTENT_UPDATE } from '@ship/shared';
import { useCollabSession } from '@/hooks/useCollabSession';

function Editor({ documentId, documentType, userName, userColor }: EditorProps) {
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);

  const { provider, syncStatus } = useCollabSession({
    documentId,
    documentType,
    userName,
    userColor,
    ydoc,
    onBack: () => navigate(-1),
  });

  // IndexedDB key: ship-{documentType}-{documentId}
  // WebSocket URL: VITE_API_URL with http→ws swap + '/collaboration'
  // Room name: buildCollaborationRoomName(documentType, documentId)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: ydoc }),
      ...(provider
        ? [CollaborationCursor.configure({ provider, user: { name: userName, color: userColor } })]
        : []),
    ],
  });

  return <EditorContent editor={editor} />;
}
```

## Session Validation Pattern

From `api/src/middleware/auth.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { SESSION_TIMEOUT_MS, ABSOLUTE_SESSION_TIMEOUT_MS } from '@ship/shared';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Check for API token first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await pool.query(
      `SELECT * FROM api_tokens
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [tokenHash]
    );

    if (result.rows.length > 0) {
      req.userId = result.rows[0].user_id;
      req.workspaceId = result.rows[0].workspace_id;
      req.isApiToken = true;
      return next();
    }
  }

  // Check session cookie
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const result = await pool.query(
    `SELECT s.*, u.is_super_admin
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = $1`,
    [sessionId]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const session = result.rows[0];

  // Check inactivity timeout
  const inactivityExpired =
    Date.now() - new Date(session.last_activity).getTime() > SESSION_TIMEOUT_MS;

  // Check absolute timeout
  const absoluteExpired =
    Date.now() - new Date(session.created_at).getTime() > ABSOLUTE_SESSION_TIMEOUT_MS;

  if (inactivityExpired || absoluteExpired) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    res.clearCookie('session_id');
    return res.status(401).json({ error: 'Session expired' });
  }

  // Update last activity
  await pool.query(
    'UPDATE sessions SET last_activity = NOW() WHERE id = $1',
    [sessionId]
  );

  req.userId = session.user_id;
  req.workspaceId = session.workspace_id;
  req.isSuperAdmin = session.is_super_admin;

  next();
}
```
