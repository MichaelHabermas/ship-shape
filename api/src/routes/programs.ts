// Program routes expose program documents and visibility-filtered child graph summaries.
import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  guardDocumentIdParam,
  requireDocumentCreate,
  requireProgramRead,
  requireProgramWrite,
} from '../security/route-capability.js';
import { logAuditEvent } from '../services/audit.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import { formatWireDate } from '../utils/format-wire-date.js';
import {
  visibleAssociatedDocumentCountSql,
  visibleAssociatedIssueCountSql,
  visibleAssociatedIssueEstimateSumSql,
  visibleDocumentPredicate,
} from '../services/document-graph-visibility.js';

const router = Router();

async function guardProgramRead(
  req: Request,
  res: Response,
  rawId: string | string[] | undefined
): Promise<string | null> {
  const id = guardDocumentIdParam(res, rawId, 'Program not found');
  if (!id) return null;
  if (!(await requireProgramRead(req, res, id))) {
    return null;
  }
  return id;
}

async function guardProgramWrite(
  req: Request,
  res: Response,
  rawId: string | string[] | undefined
): Promise<string | null> {
  const id = guardDocumentIdParam(res, rawId, 'Program not found');
  if (!id) return null;
  if (!(await requireProgramWrite(req, res, id))) {
    return null;
  }
  return id;
}

type ProgramProperties = {
  color?: string;
  emoji?: string | null;
  prefix?: string;
  owner_id?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
};

type ProgramRow = {
  id: string;
  title: string;
  properties: ProgramProperties | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  issue_count?: string | number | null;
  sprint_count?: string | number | null;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
};

type ProgramOwnerRow = {
  id: string;
  name: string;
  email: string;
};

type ProgramExistsRow = {
  id: string;
  properties?: ProgramProperties | null;
  sprint_start_date?: Date | string | null;
};

type ProgramIssueRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  ticket_number: number | string | null;
  sprint_id: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  assignee_name: string | null;
  assignee_archived: boolean | 't' | 'f' | null;
};

type ProgramProjectRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  program_id: string;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  sprint_count: string | number | null;
  issue_count: string | number | null;
};

type ProgramSprintRow = {
  id: string;
  name: string;
  properties: Record<string, unknown> | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  issue_count: string | number | null;
  completed_count: string | number | null;
  started_count: string | number | null;
  total_estimate_hours: string | number | null;
  has_plan: boolean | 't' | 'f' | null;
  has_retro: boolean | 't' | 'f' | null;
  plan_created_at: Date | null;
  retro_created_at: Date | null;
};

type MergePreviewProgramRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  archived_at: Date | null;
};

type MergeCountRow = {
  document_type: string;
  count: string | number;
};

type CountRow = {
  count: string | number;
};

type MovedChildRow = {
  document_id: string;
  document_type: string;
};

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function requireFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error('Expected query to return a row');
  }
  return row;
}

// Helper to extract program from row
function extractProgramFromRow(row: ProgramRow) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    color: props.color || '#6366f1',
    emoji: props.emoji || null,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    issue_count: row.issue_count,
    sprint_count: row.sprint_count,
    // owner_id in properties takes precedence over created_by
    owner: row.owner_name ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    owner_id: props.owner_id || null,
    // RACI fields
    accountable_id: props.accountable_id || null,
    consulted_ids: props.consulted_ids || [],
    informed_ids: props.informed_ids || [],
  };
}

// Validation schemas
const createProgramSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
  owner_id: z.string().uuid().optional().nullable().default(null), // R - Responsible (does the work)
  accountable_id: z.string().uuid().optional().nullable().default(null), // A - Accountable (approver)
  consulted_ids: z.array(z.string().uuid()).optional().default([]), // C - Consulted (provide input)
  informed_ids: z.array(z.string().uuid()).optional().default([]), // I - Informed (kept in loop)
});

const updateProgramSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(), // R - Responsible (can be cleared)
  accountable_id: z.string().uuid().optional().nullable(), // A - Accountable (can be cleared)
  consulted_ids: z.array(z.string().uuid()).optional(), // C - Consulted
  informed_ids: z.array(z.string().uuid()).optional(), // I - Informed
  archived_at: z.string().datetime().optional().nullable(),
});

// List programs (documents with document_type = 'program')
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.archived === 'true';
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // owner_id in properties takes precedence over created_by
    let query = `
      SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
             COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
             u.name as owner_name, u.email as owner_email,
             (${visibleAssociatedDocumentCountSql('i', 'program', 'issue', 'd', '$2', '$3')}) as issue_count,
             (${visibleAssociatedDocumentCountSql('s', 'program', 'sprint', 'd', '$2', '$3')}) as sprint_count
      FROM documents d
      LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
      WHERE d.workspace_id = $1 AND d.document_type = 'program'
        AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
    `;
    const params: (string | boolean)[] = [workspaceId, userId, isAdmin];

    if (!includeArchived) {
      query += ` AND d.archived_at IS NULL`;
    }

    query += ` ORDER BY d.created_at DESC`;

    const result = await pool.query<ProgramRow>(query, params);
    res.json(result.rows.map(extractProgramFromRow));
  } catch (err) {
    sendInternalError(res, err, 'List programs error:');
  }
});

// Get single program
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProgramRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // owner_id in properties takes precedence over created_by
    const result = await pool.query<ProgramRow>(
      `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
              COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
              u.name as owner_name, u.email as owner_email,
              (${visibleAssociatedDocumentCountSql('i', 'program', 'issue', 'd', '$3', '$4')}) as issue_count,
              (${visibleAssociatedDocumentCountSql('s', 'program', 'sprint', 'd', '$3', '$4')}) as sprint_count
       FROM documents d
       LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    res.json(extractProgramFromRow(requireFirstRow(result.rows)));
  } catch (err) {
    sendInternalError(res, err, 'Get program error:');
  }
});

// Create program (creates a document with document_type = 'program')
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createProgramSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { title, color, emoji, owner_id, accountable_id, consulted_ids, informed_ids } = parsed.data;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    if (!(await requireDocumentCreate(req, res))) {
      return;
    }

    // Build properties JSONB with RACI fields
    const properties: Record<string, unknown> = {
      color: color || '#6366f1',
      owner_id, // R - Responsible
      accountable_id, // A - Accountable
      consulted_ids, // C - Consulted
      informed_ids, // I - Informed
    };
    if (emoji) {
      properties.emoji = emoji;
    }

    const result = await pool.query<ProgramRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'program', $2, $3, $4)
       RETURNING id, title, properties, archived_at, created_at, updated_at`,
      [workspaceId, title, JSON.stringify(properties), userId]
    );

    // Get user info for owner response
    const userResult = await pool.query<ProgramOwnerRow>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    res.status(201).json({
      ...extractProgramFromRow(requireFirstRow(result.rows)),
      issue_count: 0,
      sprint_count: 0,
      owner: user ? {
        id: user.id,
        name: user.name,
        email: user.email,
      } : null
    });
  } catch (err) {
    sendInternalError(res, err, 'Create program error:');
  }
});

