import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import {
  extractIssueFromRow,
  getIssueDetailById,
  getIssueDetailByTicketNumber,
  listIssueChildren,
  listIssuesMetadata,
  type IssueDetailRow,
} from '../db/documents-repository.js';
import { z } from 'zod';
import type { IssueProperties } from '@ship/shared';
import { getVisibilityContext } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import {
  createIssueRequestSchema,
  issuePrioritySchema,
  issueSourceSchema,
  issueStateSchema,
  updateIssueRequestSchema,
} from '../schemas/document-boundary.js';
import {
  logDocumentChange,
  getBelongsToAssociations,
  getBelongsToAssociationsBatch,
} from '../utils/document-crud.js';
import {
  getActor,
  getDocumentAccessContext,
  getReadableDocument,
  type DocumentActor,
} from '../services/document-access.js';
import { principalFromRequest } from '../security/principal.js';
import {
  guardDocumentIdParam,
  requireIssueRead,
  requireIssueWrite,
} from '../security/route-capability.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import {
  acceptIssueMutation,
  bulkUpdateIssuesMutation,
  createIssueIterationMutation,
  createIssueMutation,
  listIssueIterations,
  rejectIssueMutation,
  updateIssueMutation,
  type IssueMutationResult,
} from '../services/issue-mutations-service.js';
import {
  mapIssueActionItemRow,
  mapIssueHistoryRow,
  mapIssueListItem,
  type IssueActionItemRow,
  type IssueHistoryRow,
} from '../utils/issue-response.js';
import { requireFirstRow } from '../utils/query-rows.js';

const router = Router();

type PersonIdRow = { id: string };
type IssuePropertiesRow = {
  id: string;
  properties: IssueProperties | Record<string, unknown> | null;
};

// Validation schemas
const createIssueSchema = createIssueRequestSchema;

const updateIssueSchema = updateIssueRequestSchema;

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

function respondIssueMutation<T>(res: Response, result: IssueMutationResult<T>): void {
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.status(result.status).json(result.body);
}

async function sendIssueDetailResponse(
  res: Response,
  row: IssueDetailRow,
  actor: DocumentActor
): Promise<void> {
  if (row.converted_to_id) {
    const newDoc = await getReadableDocument(pool, actor, row.converted_to_id);

    if (newDoc) {
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
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const rows = await listIssuesMetadata(workspaceId, userId, isAdmin, {
      state,
      priority,
      assignee_id,
      program_id,
      project_id,
      sprint_id,
      source,
      parent_filter,
    });

    // Extract issues and batch-fetch associations to avoid N+1 queries
    const issueIds = rows.map(row => row.id);
    const associationsMap = await getBelongsToAssociationsBatch(issueIds);

    const issues = rows.map(row => mapIssueListItem(row, associationsMap.get(row.id) || []));

    res.json(issues);
  } catch (err) {
    sendInternalError(res, err, 'List issues error:');
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

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get person document ID for the user
    const personResult = await pool.query<PersonIdRow>(
      `SELECT id FROM documents
       WHERE workspace_id = $1 AND document_type = 'person'
         AND properties->>'user_id' = $2`,
      [workspaceId, userId]
    );
    const personDocId = personResult.rows[0]?.id;

    // Get action items: issues with source='action_items' assigned to current user, not done
    const result = await pool.query<IssueActionItemRow>(
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

    const items = result.rows.map(row => mapIssueActionItemRow(row, today));

    res.json({
      items,
      total: items.length,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get action items error:');
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

    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    const row = await getIssueDetailByTicketNumber(
      ticketNumber,
      actor.workspaceId,
      actor.userId,
      isAdmin
    );

    if (!row) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    if (!(await requireIssueRead(req, res, row.id))) {
      return;
    }

    await sendIssueDetailResponse(res, row, actor);
  } catch (err) {
    sendInternalError(res, err, 'Get issue by ticket error');
  }
});

// Get sub-issues (children) of an issue
router.get('/:id/children', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id || !(await requireIssueRead(req, res, id))) {
      return;
    }

    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    const rows = await listIssueChildren(id, actor.workspaceId, actor.userId, isAdmin);

    // Batch-fetch associations to avoid N+1 queries
    const childIds = rows.map(row => row.id);
    const associationsMap = await getBelongsToAssociationsBatch(childIds);

    const children = rows.map(row => {
      const issue = extractIssueFromRow(row);
      return {
        ...issue,
        display_id: `#${issue.ticket_number}`,
        belongs_to: associationsMap.get(row.id) || [],
      };
    });

    res.json(children);
  } catch (err) {
    sendInternalError(res, err, 'Get issue children error');
  }
});

