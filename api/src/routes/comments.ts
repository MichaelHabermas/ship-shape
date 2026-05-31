// Inline document comments with threading, resolve, and document-scoped routes.
import { Router, type Router as ExpressRouter, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { guardDocumentIdParam, requireDocumentCapability } from '../security/route-capability.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import {
  type CommentRow,
  type CommentWithAuthorRow,
  type IdRow,
  type UserReferenceRow,
  mapCommentResponse,
  mapCommentWithAuthor,
  requireFirstRow,
} from './route-query-rows.js';

export const documentCommentsRouter: ExpressRouter = Router();

const createCommentSchema = z.object({
  comment_id: z.string().uuid(),
  content: z.string().min(1).max(10000),
  parent_id: z.string().uuid().optional(),
});

async function guardDocumentCommentRead(
  req: Request,
  res: Response,
  rawDocumentId: string | string[] | undefined
): Promise<string | null> {
  const documentId = guardDocumentIdParam(res, rawDocumentId, 'Document not found');
  if (!documentId) return null;
  const decision = await requireDocumentCapability(
    req,
    res,
    { resource: 'document', action: 'read', documentId },
    'Document not found'
  );
  return decision ? documentId : null;
}

documentCommentsRouter.get('/:id/comments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const documentId = await guardDocumentCommentRead(req, res, req.params.id);
    if (!documentId) return;
    const { workspaceId } = getAuthenticatedRouteContext(req);

    const result = await pool.query<CommentWithAuthorRow>(
      `SELECT c.*, u.name as author_name, u.email as author_email
       FROM comments c
       JOIN users u ON c.author_id = u.id
       WHERE c.document_id = $1 AND c.workspace_id = $2
       ORDER BY c.created_at ASC`,
      [documentId, workspaceId]
    );

    res.json(result.rows.map(mapCommentResponse));
  } catch (err) {
    sendInternalError(res, err, 'List comments error:');
  }
});

documentCommentsRouter.post('/:id/comments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const documentId = await guardDocumentCommentRead(req, res, req.params.id);
    if (!documentId) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { comment_id, content, parent_id } = parsed.data;

    if (parent_id) {
      const parentCheck = await pool.query<IdRow>(
        'SELECT id FROM comments WHERE id = $1 AND document_id = $2',
        [parent_id, documentId]
      );
      if (parentCheck.rows.length === 0) {
        res.status(404).json({ error: 'Parent comment not found' });
        return;
      }
    }

    const result = await pool.query<CommentRow>(
      `INSERT INTO comments (document_id, comment_id, parent_id, author_id, workspace_id, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [documentId, comment_id, parent_id || null, userId, workspaceId, content]
    );

    const comment = requireFirstRow(result.rows);

    const authorResult = await pool.query<UserReferenceRow>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );
    const author = requireFirstRow(authorResult.rows);

    res.status(201).json(mapCommentWithAuthor(comment, author));
  } catch (err) {
    sendInternalError(res, err, 'Create comment error:');
  }
});

export const commentsRouter: ExpressRouter = Router();

const updateCommentSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  resolved_at: z.union([z.string().datetime(), z.null()]).optional(),
});

commentsRouter.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const commentId = req.params.id;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    if (typeof commentId !== 'string') {
      res.status(400).json({ error: 'Comment id is required' });
      return;
    }

    const parsed = updateCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const existing = await pool.query<{ document_id: string; author_id: string }>(
      `SELECT document_id, author_id FROM comments WHERE id = $1 AND workspace_id = $2`,
      [commentId, workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    const commentRow = requireFirstRow(existing.rows);
    const documentId = commentRow.document_id;
    const decision = await requireDocumentCapability(
      req,
      res,
      { resource: 'document', action: 'read', documentId },
      'Comment not found'
    );
    if (!decision) return;

    if (parsed.data.content !== undefined && commentRow.author_id !== userId) {
      res.status(403).json({ error: 'Only the comment author can edit content' });
      return;
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (parsed.data.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(parsed.data.content);
    }

    if (parsed.data.resolved_at !== undefined) {
      updates.push(`resolved_at = $${paramIndex++}`);
      values.push(parsed.data.resolved_at);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = NOW()`);
    values.push(commentId, workspaceId);

    const result = await pool.query<CommentRow>(
      `UPDATE comments SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND workspace_id = $${paramIndex}
       RETURNING *`,
      values
    );

    const comment = requireFirstRow(result.rows);

    const authorResult = await pool.query<UserReferenceRow>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [comment.author_id]
    );
    const author = requireFirstRow(authorResult.rows);

    res.json(mapCommentWithAuthor(comment, author));
  } catch (err) {
    sendInternalError(res, err, 'Update comment error:');
  }
});

commentsRouter.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const commentId = req.params.id;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    if (typeof commentId !== 'string') {
      res.status(400).json({ error: 'Comment id is required' });
      return;
    }

    const existing = await pool.query<{ document_id: string; author_id: string }>(
      `SELECT document_id, author_id FROM comments WHERE id = $1 AND workspace_id = $2`,
      [commentId, workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    const commentRow = requireFirstRow(existing.rows);
    if (commentRow.author_id !== userId) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    const documentId = commentRow.document_id;
    const decision = await requireDocumentCapability(
      req,
      res,
      { resource: 'document', action: 'read', documentId },
      'Comment not found'
    );
    if (!decision) return;

    await pool.query('DELETE FROM comments WHERE id = $1 AND workspace_id = $2', [commentId, workspaceId]);

    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Delete comment error:');
  }
});