// Update program
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProgramWrite(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = updateProgramSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const existing = await pool.query<ProgramExistsRow>(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
      [id, workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    const currentProps = requireFirstRow(existing.rows).properties || {};
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const data = parsed.data;

    // Handle title update (regular column)
    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }

    // Handle properties updates
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.color !== undefined) {
      newProps.color = data.color;
      propsChanged = true;
    }

    if (data.emoji !== undefined) {
      newProps.emoji = data.emoji;
      propsChanged = true;
    }

    if (data.owner_id !== undefined) {
      newProps.owner_id = data.owner_id;
      propsChanged = true;
    }

    if (data.accountable_id !== undefined) {
      if (!isAdmin) {
        res.status(403).json({ error: 'Only workspace admins can change accountable_id' });
        return;
      }
      newProps.accountable_id = data.accountable_id;
      propsChanged = true;
    }

    if (data.consulted_ids !== undefined) {
      newProps.consulted_ids = data.consulted_ids;
      propsChanged = true;
    }

    if (data.informed_ids !== undefined) {
      newProps.informed_ids = data.informed_ids;
      propsChanged = true;
    }

    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    // Handle archived_at (regular column)
    if (data.archived_at !== undefined) {
      updates.push(`archived_at = $${paramIndex++}`);
      values.push(data.archived_at);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'program'`,
      [...values, id, workspaceId]
    );

    // Re-query to get full program with owner info
    const result = await pool.query<ProgramRow>(
      `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
              COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
              u.name as owner_name, u.email as owner_email
       FROM documents d
       LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
       WHERE d.id = $1 AND d.document_type = 'program'`,
      [id]
    );

    res.json(extractProgramFromRow(requireFirstRow(result.rows)));
  } catch (err) {
    sendInternalError(res, err, 'Update program error:');
  }
});

// Delete program
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProgramWrite(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Remove associations to this program
    await pool.query(
      `DELETE FROM document_associations WHERE related_id = $1 AND relationship_type = 'program'`,
      [id]
    );

    // Now delete it
    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
      [id, workspaceId]
    );

    res.status(204).send();
  } catch (err) {
    sendInternalError(res, err, 'Delete program error:');
  }
});

// Get program issues
router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProgramRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Also filter the issues by visibility - join via document_associations
    const result = await pool.query<ProgramIssueRow>(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived,
              sprint_da.related_id as sprint_id
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
       LEFT JOIN document_associations sprint_da ON sprint_da.document_id = d.id AND sprint_da.relationship_type = 'sprint'
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       WHERE d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id, userId, isAdmin]
    );

    // Add display_id to each issue and extract properties
    const issues = result.rows.map(row => {
      const props = row.properties || {};
      return {
        id: row.id,
        title: row.title,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        estimate: props.estimate ?? null,
        ticket_number: row.ticket_number,
        sprint_id: row.sprint_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        assignee_name: row.assignee_name,
        assignee_archived: row.assignee_archived || false,
        display_id: `#${row.ticket_number}`
      };
    });

    res.json(issues);
  } catch (err) {
    sendInternalError(res, err, 'Get program issues error:');
  }
});

// Get program projects (documents with document_type = 'project' that belong to this program)
router.get('/:id/projects', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProgramRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Fetch projects belonging to this program via document_associations
    const result = await pool.query<ProgramProjectRow>(
      `SELECT d.id, d.title, d.properties, $1::uuid as program_id, d.archived_at, d.created_at, d.updated_at,
              (d.properties->>'owner_id')::uuid as owner_id,
              u.name as owner_name, u.email as owner_email,
              (${visibleAssociatedDocumentCountSql('s', 'project', 'sprint', 'd', '$2', '$3')}) as sprint_count,
              (${visibleAssociatedDocumentCountSql('i', 'project', 'issue', 'd', '$2', '$3')}) as issue_count
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
       LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
       WHERE d.document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
         AND d.archived_at IS NULL
       ORDER BY
         ((COALESCE((d.properties->>'impact')::int, 3) * COALESCE((d.properties->>'confidence')::int, 3) * COALESCE((d.properties->>'ease')::int, 3))) DESC`,
      [id, userId, isAdmin]
    );

    // Transform rows to project format
    const projects = result.rows.map(row => {
      const props = row.properties || {};
      const impact = toNumber(props.impact as string | number | null | undefined) || 3;
      const confidence = toNumber(props.confidence as string | number | null | undefined) || 3;
      const ease = toNumber(props.ease as string | number | null | undefined) || 3;

      return {
        id: row.id,
        title: row.title,
        impact,
        confidence,
        ease,
        ice_score: impact * confidence * ease,
        color: props.color || '#6366f1',
        emoji: props.emoji || null,
        program_id: row.program_id,
        archived_at: row.archived_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        owner: row.owner_name ? {
          id: row.owner_id,
          name: row.owner_name,
          email: row.owner_email,
        } : null,
        sprint_count: toNumber(row.sprint_count),
        issue_count: toNumber(row.issue_count),
      };
    });

    res.json(projects);
  } catch (err) {
    sendInternalError(res, err, 'Get program projects error:');
  }
});

