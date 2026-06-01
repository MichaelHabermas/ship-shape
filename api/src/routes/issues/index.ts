// Issue routes expose document-backed issue CRUD, history, bulk actions, and iteration evidence.
import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import {
  extractIssueFromRow,
  getIssueDetailById,
  getIssueDetailByTicketNumber,
  listIssueChildren,
  listIssuesMetadata,
} from '../../db/documents-repository.js';
import type { IssueProperties } from '@ship/shared';
import { getVisibilityContext } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import {
  getBelongsToAssociationsBatch,
} from '../../utils/document-crud.js';
import {
  getActor,
  getDocumentAccessContext,
} from '../../services/document-access.js';
import { principalFromRequest } from '../../security/principal.js';
import {
  guardDocumentIdParam,
  requireIssueRead,
  requireIssueWrite,
} from '../../security/route-capability.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import {
  bulkUpdateIssuesMutation,
  createIssueMutation,
  updateIssueMutation,
} from '../../services/issue-mutations/index.js';
import {
  mapIssueActionItemRow,
  mapIssueListItem,
  type IssueActionItemRow,
} from '../../utils/issue-response.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import {
  bulkUpdateSchema,
  createIssueSchema,
  IssuePropertiesRow,
  listIssuesQuerySchema,
  PersonIdRow,
  respondIssueMutation,
  sendIssueDetailResponse,
  updateIssueSchema,
} from './shared.js';
import { registerIssueWorkflowRoutes } from './workflow-routes.js';

const router = Router();

registerIssueWorkflowRoutes(router);

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

    const issueIds = rows.map(row => row.id);
    const associationsMap = await getBelongsToAssociationsBatch(issueIds);

    const issues = rows.map(row => mapIssueListItem(row, associationsMap.get(row.id) || []));

    res.json(issues);
  } catch (err) {
    sendInternalError(res, err, 'List issues error:');
  }
});

router.get('/action-items', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'test') {
      res.json({ items: [], total: 0 });
      return;
    }

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const personResult = await pool.query<PersonIdRow>(
      `SELECT id FROM documents
       WHERE workspace_id = $1 AND document_type = 'person'
         AND properties->>'user_id' = $2`,
      [workspaceId, userId]
    );
    const personDocId = personResult.rows[0]?.id;

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

router.get('/:id/children', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (!id || !(await requireIssueRead(req, res, id))) {
      return;
    }

    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    const rows = await listIssueChildren(id, actor.workspaceId, actor.userId, isAdmin);

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

router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
    if (
      !id ||
      !(await requireIssueWrite(req, res, id, {
        enforce: 'creator_or_admin',
        includeArchived: true,
      }))
    ) {
      return;
    }
    const { workspaceId } = getAuthenticatedRouteContext(req);

    const accessCheck = await pool.query<IssuePropertiesRow>(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND deleted_at IS NULL`,
      [id, workspaceId]
    );

    if (accessCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const props = (requireFirstRow(accessCheck.rows).properties ?? {}) as Partial<IssueProperties>;

    if (props.is_system_generated) {
      res.status(403).json({
        error: 'Cannot delete system-generated accountability issues',
        message: 'This issue was automatically created for accountability tracking. Complete the underlying task to resolve it.',
      });
      return;
    }

    const deleteResult = await pool.query(
      `UPDATE documents
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND deleted_at IS NULL`,
      [id, workspaceId]
    );
    if (deleteResult.rowCount === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    sendInternalError(res, err, 'Delete issue error:');
  }
});

export default router;
