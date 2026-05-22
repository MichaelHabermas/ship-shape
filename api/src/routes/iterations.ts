import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';

const router = Router();

// Validation schemas
const createIterationSchema = z.object({
  story_id: z.string().max(200).optional(),
  story_title: z.string().min(1).max(500),
  status: z.enum(['pass', 'fail', 'in_progress']),
  what_attempted: z.string().max(5000).optional(),
  blockers_encountered: z.string().max(5000).optional(),
});

// Query params schema
const listIterationsSchema = z.object({
  status: z.enum(['pass', 'fail', 'in_progress']).optional(),
  story_id: z.string().optional(),
});

// Create iteration entry - POST /api/weeks/:id/iterations
router.post('/:id/iterations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id: sprintId } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = createIterationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const sprintCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [sprintId, workspaceId, userId, isAdmin]
    );

    if (sprintCheck.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const { story_id, story_title, status, what_attempted, blockers_encountered } = parsed.data;

    const result = await pool.query(
      `INSERT INTO sprint_iterations
       (sprint_id, workspace_id, story_id, story_title, status, what_attempted, blockers_encountered, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [sprintId, workspaceId, story_id || null, story_title, status, what_attempted || null, blockers_encountered || null, userId]
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
      sprint_id: iteration.sprint_id,
      story_id: iteration.story_id,
      story_title: iteration.story_title,
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
    sendInternalError(res, err, 'Create iteration error:');
  }
});

// Get sprint iterations - GET /api/weeks/:id/iterations
router.get('/:id/iterations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id: sprintId } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Parse and validate query params
    const queryParsed = listIterationsSchema.safeParse(req.query);
    const queryParams = queryParsed.success ? queryParsed.data : {};

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const sprintCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [sprintId, workspaceId, userId, isAdmin]
    );

    if (sprintCheck.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    // Build query with optional filters
    let query = `
      SELECT i.*, u.name as author_name, u.email as author_email
      FROM sprint_iterations i
      JOIN users u ON i.author_id = u.id
      WHERE i.sprint_id = $1 AND i.workspace_id = $2
    `;
    const params: unknown[] = [sprintId, workspaceId];
    let paramIndex = 3;

    // Filter by status
    if (queryParams.status) {
      query += ` AND i.status = $${paramIndex++}`;
      params.push(queryParams.status);
    }

    // Filter by story_id
    if (queryParams.story_id) {
      query += ` AND i.story_id = $${paramIndex++}`;
      params.push(queryParams.story_id);
    }

    // Sort by timestamp descending (most recent first)
    query += ' ORDER BY i.created_at DESC';

    const result = await pool.query(query, params);

    const iterations = result.rows.map(row => ({
      id: row.id,
      sprint_id: row.sprint_id,
      story_id: row.story_id,
      story_title: row.story_title,
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
    sendInternalError(res, err, 'Get iterations error:');
  }
});

export default router;