// Get program sprints (documents with document_type = 'sprint' that belong to this program)
// Returns sprints with sprint_number and owner_id - dates/status computed on frontend
router.get('/:id/sprints', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProgramRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const programCheck = await pool.query<ProgramExistsRow>(
      `SELECT d.id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'program'`,
      [id, workspaceId]
    );

    const sprintStartDate = requireFirstRow(programCheck.rows).sprint_start_date;
    const wireStartDate = formatWireDate(sprintStartDate);
    if (!wireStartDate) {
      res.status(500).json({ error: 'Workspace sprint start date is not configured' });
      return;
    }

    // Also filter sprints by visibility - join via document_associations
    // Include subqueries for weekly_plan and weekly_retro existence
    const result = await pool.query<ProgramSprintRow>(
      `SELECT d.id, d.title as name, d.properties,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (${visibleAssociatedIssueCountSql('i', 'sprint', 'd', '$2', '$3')}) as issue_count,
              (${visibleAssociatedIssueCountSql('i', 'sprint', 'd', '$2', '$3', "i.properties->>'state' = 'done'")}) as completed_count,
              (${visibleAssociatedIssueCountSql('i', 'sprint', 'd', '$2', '$3', "i.properties->>'state' IN ('in_progress', 'in_review')")}) as started_count,
              (${visibleAssociatedIssueEstimateSumSql('i', 'sprint', 'd', '$2', '$3')}) as total_estimate_hours,
              (SELECT COUNT(*) > 0 FROM documents p WHERE p.parent_id = d.id AND p.document_type = 'weekly_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents r WHERE r.parent_id = d.id AND r.document_type = 'weekly_retro') as has_retro,
              (SELECT created_at FROM documents p WHERE p.parent_id = d.id AND p.document_type = 'weekly_plan' LIMIT 1) as plan_created_at,
              (SELECT created_at FROM documents r WHERE r.parent_id = d.id AND r.document_type = 'weekly_retro' LIMIT 1) as retro_created_at
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY (d.properties->>'sprint_number')::int ASC`,
      [id, userId, isAdmin]
    );

    // Extract sprint properties - dates/status computed by frontend
    const sprints = result.rows.map(row => {
      const props = row.properties || {};
      return {
        id: row.id,
        name: row.name,
        sprint_number: props.sprint_number || 1,
        status: props.status || 'planning',  // Default to 'planning' for sprints without status
        owner: row.owner_id ? {
          id: row.owner_id,
          name: row.owner_name,
          email: row.owner_email,
        } : null,
        issue_count: toNumber(row.issue_count),
        completed_count: toNumber(row.completed_count),
        started_count: toNumber(row.started_count),
        total_estimate_hours: toNumber(row.total_estimate_hours),
        has_plan: row.has_plan === true || row.has_plan === 't',
        has_retro: row.has_retro === true || row.has_retro === 't',
        plan_created_at: row.plan_created_at || null,
        retro_created_at: row.retro_created_at || null,
        // Plan tracking - what will we learn/validate?
        plan: props.plan || null,
      };
    });

    res.json({
      workspace_sprint_start_date: wireStartDate,
      weeks: sprints,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get program sprints error:');
  }
});

// ============== Program Merge ==============

