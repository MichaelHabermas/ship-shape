// Program routes expose program documents and visibility-filtered child graph summaries.
import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  guardDocumentIdParam,
  requireProgramRead,
} from '../security/route-capability.js';
import { principalFromRequest } from '../security/principal.js';
import {
  createProgram,
  deleteProgram,
  extractProgramFromRow,
  mergePrograms,
  previewProgramMerge,
  updateProgram,
  type ProgramRow,
  type ProgramServiceResult,
} from '../services/programs-service.js';
import {
  createProgramSchema,
  mergeProgramSchema,
  updateProgramSchema,
} from '../schemas/programs.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import { formatWireDate } from '../utils/format-wire-date.js';
import {
  visibleAssociatedDocumentCountSql,
  visibleAssociatedIssueCountSql,
  visibleAssociatedIssueEstimateSumSql,
} from '../services/document-graph-visibility.js';

const router = Router();

function respondProgram<T>(res: Response, result: ProgramServiceResult<T>): void {
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  if (result.status === 204) {
    res.status(204).send();
    return;
  }
  res.status(result.status).json(result.body);
}

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

function guardProgramId(
  res: Response,
  rawId: string | string[] | undefined
): string | null {
  return guardDocumentIdParam(res, rawId, 'Program not found');
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

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    respondProgram(
      res,
      await createProgram({
        principal: principalFromRequest(req),
        workspaceId,
        userId,
        data: parsed.data,
      })
    );
  } catch (err) {
    sendInternalError(res, err, 'Create program error:');
  }
});

// Update program
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardProgramId(res, req.params.id);
    if (!id) return;
    const parsed = updateProgramSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondProgram(
      res,
      await updateProgram({
        principal: principalFromRequest(req),
        programId: id,
        workspaceId,
        isAdmin,
        data: parsed.data,
      })
    );
  } catch (err) {
    sendInternalError(res, err, 'Update program error:');
  }
});

// Delete program
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardProgramId(res, req.params.id);
    if (!id) return;
    const { workspaceId } = getAuthenticatedRouteContext(req);

    respondProgram(
      res,
      await deleteProgram({
        principal: principalFromRequest(req),
        programId: id,
        workspaceId,
      })
    );
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
    const sourceId = guardProgramId(res, req.params.id);
    if (!sourceId) return;
    const targetId = req.query.target_id as string;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    if (!targetId) {
      res.status(400).json({ error: 'target_id query parameter is required' });
      return;
    }

    if (!guardProgramId(res, targetId)) {
      return;
    }

    const result = await previewProgramMerge({
      principal: principalFromRequest(req),
      sourceId,
      targetId,
      workspaceId,
      userId,
      isAdmin: (await getVisibilityContext(userId, workspaceId)).isAdmin,
    });

    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }

    res.json(result.body);
  } catch (err) {
    sendInternalError(res, err, 'Merge preview error:');
  }
});

router.post('/:id/merge', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const sourceId = guardProgramId(res, req.params.id);
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

    if (!guardProgramId(res, targetId)) {
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await mergePrograms({
      client,
      principal: principalFromRequest(req),
      sourceId,
      targetId,
      workspaceId,
      userId,
      confirmName,
      isAdmin,
      req,
    });

    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }

    respondProgram(res, result);
  } catch (err) {
    await client.query('ROLLBACK');
    sendInternalError(res, err, 'Merge program error:');
  } finally {
    client.release();
  }
});

export default router;
