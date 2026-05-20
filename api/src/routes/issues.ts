import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import type { IssueProperties } from '@ship/shared';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  accountabilityTypeSchema,
  belongsToSchema,
  issuePrioritySchema,
  issueSourceSchema,
  issueStateSchema,
} from '../schemas/document-boundary.js';
import {
  logDocumentChange,
  getTimestampUpdates,
  getBelongsToAssociations,
  getBelongsToAssociationsBatch,
  TRACKED_FIELDS,
  type BelongsToEntry,
} from '../utils/document-crud.js';
import { broadcastToUser } from '../collaboration/index.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

type QueryParam = string | boolean | null | string[];

type IssueRow = {
  id: string;
  title: string;
  properties: IssueProperties | null;
  ticket_number: number | null;
  content: unknown;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  started_at?: Date | null;
  completed_at?: Date | null;
  cancelled_at?: Date | null;
  reopened_at?: Date | null;
  converted_from_id?: string | null;
  assignee_name?: string | null;
  assignee_archived?: boolean | null;
  created_by_name?: string | null;
};

// Validation schemas
const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  state: issueStateSchema.optional().default('backlog'),
  priority: issuePrioritySchema.optional().default('medium'),
  assignee_id: z.string().uuid().optional().nullable(),
  belongs_to: z.array(belongsToSchema).optional().default([]),
  // Source for the issue (internal, external, or action_items for system-generated)
  source: issueSourceSchema.optional().default('internal'),
  // Due date (ISO date string)
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  // System-generated flag (for action_items issues)
  is_system_generated: z.boolean().optional().default(false),
  // Accountability tracking for action_items issues
  accountability_target_id: z.string().uuid().optional().nullable(),
  accountability_type: accountabilityTypeSchema.optional().nullable(),
});

