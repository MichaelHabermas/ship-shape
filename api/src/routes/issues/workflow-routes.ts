import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { logDocumentChange } from '../../utils/document-crud.js';
import { principalFromRequest } from '../../security/principal.js';
import { guardDocumentIdParam, requireIssueRead, requireIssueWrite } from '../../security/route-capability.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import {
  acceptIssueMutation,
  createIssueIterationMutation,
  listIssueIterations,
  rejectIssueMutation,
} from '../../services/issue-mutations/index.js';
import { mapIssueHistoryRow, type IssueHistoryRow } from '../../utils/issue-response.js';
import {
  createIterationSchema,
  listIterationsSchema,
  logHistorySchema,
  rejectIssueSchema,
  respondIssueMutation,
} from './shared.js';

export function registerIssueWorkflowRoutes(router: Router): void {
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

  router.post('/:id/history', authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = guardDocumentIdParam(res, req.params.id, 'Issue not found');
      if (!id || !(await requireIssueWrite(req, res, id))) {
        return;
      }

      const { userId } = getAuthenticatedRouteContext(req);

      const parsed = logHistorySchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }

      const { field, old_value, new_value, automated_by } = parsed.data;

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

  router.get('/:id/iterations', authMiddleware, async (req: Request, res: Response) => {
    try {
      const issueId = guardDocumentIdParam(res, req.params.id, 'Issue not found');
      if (!issueId) return;
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const queryParsed = listIterationsSchema.safeParse(req.query);
      if (!queryParsed.success) {
        sendValidationError(res, queryParsed.error);
        return;
      }
      const result = await listIssueIterations(pool, {
        issueId,
        principal: principalFromRequest(req),
        workspaceId,
        status: queryParsed.data.status,
      });
      respondIssueMutation(res, result);
    } catch (err) {
      sendInternalError(res, err, 'Get iterations error:');
    }
  });

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
}