// Get single issue
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id || !(await requireIssueRead(req, res, id))) {
      return;
    }

    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    const row = await getIssueDetailById(id, actor.workspaceId, actor.userId, isAdmin);

    if (!row) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    await sendIssueDetailResponse(res, row, actor);
  } catch (err) {
    sendInternalError(res, err, 'Get issue error');
  }
});

// Create issue
// Uses advisory lock to prevent race condition in ticket number generation
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const parsed = createIssueSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const client = await pool.connect();
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const result = await createIssueMutation({
      client,
      actor: getActor(req),
      principal: principalFromRequest(req),
      userId,
      workspaceId,
      data: parsed.data,
    });
    respondIssueMutation(res, result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendInternalError(res, err, 'Create issue error:');
  } finally {
    client.release();
  }
});

// Update issue
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  const parsed = updateIssueSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const client = await pool.connect();
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const result = await updateIssueMutation({
      client,
      actor: getActor(req),
      principal: principalFromRequest(req),
      userId,
      workspaceId,
      issueId: id,
      data: parsed.data,
    });
    respondIssueMutation(res, result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendInternalError(res, err, 'Update issue error:');
  } finally {
    client.release();
  }
});

// Get issue history
router.get('/:id/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id || !(await requireIssueRead(req, res, id))) {
      return;
    }

    const result = await pool.query<IssueHistoryRow>(
      `SELECT h.id, h.field, h.old_value, h.new_value, h.created_at, h.automated_by,
              u.id as changed_by_id, u.name as changed_by_name
       FROM document_history h
       LEFT JOIN users u ON h.changed_by = u.id
       WHERE h.document_id = $1
       ORDER BY h.created_at DESC`,
      [id]
    );

    res.json(result.rows.map(mapIssueHistoryRow));
  } catch (err) {
    sendInternalError(res, err, 'Get issue history error:');
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
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id || !(await requireIssueWrite(req, res, id))) {
      return;
    }

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = logHistorySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
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
    sendInternalError(res, err, 'Log history entry error:');
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
  const parsed = bulkUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const client = await pool.connect();
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const result = await bulkUpdateIssuesMutation({
      client,
      principal: principalFromRequest(req),
      userId,
      workspaceId,
      ids: parsed.data.ids,
      action: parsed.data.action,
      updates: parsed.data.updates,
    });
    respondIssueMutation(res, result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendInternalError(res, err, 'Bulk update issues error:');
  } finally {
    client.release();
  }
});

// Delete issue
// System-generated accountability issues cannot be deleted
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id || !(await requireIssueWrite(req, res, id, 'creator_or_admin'))) {
      return;
    }
    const { workspaceId } = getAuthenticatedRouteContext(req);

    const accessCheck = await pool.query<IssuePropertiesRow>(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, workspaceId]
    );

    if (accessCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const props = (requireFirstRow(accessCheck.rows).properties ?? {}) as Partial<IssueProperties>;

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
    sendInternalError(res, err, 'Delete issue error:');
  }
});

// Accept issue (move from triage to backlog)
router.post('/:id/accept', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const result = await acceptIssueMutation({
      issueId: id,
      principal: principalFromRequest(req),
      userId,
      workspaceId,
    });
    respondIssueMutation(res, result);
  } catch (err) {
    sendInternalError(res, err, 'Accept issue error:');
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
    const issueId = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!issueId) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const parsed = createIterationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const result = await createIssueIterationMutation({
      issueId,
      principal: principalFromRequest(req),
      userId,
      workspaceId,
      status: parsed.data.status,
      what_attempted: parsed.data.what_attempted,
      blockers_encountered: parsed.data.blockers_encountered,
    });
    respondIssueMutation(res, result);
  } catch (err) {
    sendInternalError(res, err, 'Create iteration error:');
  }
});

// Get issue iterations - GET /api/issues/:id/iterations
router.get('/:id/iterations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const issueId = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!issueId) return;
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const queryParsed = listIterationsSchema.safeParse(req.query);
    const queryParams = queryParsed.success ? queryParsed.data : {};
    const result = await listIssueIterations(pool, {
      issueId,
      principal: principalFromRequest(req),
      workspaceId,
      status: queryParams.status,
    });
    respondIssueMutation(res, result);
  } catch (err) {
    sendInternalError(res, err, 'Get iterations error:');
  }
});

// Reject issue (move from triage to cancelled with reason)
router.post('/:id/reject', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id) return;
    const parsed = rejectIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const result = await rejectIssueMutation({
      issueId: id,
      principal: principalFromRequest(req),
      userId,
      workspaceId,
      reason: parsed.data.reason,
    });
    respondIssueMutation(res, result);
  } catch (err) {
    sendInternalError(res, err, 'Reject issue error:');
  }
});

export default router;