const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  state: issueStateSchema.optional(),
  priority: issuePrioritySchema.optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  belongs_to: z.array(belongsToSchema).optional(),
  estimate: z.number().positive().nullable().optional(),
  // Confirm closing parent with incomplete children (removes their parent association)
  confirm_orphan_children: z.boolean().optional(),
  // Claude Code integration metadata
  claude_metadata: z.object({
    updated_by: z.literal('claude'),
    story_id: z.string().optional(),
    prd_name: z.string().optional(),
    session_context: z.string().optional(),
    // Confidence score (0-100) for story completion
    confidence: z.number().int().min(0).max(100).optional(),
    // Telemetry for completed stories
    telemetry: z.object({
      iterations: z.number().int().min(1).optional(),
      feedback_loops: z.object({
        type_check: z.number().int().min(0).optional(),
        test: z.number().int().min(0).optional(),
        build: z.number().int().min(0).optional(),
      }).optional(),
      time_elapsed_seconds: z.number().int().min(0).optional(),
      files_changed: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

const rejectIssueSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const listIssuesQuerySchema = z.object({
  state: z.string().optional(),
  priority: issuePrioritySchema.optional(),
  assignee_id: z.string().optional(),
  program_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  sprint_id: z.string().uuid().optional(),
  source: issueSourceSchema.optional(),
  parent_filter: z.enum(['top_level', 'has_children', 'is_sub_issue']).optional(),
});

// Helper to extract issue properties from row (without belongs_to - added separately)
function extractIssueFromRow(row: IssueRow) {
  const props: Partial<IssueProperties> = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    assignee_id: props.assignee_id || null,
    estimate: props.estimate ?? null,
    source: props.source || 'internal',
    rejection_reason: props.rejection_reason || null,
    // Accountability fields for action_items issues
    due_date: props.due_date || null,
    is_system_generated: props.is_system_generated || false,
    accountability_target_id: props.accountability_target_id || null,
    accountability_type: props.accountability_type || null,
    ticket_number: row.ticket_number,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    cancelled_at: row.cancelled_at || null,
    reopened_at: row.reopened_at || null,
    converted_from_id: row.converted_from_id || null,
    assignee_name: row.assignee_name,
    assignee_archived: row.assignee_archived || false,
    created_by_name: row.created_by_name,
  };
}

// List issues with filters
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsedQuery = listIssuesQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsedQuery.error.flatten() });
      return;
    }
    const { state, priority, assignee_id, program_id, project_id, sprint_id, source, parent_filter } = parsedQuery.data;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    let query = `
      SELECT d.id, d.title, d.properties, d.ticket_number,
             d.content,
             d.created_at, d.updated_at, d.created_by,
             d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
             d.converted_from_id,
             u.name as assignee_name,
             CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived
      FROM documents d
      LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
      LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
        AND person_doc.document_type = 'person'
        AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
      WHERE d.workspace_id = $1 AND d.document_type = 'issue'
        AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
    `;
    const params: QueryParam[] = [workspaceId, userId, isAdmin];

    // Exclude archived and deleted issues by default
    query += ` AND d.archived_at IS NULL AND d.deleted_at IS NULL`;

    // Filter by source if specified (internal or external)
    if (source) {
      query += ` AND d.properties->>'source' = $${params.length + 1}`;
      params.push(source);
    }
    // No default filtering - show all issues regardless of source

    if (state) {
      const states = state.split(',');
      query += ` AND d.properties->>'state' = ANY($${params.length + 1})`;
      params.push(states);
    }

    if (priority) {
      query += ` AND d.properties->>'priority' = $${params.length + 1}`;
      params.push(priority);
    }

    if (assignee_id) {
      if (assignee_id === 'null' || assignee_id === 'unassigned') {
        query += ` AND (d.properties->>'assignee_id' IS NULL OR d.properties->>'assignee_id' = '')`;
      } else {
        query += ` AND d.properties->>'assignee_id' = $${params.length + 1}`;
        params.push(assignee_id);
      }
    }

    // Filter by program via junction table
    if (program_id) {
      query += ` AND EXISTS (
        SELECT 1 FROM document_associations da
        WHERE da.document_id = d.id AND da.related_id = $${params.length + 1} AND da.relationship_type = 'program'
      )`;
      params.push(program_id);
    }

    // Filter by project via junction table
    if (project_id) {
      query += ` AND EXISTS (
        SELECT 1 FROM document_associations da
        WHERE da.document_id = d.id AND da.related_id = $${params.length + 1} AND da.relationship_type = 'project'
      )`;
      params.push(project_id);
    }

    // Filter by sprint via junction table
    if (sprint_id) {
      query += ` AND EXISTS (
        SELECT 1 FROM document_associations da
        WHERE da.document_id = d.id AND da.related_id = $${params.length + 1} AND da.relationship_type = 'sprint'
      )`;
      params.push(sprint_id);
    }

    // Filter by parent/sub-issue status
    if (parent_filter) {
      if (parent_filter === 'top_level') {
        // Issues that have NO parent (not a sub-issue)
        query += ` AND NOT EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id AND da.relationship_type = 'parent'
        )`;
      } else if (parent_filter === 'has_children') {
        // Issues that HAVE at least one child (sub-issue)
        query += ` AND EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.related_id = d.id AND da.relationship_type = 'parent'
        )`;
      } else if (parent_filter === 'is_sub_issue') {
        // Issues that ARE sub-issues (have a parent)
        query += ` AND EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id AND da.relationship_type = 'parent'
        )`;
      }
    }

    query += ` ORDER BY
      CASE d.properties->>'priority'
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      d.updated_at DESC`;

    const result = await pool.query<IssueRow>(query, params);

    // Extract issues and batch-fetch associations to avoid N+1 queries
    const issueIds = result.rows.map(row => row.id);
    const associationsMap = await getBelongsToAssociationsBatch(issueIds);

    const issues = result.rows.map(row => {
      const issue = extractIssueFromRow(row);
      return {
        ...issue,
        display_id: `#${issue.ticket_number}`,
        belongs_to: associationsMap.get(row.id) || [],
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('List issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get action items for current user (issues with source='action_items' that are not done)
router.get('/action-items', authMiddleware, async (req: Request, res: Response) => {
  try {
    // In test mode, return empty to avoid blocking E2E test interactions with modal
    if (process.env.NODE_ENV === 'test') {
      res.json({ items: [], total: 0 });
      return;
    }

    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get person document ID for the user
    const personResult = await pool.query(
      `SELECT id FROM documents
       WHERE workspace_id = $1 AND document_type = 'person'
         AND properties->>'user_id' = $2`,
      [workspaceId, userId]
    );
    const personDocId = personResult.rows[0]?.id;

    // Get action items: issues with source='action_items' assigned to current user, not done
    const result = await pool.query(
      `SELECT
         d.id,
         d.title,
         d.properties->>'state' as state,
         d.properties->>'priority' as priority,
         d.ticket_number,
         d.properties->>'due_date' as due_date,
         (d.properties->>'is_system_generated')::boolean as is_system_generated,
         d.properties->>'accountability_type' as accountability_type,
         d.properties->>'accountability_target_id' as accountability_target_id,
         target.title as target_title
       FROM documents d
       LEFT JOIN documents target ON target.id = (d.properties->>'accountability_target_id')::uuid
       WHERE d.workspace_id = $1
         AND d.document_type = 'issue'
         AND d.properties->>'source' = 'action_items'
         AND d.properties->>'state' NOT IN ('done', 'cancelled')
         AND (
           (d.properties->>'assignee_id')::uuid = $2
           OR ($3::uuid IS NOT NULL AND (d.properties->>'assignee_id')::uuid = $3)
         )
       ORDER BY
         CASE WHEN d.properties->>'due_date' IS NOT NULL THEN 0 ELSE 1 END,
         d.properties->>'due_date' ASC,
         d.properties->>'priority' = 'urgent' DESC,
         d.properties->>'priority' = 'high' DESC,
         d.created_at ASC`,
      [workspaceId, userId, personDocId]
    );

    // Calculate days overdue for each item
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = result.rows.map(row => {
      let daysOverdue = 0;
      if (row.due_date) {
        const dueDate = new Date(row.due_date + 'T00:00:00');
        const diffTime = today.getTime() - dueDate.getTime();
        daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      }

      return {
        id: row.id,
        title: row.title,
        state: row.state || 'backlog',
        priority: row.priority || 'medium',
        ticket_number: row.ticket_number,
        display_id: `#${row.ticket_number}`,
        due_date: row.due_date,
        is_system_generated: row.is_system_generated ?? false,
        accountability_type: row.accountability_type,
        accountability_target_id: row.accountability_target_id,
        target_title: row.target_title,
        days_overdue: daysOverdue,
      };
    });

    res.json({
      items,
      total: items.length,
    });
  } catch (err) {
    console.error('Get action items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get issue by ticket number
router.get('/by-ticket/:number', authMiddleware, async (req: Request, res: Response) => {
  try {
    const numberParam = req.params.number;
    if (!numberParam || typeof numberParam !== 'string') {
      res.status(400).json({ error: 'Ticket number required' });
      return;
    }
    const ticketNumber = parseInt(numberParam, 10);
    if (isNaN(ticketNumber)) {
      res.status(400).json({ error: 'Invalid ticket number' });
      return;
    }

    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.content,
              d.created_at, d.updated_at, d.created_by,
              d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
              d.converted_to_id, d.converted_from_id,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived,
              creator.name as created_by_name
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       LEFT JOIN users creator ON d.created_by = creator.id
       WHERE d.ticket_number = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [ticketNumber, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const row = result.rows[0];

    // Check if issue was converted - redirect to new document
    if (row.converted_to_id) {
      // Fetch the new document to determine its type for proper routing
      const newDocResult = await pool.query(
        'SELECT id, document_type FROM documents WHERE id = $1 AND workspace_id = $2',
        [row.converted_to_id, workspaceId]
      );

      if (newDocResult.rows.length > 0) {
        const newDoc = newDocResult.rows[0];
        // Return 301 with Location header to the new document's API endpoint
        res.set('X-Converted-Type', newDoc.document_type);
        res.set('X-Converted-To', newDoc.id);
        res.redirect(301, `/api/${newDoc.document_type}s/${newDoc.id}`);
        return;
      }
    }

    const issue = extractIssueFromRow(row);
    const belongs_to = await getBelongsToAssociations(row.id);
    res.json({
      ...issue,
      display_id: `#${issue.ticket_number}`,
      belongs_to,
    });
  } catch (err) {
    console.error('Get issue by ticket error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sub-issues (children) of an issue
router.get('/:id/children', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify parent issue exists and user can access it
    const parentCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (parentCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    // Query junction table for sub-issues
    // Sub-issues have document_id pointing to this issue's id via relationship_type='parent'
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.content,
              d.created_at, d.updated_at, d.created_by,
              d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
              d.converted_from_id,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       WHERE da.related_id = $1
         AND da.relationship_type = 'parent'
         AND d.workspace_id = $2
         AND d.document_type = 'issue'
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id, workspaceId, userId, isAdmin]
    );

    // Batch-fetch associations to avoid N+1 queries
    const childIds = result.rows.map(row => row.id);
    const associationsMap = await getBelongsToAssociationsBatch(childIds);

    const children = result.rows.map(row => {
      const issue = extractIssueFromRow(row);
      return {
        ...issue,
        display_id: `#${issue.ticket_number}`,
        belongs_to: associationsMap.get(row.id) || [],
      };
    });

    res.json(children);
  } catch (err) {
    console.error('Get issue children error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single issue
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.content,
              d.created_at, d.updated_at, d.created_by,
              d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
              d.converted_to_id, d.converted_from_id,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived,
              creator.name as created_by_name
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       LEFT JOIN users creator ON d.created_by = creator.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const row = result.rows[0];

    // Check if issue was converted - redirect to new document
    if (row.converted_to_id) {
      // Fetch the new document to determine its type for proper routing
      const newDocResult = await pool.query(
        'SELECT id, document_type FROM documents WHERE id = $1 AND workspace_id = $2',
        [row.converted_to_id, workspaceId]
      );

      if (newDocResult.rows.length > 0) {
        const newDoc = newDocResult.rows[0];
        // Return 301 with Location header to the new document's API endpoint
        // Include X-Converted-Type header so frontend knows the target type for routing
        res.set('X-Converted-Type', newDoc.document_type);
        res.set('X-Converted-To', newDoc.id);
        res.redirect(301, `/api/${newDoc.document_type}s/${newDoc.id}`);
        return;
      }
    }

    const issue = extractIssueFromRow(row);
    const belongs_to = await getBelongsToAssociations(row.id);
    res.json({
      ...issue,
      display_id: `#${issue.ticket_number}`,
      belongs_to,
    });
  } catch (err) {
    console.error('Get issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create issue
// Uses advisory lock to prevent race condition in ticket number generation
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = createIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const {
      title,
      state,
      priority,
      assignee_id,
      belongs_to,
      source,
      due_date,
      is_system_generated,
      accountability_target_id,
      accountability_type,
    } = parsed.data;

    await client.query('BEGIN');

    // Use advisory lock to serialize ticket number generation per workspace
    // This prevents race conditions where concurrent requests get the same MAX value
    // The lock key is derived from workspace_id (first 15 hex chars as bigint)
    const workspaceIdHex = req.workspaceId!.replace(/-/g, '').substring(0, 15);
    const lockKey = parseInt(workspaceIdHex, 16);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

    // Now safely get next ticket number - we hold the lock until transaction ends
    const ticketResult = await client.query(
      `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'issue'`,
      [req.workspaceId]
    );
    const ticketNumber = ticketResult.rows[0].next_number;

    // Build properties JSONB
    const properties = {
      state: state || 'backlog',
      priority: priority || 'medium',
      source: source || 'internal',
      assignee_id: assignee_id || null,
      rejection_reason: null,
      // Accountability fields for action_items issues
      due_date: due_date || null,
      is_system_generated: is_system_generated || false,
      accountability_target_id: accountability_target_id || null,
      accountability_type: accountability_type || null,
    };

    const result = await client.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, created_by)
       VALUES ($1, 'issue', $2, $3, $4, $5)
       RETURNING *`,
      [req.workspaceId, title, JSON.stringify(properties), ticketNumber, req.userId]
    );

    const newIssueId = result.rows[0].id;

    // Create associations from belongs_to array
    for (const assoc of belongs_to) {
      await client.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
        [newIssueId, assoc.id, assoc.type]
      );
    }

    await client.query('COMMIT');

    // Auto-complete sprint_issues accountability when first issue is created in a sprint
    const sprintAssociations = belongs_to.filter(bt => bt.type === 'sprint');
    for (const sprintAssoc of sprintAssociations) {
      // Check if this is the first issue in the sprint
      const issueCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM document_associations
         WHERE related_id = $1 AND relationship_type = 'sprint'`,
        [sprintAssoc.id]
      );
      const issueCount = parseInt(issueCountResult.rows[0].count, 10);

      // Broadcast celebration when first issue is added to sprint
      if (issueCount === 1) {
        broadcastToUser(req.userId!, 'accountability:updated', { type: 'week_issues', targetId: sprintAssoc.id });
      }
    }

    // Get the belongs_to associations with display info
    const belongsToResult = await getBelongsToAssociations(newIssueId);

    const row = result.rows[0];
    const issue = extractIssueFromRow(row);
    res.status(201).json({
      ...issue,
      display_id: `#${ticketNumber}`,
      belongs_to: belongsToResult,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update issue
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const id = String(req.params.id);
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = updateIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get full existing issue for history tracking (with visibility check)
    const existing = await client.query(
      `SELECT id, title, properties
       FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const existingIssue = existing.rows[0];
    const currentProps = existingIssue.properties || {};
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const data = parsed.data;

    // Validate: estimate required when assigning to a sprint via belongs_to
    if (data.belongs_to) {
      const hasSprintAssociation = data.belongs_to.some(bt => bt.type === 'sprint');
      if (hasSprintAssociation) {
        const effectiveEstimate = data.estimate !== undefined ? data.estimate : currentProps.estimate;
        if (!effectiveEstimate) {
          res.status(400).json({ error: 'Estimate is required before assigning to a week' });
          return;
        }
      }
    }

    // Check for incomplete children when closing parent
    const isClosingIssue = data.state && (data.state === 'done' || data.state === 'cancelled');
    const wasNotClosed = currentProps.state !== 'done' && currentProps.state !== 'cancelled';

    if (isClosingIssue && wasNotClosed) {
      // Check if this issue has any children via junction table
      const childrenResult = await client.query(
        `SELECT d.id, d.title, d.ticket_number, d.properties->>'state' as state
         FROM documents d
         JOIN document_associations da ON da.document_id = d.id
         WHERE da.related_id = $1
           AND da.relationship_type = 'parent'
           AND d.workspace_id = $2
           AND d.document_type = 'issue'`,
        [id, workspaceId]
      );

      // Filter to incomplete children
      const incompleteChildren = childrenResult.rows.filter(
        child => child.state !== 'done' && child.state !== 'cancelled'
      );

      if (incompleteChildren.length > 0 && !data.confirm_orphan_children) {
        // Return warning with incomplete children details
        res.status(409).json({
          error: 'incomplete_children',
          message: `This issue has ${incompleteChildren.length} incomplete sub-issue(s). Closing it will remove their parent association.`,
          incomplete_children: incompleteChildren.map(child => ({
            id: child.id,
            title: child.title,
            ticket_number: child.ticket_number,
            state: child.state,
          })),
          confirm_action: 'Set confirm_orphan_children: true to proceed',
        });
        return;
      }

      // If confirmed, orphan the children by removing their parent associations
      if (incompleteChildren.length > 0 && data.confirm_orphan_children) {
        await client.query(
          `DELETE FROM document_associations
           WHERE related_id = $1
             AND relationship_type = 'parent'`,
          [id]
        );
      }
    }

    // Track changes for history
    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];

    // Handle title update (regular column)
    if (data.title !== undefined && data.title !== existingIssue.title) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
      changes.push({ field: 'title', oldValue: existingIssue.title, newValue: data.title });
    }

    // Handle properties updates
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.state !== undefined && data.state !== currentProps.state) {
      changes.push({ field: 'state', oldValue: currentProps.state || null, newValue: data.state });
      newProps.state = data.state;
      propsChanged = true;

      // Update status timestamps based on state change
      const timestampUpdates = getTimestampUpdates(currentProps.state || null, data.state);
      for (const [col, expr] of Object.entries(timestampUpdates)) {
        updates.push(`${col} = ${expr}`);
      }
    }
    if (data.priority !== undefined && data.priority !== currentProps.priority) {
      changes.push({ field: 'priority', oldValue: currentProps.priority || null, newValue: data.priority });
      newProps.priority = data.priority;
      propsChanged = true;
    }
    if (data.assignee_id !== undefined && data.assignee_id !== currentProps.assignee_id) {
      changes.push({ field: 'assignee_id', oldValue: currentProps.assignee_id || null, newValue: data.assignee_id });
      newProps.assignee_id = data.assignee_id;
      propsChanged = true;
    }
    if (data.estimate !== undefined && data.estimate !== currentProps.estimate) {
      changes.push({ field: 'estimate', oldValue: currentProps.estimate?.toString() || null, newValue: data.estimate?.toString() || null });
      newProps.estimate = data.estimate;
      propsChanged = true;
    }

    // Store Claude metadata in properties for attribution tracking
    if (data.claude_metadata) {
      newProps.claude_metadata = {
        ...data.claude_metadata,
        updated_at: new Date().toISOString(),
      };
      propsChanged = true;
    }

    // Track the index in values array for properties (for later updates after carryover)
    let propsValueIndex = -1;
    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      propsValueIndex = values.length;
      values.push(JSON.stringify(newProps));
    }

    // Handle belongs_to association updates via junction table
    let belongsToChanged = false;
    let oldBelongsTo: BelongsToEntry[] = [];
    let newBelongsTo: BelongsToEntry[] = [];

    if (data.belongs_to !== undefined) {
      // Get existing associations for comparison
      oldBelongsTo = await getBelongsToAssociations(id);
      newBelongsTo = data.belongs_to;

      // Compare to see if associations changed
      const oldIds = oldBelongsTo.map(bt => `${bt.type}:${bt.id}`).sort().join(',');
      const newIds = newBelongsTo.map(bt => `${bt.type}:${bt.id}`).sort().join(',');

      if (oldIds !== newIds) {
        belongsToChanged = true;

        // Track carryover when moving from a completed sprint while issue is not done
        const oldSprintAssoc = oldBelongsTo.find(bt => bt.type === 'sprint');
        const newSprintAssoc = newBelongsTo.find(bt => bt.type === 'sprint');

        if (oldSprintAssoc && newSprintAssoc && oldSprintAssoc.id !== newSprintAssoc.id && currentProps.state !== 'done') {
          // Check if the old sprint is completed (based on end date)
          const oldSprintResult = await client.query(
            `SELECT properties->>'sprint_number' as sprint_number, w.sprint_start_date
             FROM documents d
             JOIN workspaces w ON d.workspace_id = w.id
             WHERE d.id = $1 AND d.document_type = 'sprint'`,
            [oldSprintAssoc.id]
          );

          if (oldSprintResult.rows[0]) {
            const sprintNumber = parseInt(oldSprintResult.rows[0].sprint_number, 10);
            const rawStartDate = oldSprintResult.rows[0].sprint_start_date;
            const sprintDuration = 7; // 1-week sprints

            let startDate: Date;
            if (rawStartDate instanceof Date) {
              startDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
            } else if (typeof rawStartDate === 'string') {
              startDate = new Date(rawStartDate + 'T00:00:00Z');
            } else {
              startDate = new Date();
            }

            // Calculate sprint end date
            const sprintEndDate = new Date(startDate);
            sprintEndDate.setUTCDate(sprintEndDate.getUTCDate() + (sprintNumber * sprintDuration) - 1);

            // If the old sprint has ended, mark this as a carryover
            if (new Date() > sprintEndDate) {
              newProps.carryover_from_sprint_id = oldSprintAssoc.id;
              propsChanged = true;
            }
          }
        } else if (oldSprintAssoc && !newSprintAssoc) {
          // Removing from sprint clears carryover
          delete newProps.carryover_from_sprint_id;
          propsChanged = true;
        }

        // Log belongs_to change
        changes.push({
          field: 'belongs_to',
          oldValue: JSON.stringify(oldBelongsTo.map(bt => ({ id: bt.id, type: bt.type }))),
          newValue: JSON.stringify(newBelongsTo.map(bt => ({ id: bt.id, type: bt.type }))),
        });
      }
    }

    // Re-check if properties changed (carryover may have been updated)
    if (propsChanged && propsValueIndex === -1) {
      // Properties weren't added yet, add now
      updates.push(`properties = $${paramIndex++}`);
      propsValueIndex = values.length;
      values.push(JSON.stringify(newProps));
    } else if (propsChanged && propsValueIndex >= 0) {
      // Update the existing properties value at the tracked index
      values[propsValueIndex] = JSON.stringify(newProps);
    }

    if (updates.length === 0 && !belongsToChanged) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    await client.query('BEGIN');

    // Log all changes to history (within transaction)
    const automatedBy = data.claude_metadata?.updated_by;
    for (const change of changes) {
      await logDocumentChange(id, change.field, change.oldValue, change.newValue, req.userId!, automatedBy, client);
    }

    // If we have document updates, do the UPDATE
    if (updates.length > 0) {
      updates.push(`updated_at = now()`);

      await client.query(
        `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1}`,
        [...values, id, req.workspaceId]
      );
    }

    // Handle belongs_to association updates in junction table
    if (belongsToChanged) {
      // Delete all existing associations for this document
      await client.query(
        `DELETE FROM document_associations WHERE document_id = $1`,
        [id]
      );

      // Insert new associations
      for (const assoc of newBelongsTo) {
        await client.query(
          `INSERT INTO document_associations (document_id, related_id, relationship_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
          [id, assoc.id, assoc.type]
        );
      }
    }

    // Fetch the updated issue
    const result = await client.query(
      `SELECT * FROM documents WHERE id = $1 AND workspace_id = $2`,
      [id, req.workspaceId]
    );

    await client.query('COMMIT');

    // Post-commit operations (non-transactional)

    // Check if a NEW sprint association was added and this is the first issue in that sprint
    if (belongsToChanged) {
      const oldSprintIds = oldBelongsTo.filter(bt => bt.type === 'sprint').map(bt => bt.id);
      const newSprintIds = newBelongsTo.filter(bt => bt.type === 'sprint').map(bt => bt.id);
      const addedSprintIds = newSprintIds.filter(sprintId => !oldSprintIds.includes(sprintId));

      for (const sprintId of addedSprintIds) {
        const issueCountResult = await pool.query(
          `SELECT COUNT(*) as count FROM document_associations
           WHERE related_id = $1 AND relationship_type = 'sprint'`,
          [sprintId]
        );
        const issueCount = parseInt(issueCountResult.rows[0].count, 10);

        if (issueCount === 1) {
          broadcastToUser(req.userId!, 'accountability:updated', { type: 'week_issues', targetId: sprintId });
        }
      }
    }

    const row = result.rows[0];
    const displayId = `#${row.ticket_number}`;

    const issue = extractIssueFromRow(row);
    const belongsTo = await getBelongsToAssociations(id);

    // Broadcast accountability update when an action item issue is completed
    if (isClosingIssue && wasNotClosed) {
      const props = row.properties || {};
      if (props.source === 'action_items') {
        const assigneeId = props.assignee_id || req.userId;
        broadcastToUser(assigneeId, 'accountability:updated', { issueId: id, state: data.state });
      }
    }

    res.json({ ...issue, display_id: displayId, belongs_to: belongsTo });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Update issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get issue history
router.get('/:id/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify issue exists and user can access it
    const issueCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (issueCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const result = await pool.query(
      `SELECT h.id, h.field, h.old_value, h.new_value, h.created_at, h.automated_by,
              u.id as changed_by_id, u.name as changed_by_name
       FROM document_history h
       LEFT JOIN users u ON h.changed_by = u.id
       WHERE h.document_id = $1
       ORDER BY h.created_at DESC`,
      [id]
    );

    res.json(result.rows.map(row => ({
      id: row.id,
      field: row.field,
      old_value: row.old_value,
      new_value: row.new_value,
      created_at: row.created_at,
      changed_by: row.changed_by_id ? {
        id: row.changed_by_id,
        name: row.changed_by_name,
      } : null,
      automated_by: row.automated_by,
    })));
  } catch (err) {
    console.error('Get issue history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log custom history entry (for verification failures, etc.)
const logHistorySchema = z.object({
  field: z.string().min(1).max(100),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  automated_by: z.string().optional(),
});

router.post('/:id/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Issue ID required' });
      return;
    }
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = logHistorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify issue exists and user can access it
    const issueCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (issueCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const { field, old_value, new_value, automated_by } = parsed.data;

    // Pass automated_by only if defined (function parameter is optional)
    if (automated_by !== undefined) {
      await logDocumentChange(id, field, old_value, new_value, userId, automated_by);
    } else {
      await logDocumentChange(id, field, old_value, new_value, userId);
    }

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Log history entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk update issues
const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['archive', 'delete', 'restore', 'update']),
  updates: z.object({
    state: issueStateSchema.optional(),
    sprint_id: z.string().uuid().nullable().optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
  }).optional(),
});

router.post('/bulk', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = bulkUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { ids, action, updates } = parsed.data;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    await client.query('BEGIN');

    // Verify all issues exist and user has access
    const accessCheck = await client.query(
      `SELECT id FROM documents
       WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [ids, workspaceId, userId, isAdmin]
    );

    const accessibleIds = new Set(accessCheck.rows.map(r => r.id));
    const failed: { id: string; error: string }[] = [];

    for (const id of ids) {
      if (!accessibleIds.has(id)) {
        failed.push({ id, error: 'Not found or no access' });
      }
    }

    const validIds = ids.filter(id => accessibleIds.has(id));

    if (validIds.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No valid issues found', failed });
      return;
    }

    let result;

    switch (action) {
      case 'archive':
        result = await client.query(
          `UPDATE documents SET archived_at = NOW(), updated_at = NOW()
           WHERE id = ANY($1) AND workspace_id = $2
           RETURNING *`,
          [validIds, workspaceId]
        );
        break;

      case 'delete':
        result = await client.query(
          `UPDATE documents SET deleted_at = NOW(), updated_at = NOW()
           WHERE id = ANY($1) AND workspace_id = $2
           RETURNING *`,
          [validIds, workspaceId]
        );
        break;

      case 'restore':
        result = await client.query(
          `UPDATE documents SET archived_at = NULL, deleted_at = NULL, updated_at = NOW()
           WHERE id = ANY($1) AND workspace_id = $2
           RETURNING *`,
          [validIds, workspaceId]
        );
        break;

      case 'update':
        if (!updates || Object.keys(updates).length === 0) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: 'Updates required for update action' });
          return;
        }

        const setClauses: string[] = ['updated_at = NOW()'];
        const values: unknown[] = [validIds, workspaceId];
        let paramIdx = 3;

        if (updates.state !== undefined) {
          // Update state in properties JSONB
          setClauses.push(`properties = jsonb_set(COALESCE(properties, '{}'), '{state}', $${paramIdx}::jsonb)`);
          values.push(JSON.stringify(updates.state));
          paramIdx++;
        }

        // Note: sprint_id is handled via document_associations table (see below)

        if (updates.assignee_id !== undefined) {
          // Update assignee_id in properties JSONB
          setClauses.push(`properties = jsonb_set(COALESCE(properties, '{}'), '{assignee_id}', $${paramIdx}::jsonb)`);
          values.push(updates.assignee_id === null ? 'null' : JSON.stringify(updates.assignee_id));
          paramIdx++;
        }

        result = await client.query(
          `UPDATE documents SET ${setClauses.join(', ')}
           WHERE id = ANY($1) AND workspace_id = $2
           RETURNING *`,
          values
        );

        // Handle project_id via document_associations table
        if (updates.project_id !== undefined) {
          // Remove existing project associations for all updated issues
          await client.query(
            `DELETE FROM document_associations
             WHERE document_id = ANY($1) AND relationship_type = 'project'`,
            [validIds]
          );

          // Add new project associations if project_id is not null
          if (updates.project_id !== null) {
            // Verify the project exists and user has access
            const projectCheck = await client.query(
              `SELECT id FROM documents
               WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
                 AND deleted_at IS NULL`,
              [updates.project_id, workspaceId]
            );

            if (projectCheck.rows.length > 0) {
              // Insert associations for all valid issues
              const insertValues = validIds.map((_, i) => `($${i + 1}, $${validIds.length + 1}, 'project')`).join(', ');
              await client.query(
                `INSERT INTO document_associations (document_id, related_id, relationship_type)
                 VALUES ${insertValues}
                 ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
                [...validIds, updates.project_id]
              );
            }
          }
        }

        // Handle sprint_id via document_associations table
        if (updates.sprint_id !== undefined) {
          // Remove existing sprint associations for all updated issues
          await client.query(
            `DELETE FROM document_associations
             WHERE document_id = ANY($1) AND relationship_type = 'sprint'`,
            [validIds]
          );

          // Add new sprint associations if sprint_id is not null
          if (updates.sprint_id !== null) {
            // Verify the sprint exists and user has access
            const sprintCheck = await client.query(
              `SELECT id FROM documents
               WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
                 AND deleted_at IS NULL`,
              [updates.sprint_id, workspaceId]
            );

            if (sprintCheck.rows.length > 0) {
              // Insert associations for all valid issues
              const insertValues = validIds.map((_, i) => `($${i + 1}, $${validIds.length + 1}, 'sprint')`).join(', ');
              await client.query(
                `INSERT INTO document_associations (document_id, related_id, relationship_type)
                 VALUES ${insertValues}
                 ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
                [...validIds, updates.sprint_id]
              );
            }
          }
        }
        break;

      default:
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Invalid action' });
        return;
    }

    await client.query('COMMIT');

    // Map results to issue format
    const updated = result.rows.map(row => {
      const issue = extractIssueFromRow(row);
      return {
        ...issue,
        display_id: `#${issue.ticket_number}`,
        archived_at: row.archived_at,
        deleted_at: row.deleted_at,
      };
    });

    res.json({ updated, failed });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk update issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete issue
// System-generated accountability issues cannot be deleted
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // First verify user can access the issue and check if system-generated
    const accessCheck = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (accessCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const props = accessCheck.rows[0].properties || {};

    // Block deletion of system-generated accountability issues
    if (props.is_system_generated) {
      res.status(403).json({
        error: 'Cannot delete system-generated accountability issues',
        message: 'This issue was automatically created for accountability tracking. Complete the underlying task to resolve it.',
      });
      return;
    }

    // Now delete it
    await pool.query(
      'DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = \'issue\'',
      [id, workspaceId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Delete issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept issue (move from triage to backlog)
router.post('/:id/accept', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get the issue
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const props = existing.rows[0].properties || {};

    // Verify the issue is in triage state
    if (props.state !== 'triage') {
      res.status(400).json({ error: 'Issue must be in triage state to be accepted' });
      return;
    }

    // Update state to backlog
    const newProps = { ...props, state: 'backlog' };
    const result = await pool.query(
      `UPDATE documents
       SET properties = $3, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, workspaceId, JSON.stringify(newProps)]
    );

    // Log the state change
    await logDocumentChange(id, 'state', 'triage', 'backlog', req.userId!);

    const issue = extractIssueFromRow(result.rows[0]);
    res.json({ ...issue, display_id: `#${issue.ticket_number}` });
  } catch (err) {
    console.error('Accept issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============== ITERATION ENDPOINTS ==============
// Iterations track Claude's work progress on individual issues

// Validation schemas for iterations
const createIterationSchema = z.object({
  status: z.enum(['pass', 'fail', 'in_progress']),
  what_attempted: z.string().max(5000).optional(),
  blockers_encountered: z.string().max(5000).optional(),
});

const listIterationsSchema = z.object({
  status: z.enum(['pass', 'fail', 'in_progress']).optional(),
});

// Create iteration entry - POST /api/issues/:id/iterations
router.post('/:id/iterations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id: issueId } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = createIterationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify issue exists and user can access it
    const issueCheck = await pool.query(
      `SELECT id, title FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [issueId, workspaceId, userId, isAdmin]
    );

    if (issueCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const { status, what_attempted, blockers_encountered } = parsed.data;

    const result = await pool.query(
      `INSERT INTO issue_iterations
       (issue_id, workspace_id, status, what_attempted, blockers_encountered, author_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [issueId, workspaceId, status, what_attempted || null, blockers_encountered || null, userId]
    );

    // Get author info
    const authorResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );

    const iteration = result.rows[0];
    const author = authorResult.rows[0];

    res.status(201).json({
      id: iteration.id,
      issue_id: iteration.issue_id,
      status: iteration.status,
      what_attempted: iteration.what_attempted,
      blockers_encountered: iteration.blockers_encountered,
      author: {
        id: author.id,
        name: author.name,
        email: author.email,
      },
      created_at: iteration.created_at,
      updated_at: iteration.updated_at,
    });
  } catch (err) {
    console.error('Create iteration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get issue iterations - GET /api/issues/:id/iterations
router.get('/:id/iterations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id: issueId } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Parse and validate query params
    const queryParsed = listIterationsSchema.safeParse(req.query);
    const queryParams = queryParsed.success ? queryParsed.data : {};

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify issue exists and user can access it
    const issueCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [issueId, workspaceId, userId, isAdmin]
    );

    if (issueCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    // Build query with optional filters
    let query = `
      SELECT i.*, u.name as author_name, u.email as author_email
      FROM issue_iterations i
      JOIN users u ON i.author_id = u.id
      WHERE i.issue_id = $1 AND i.workspace_id = $2
    `;
    const params: unknown[] = [issueId, workspaceId];
    let paramIndex = 3;

    // Filter by status
    if (queryParams.status) {
      query += ` AND i.status = $${paramIndex++}`;
      params.push(queryParams.status);
    }

    // Sort by timestamp descending (most recent first)
    query += ' ORDER BY i.created_at DESC';

    const result = await pool.query(query, params);

    const iterations = result.rows.map(row => ({
      id: row.id,
      issue_id: row.issue_id,
      status: row.status,
      what_attempted: row.what_attempted,
      blockers_encountered: row.blockers_encountered,
      author: {
        id: row.author_id,
        name: row.author_name,
        email: row.author_email,
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json(iterations);
  } catch (err) {
    console.error('Get iterations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject issue (move from triage to cancelled with reason)
router.post('/:id/reject', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = rejectIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    const { reason } = parsed.data;

    // Get visibility context
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get the issue
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const props = existing.rows[0].properties || {};

    // Verify the issue is in triage state
    if (props.state !== 'triage') {
      res.status(400).json({ error: 'Issue must be in triage state to be rejected' });
      return;
    }

    // Update state to cancelled and store rejection reason
    const newProps = { ...props, state: 'cancelled', rejection_reason: reason };
    const result = await pool.query(
      `UPDATE documents
       SET properties = $3, cancelled_at = NOW(), updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, workspaceId, JSON.stringify(newProps)]
    );

    // Log the state change
    await logDocumentChange(id, 'state', 'triage', 'cancelled', req.userId!);

    const issue = extractIssueFromRow(result.rows[0]);
    res.json({ ...issue, display_id: `#${issue.ticket_number}` });
  } catch (err) {
    console.error('Reject issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
