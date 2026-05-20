import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';

type RouterType = ReturnType<typeof Router>;

// ============== Document-scoped routes (/api/documents/:id/comments) ==============

export const documentCommentsRouter: RouterType = Router();

const createCommentSchema = z.object({
  comment_id: z.string().uuid(),
  content: z.string().min(1).max(10000),
  parent_id: z.string().uuid().optional(),
});

async function canAccessDocument(documentId: string, userId: string, workspaceId: string): Promise<boolean> {
  const { isAdmin } = await getVisibilityContext(userId, workspaceId);
  const result = await pool.query(
    `SELECT id FROM documents
     WHERE id = $1 AND workspace_id = $2
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}
     LIMIT 1`,
    [documentId, workspaceId, userId, isAdmin]
  );
  return result.rows.length > 0;
}

// GET /api/documents/:id/comments
documentCommentsRouter.get('/:id/comments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const documentId = req.params.id;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    if (typeof documentId !== 'string') {
      res.status(400).json({ error: 'Document id is required' });
      return;
    }

    if (!(await canAccessDocument(documentId, userId, workspaceId))) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const result = await pool.query(
      `SELECT c.*, u.name as author_name, u.email as author_email
       FROM comments c
       JOIN users u ON c.author_id = u.id
       WHERE c.document_id = $1 AND c.workspace_id = $2
       ORDER BY c.created_at ASC`,
      [documentId, workspaceId]
    );

    const comments = result.rows.map(row => ({
      id: row.id,
      document_id: row.document_id,
      comment_id: row.comment_id,
      parent_id: row.parent_id,
      content: row.content,
      resolved_at: row.resolved_at,
      author: {
        id: row.author_id,
        name: row.author_name,
        email: row.author_email,
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json(comments);
  } catch (err) {
    console.error('List comments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/documents/:id/comments
documentCommentsRouter.post('/:id/comments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const documentId = req.params.id;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    if (typeof documentId !== 'string') {
      res.status(400).json({ error: 'Document id is required' });
      return;
    }

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { comment_id, content, parent_id } = parsed.data;

    if (!(await canAccessDocument(documentId, userId, workspaceId))) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // If replying, verify parent exists and belongs to same document
    if (parent_id) {
      const parentCheck = await pool.query(
        'SELECT id FROM comments WHERE id = $1 AND document_id = $2',
        [parent_id, documentId]
      );
      if (parentCheck.rows.length === 0) {
        res.status(404).json({ error: 'Parent comment not found' });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO comments (document_id, comment_id, parent_id, author_id, workspace_id, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [documentId, comment_id, parent_id || null, userId, workspaceId, content]
    );

    const comment = result.rows[0];

    // Get author info
    const authorResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );
    const author = authorResult.rows[0];

    res.status(201).json({
      id: comment.id,
      document_id: comment.document_id,
      comment_id: comment.comment_id,
      parent_id: comment.parent_id,
      content: comment.content,
      resolved_at: comment.resolved_at,
      author: {
        id: author.id,
        name: author.name,
        email: author.email,
      },
      created_at: comment.created_at,
      updated_at: comment.updated_at,
    });
  } catch (err) {
    console.error('Create comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============== Comment-scoped routes (/api/comments/:id) ==============

export const commentsRouter: RouterType = Router();

const updateCommentSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  resolved_at: z.union([z.string().datetime(), z.null()]).optional(),
});

// PATCH /api/comments/:id
commentsRouter.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const commentId = req.params.id;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    if (typeof commentId !== 'string') {
      res.status(400).json({ error: 'Comment id is required' });
      return;
    }

    const parsed = updateCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Check comment exists in workspace and its document is visible to this user.
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    const existing = await pool.query(
      `SELECT c.*
       FROM comments c
       JOIN documents d ON d.id = c.document_id AND d.workspace_id = c.workspace_id
       WHERE c.id = $1 AND c.workspace_id = $2
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [commentId, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    // Content edits require author ownership; resolving is allowed by any workspace member
    if (parsed.data.content !== undefined && existing.rows[0]?.author_id !== userId) {
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

    const result = await pool.query(
      `UPDATE comments SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND workspace_id = $${paramIndex}
       RETURNING *`,
      values
    );

    const comment = result.rows[0];

    const authorResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [comment.author_id]
    );
    const author = authorResult.rows[0];

    res.json({
      id: comment.id,
      document_id: comment.document_id,
      comment_id: comment.comment_id,
      parent_id: comment.parent_id,
      content: comment.content,
      resolved_at: comment.resolved_at,
      author: {
        id: author.id,
        name: author.name,
        email: author.email,
      },
      created_at: comment.created_at,
      updated_at: comment.updated_at,
    });
  } catch (err) {
    console.error('Update comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/comments/:id
commentsRouter.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const commentId = req.params.id;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    if (typeof commentId !== 'string') {
      res.status(400).json({ error: 'Comment id is required' });
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    const result = await pool.query(
      `DELETE FROM comments c
       USING documents d
       WHERE c.id = $1 AND c.workspace_id = $2 AND c.author_id = $3
         AND d.id = c.document_id AND d.workspace_id = c.workspace_id
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       RETURNING c.id`,
      [commentId, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