// Merge preview - returns counts of entities that will be moved
router.get('/:id/merge-preview', authMiddleware, async (req: Request, res: Response) => {
  try {
    const sourceId = await guardProgramRead(req, res, req.params.id);
    if (!sourceId) return;
    const targetId = req.query.target_id as string;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    if (!targetId) {
      res.status(400).json({ error: 'target_id query parameter is required' });
      return;
    }

    if (sourceId === targetId) {
      res.status(400).json({ error: 'Cannot merge a program into itself' });
      return;
    }

    if (!(await requireProgramRead(req, res, targetId))) {
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Fetch both programs
    const programsResult = await pool.query<MergePreviewProgramRow>(
      `SELECT id, title, properties, archived_at
       FROM documents
       WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [[sourceId, targetId], workspaceId, userId, isAdmin]
    );

    const sourceProgram = programsResult.rows.find(r => r.id === sourceId);
    const targetProgram = programsResult.rows.find(r => r.id === targetId);

    if (!sourceProgram) {
      res.status(404).json({ error: 'Source program not found' });
      return;
    }
    if (!targetProgram) {
      res.status(404).json({ error: 'Target program not found' });
      return;
    }
    if (sourceProgram.archived_at) {
      res.status(400).json({ error: 'Source program is archived' });
      return;
    }
    if (targetProgram.archived_at) {
      res.status(400).json({ error: 'Target program is archived' });
      return;
    }

    // Count child entities via document_associations
    const countsResult = await pool.query<MergeCountRow>(
      `SELECT d.document_type, COUNT(*) as count
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
       WHERE ${visibleDocumentPredicate('d', '$2', '$3')}
       GROUP BY d.document_type`,
      [sourceId, userId, isAdmin]
    );

    // Count direct child documents (parent_id pointing at source program)
    const childDocsResult = await pool.query<CountRow>(
      `SELECT COUNT(*) as count FROM documents d WHERE d.parent_id = $1 AND ${visibleDocumentPredicate('d', '$2', '$3')}`,
      [sourceId, userId, isAdmin]
    );

    const counts: Record<string, number> = {
      projects: 0,
      issues: 0,
      sprints: 0,
      wikis: toNumber(childDocsResult.rows[0]?.count),
    };

    for (const row of countsResult.rows) {
      if (row.document_type === 'project') counts.projects = toNumber(row.count);
      else if (row.document_type === 'issue') counts.issues = toNumber(row.count);
      else if (row.document_type === 'sprint') counts.sprints = toNumber(row.count);
    }

    // Check for conflicts
    const conflicts: Array<{ type: string; message: string }> = [];
    const sourcePrefix = typeof sourceProgram.properties?.prefix === 'string' ? sourceProgram.properties.prefix : null;
    const targetPrefix = typeof targetProgram.properties?.prefix === 'string' ? targetProgram.properties.prefix : null;
    if (sourcePrefix && targetPrefix) {
      conflicts.push({
        type: 'prefix_conflict',
        message: `Both programs have prefixes set (source: "${sourcePrefix}", target: "${targetPrefix}"). The source prefix will be cleared during merge.`,
      });
    }

    res.json({
      source: { id: sourceProgram.id, name: sourceProgram.title },
      target: { id: targetProgram.id, name: targetProgram.title },
      counts,
      conflicts,
    });
  } catch (err) {
    sendInternalError(res, err, 'Merge preview error:');
  }
});

// Merge execution - re-parents all children, archives source
const mergeProgramSchema = z.object({
  target_id: z.string().uuid(),
  confirm_name: z.string().min(1),
});

router.post('/:id/merge', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const sourceId = await guardProgramWrite(req, res, req.params.id);
    if (!sourceId) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = mergeProgramSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { target_id: targetId, confirm_name: confirmName } = parsed.data;

    if (sourceId === targetId) {
      res.status(400).json({ error: 'Cannot merge a program into itself' });
      return;
    }

    if (!(await requireProgramWrite(req, res, targetId))) {
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Fetch both programs
    const programsResult = await pool.query<MergePreviewProgramRow>(
      `SELECT id, title, properties, archived_at
       FROM documents
       WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [[sourceId, targetId], workspaceId, userId, isAdmin]
    );

    const sourceProgram = programsResult.rows.find(r => r.id === sourceId);
    const targetProgram = programsResult.rows.find(r => r.id === targetId);

    if (!sourceProgram) {
      res.status(404).json({ error: 'Source program not found' });
      return;
    }
    if (!targetProgram) {
      res.status(404).json({ error: 'Target program not found' });
      return;
    }
    if (sourceProgram.archived_at) {
      res.status(400).json({ error: 'Source program is archived' });
      return;
    }
    if (targetProgram.archived_at) {
      res.status(400).json({ error: 'Target program is archived' });
      return;
    }

    // Type-to-confirm safeguard
    if (confirmName !== sourceProgram.title) {
      res.status(409).json({ error: 'Confirmation name does not match the source program name' });
      return;
    }

    await client.query('BEGIN');

    // 1. Get all child document IDs before re-parenting (for history logging)
    const childrenResult = await client.query<MovedChildRow>(
      `SELECT da.document_id, d.document_type
       FROM document_associations da
       JOIN documents d ON d.id = da.document_id
       WHERE da.related_id = $1 AND da.relationship_type = 'program'`,
      [sourceId]
    );

    // 2. Re-parent all document_associations from source to target
    //    First, remove source associations where the child already has a target association
    //    (prevents unique constraint violation on (document_id, related_id, relationship_type))
    await client.query(
      `DELETE FROM document_associations
       WHERE related_id = $1 AND relationship_type = 'program'
         AND document_id IN (
           SELECT document_id FROM document_associations
           WHERE related_id = $2 AND relationship_type = 'program'
         )`,
      [sourceId, targetId]
    );

    //    Then update remaining source associations to point to target
    const reParentResult = await client.query(
      `UPDATE document_associations
       SET related_id = $1
       WHERE related_id = $2 AND relationship_type = 'program'`,
      [targetId, sourceId]
    );

    // 3. Re-parent all direct children (parent_id pointing at source)
    const childReParentResult = await client.query(
      `UPDATE documents SET parent_id = $1 WHERE parent_id = $2`,
      [targetId, sourceId]
    );

    // 4. Log history for each moved entity (using client, not pool, to stay in transaction)
    for (const child of childrenResult.rows) {
      await client.query(
        `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          child.document_id,
          'belongs_to',
          JSON.stringify([{ id: sourceId, type: 'program' }]),
          JSON.stringify([{ id: targetId, type: 'program' }]),
          userId,
        ]
      );
    }

    // 5. Store merge metadata in source program properties and archive it
    const mergedProps = {
      ...(sourceProgram.properties || {}),
      merged_into_id: targetId,
      merged_at: new Date().toISOString(),
      merged_by: userId,
    };

    await client.query(
      `UPDATE documents
       SET properties = $1, archived_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(mergedProps), sourceId]
    );

    // 6. Log audit event
    await logAuditEvent({
      workspaceId,
      actorUserId: userId,
      action: 'program.merge',
      resourceType: 'program',
      resourceId: sourceId,
      details: {
        source_id: sourceId,
        source_name: sourceProgram.title,
        target_id: targetId,
        target_name: targetProgram.title,
        entities_moved: {
          associations: reParentResult.rowCount,
          child_docs: childReParentResult.rowCount,
        },
      },
      req,
    });

    await client.query('COMMIT');

    // Return updated target program
    const result = await pool.query<ProgramRow>(
      `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
              COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
              u.name as owner_name, u.email as owner_email,
              (${visibleAssociatedDocumentCountSql('i', 'program', 'issue', 'd', '$2', '$3')}) as issue_count,
              (${visibleAssociatedDocumentCountSql('s', 'program', 'sprint', 'd', '$2', '$3')}) as sprint_count
       FROM documents d
       LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
       WHERE d.id = $1 AND d.document_type = 'program'`,
      [targetId, userId, isAdmin]
    );

    res.json(extractProgramFromRow(requireFirstRow(result.rows)));
  } catch (err) {
    await client.query('ROLLBACK');
    sendInternalError(res, err, 'Merge program error:');
  } finally {
    client.release();
  }
});

export default router;
