// Sprint iteration tracking routes under /api/weeks/:id/iterations.
import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import {
  type IdRow,
  type SprintIterationRow,
  type SprintIterationWithAuthorRow,
  type UserReferenceRow,
  mapSprintIterationResponse,
  requireFirstRow,
} from './route-query-rows.js';

const router = Router();

const createIterationSchema = z.object({
  story_id: z.string().max(200).optional(),
  story_title: z.string().min(1).max(500),
  status: z.enum(['pass', 'fail', 'in_progress']),
  what_attempted: z.string().max(5000).optional(),
  blockers_encountered: z.string().max(5000).optional(),
});

const listIterationsSchema = z.object({
  status: z.enum(['pass', 'fail', 'in_progress']).optional(),
  story_id: z.string().optional(),
});

router.post('/:id/iterations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const sprintId = String(req.params.id);
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = createIterationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const sprintCheck = await pool.query<IdRow>(
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

    const result = await pool.query<SprintIterationRow>(
      `INSERT INTO sprint_iterations
       (sprint_id, workspace_id, story_id, story_title, status, what_attempted, blockers_encountered, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [sprintId, workspaceId, story_id || null, story_title, status, what_attempted || null, blockers_encountered || null, userId]
    );

    const authorResult = await pool.query<UserReferenceRow>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );

    const iteration = requireFirstRow(result.rows);
    const author = requireFirstRow(authorResult.rows);

    res.status(201).json(
      mapSprintIterationResponse({
        ...iteration,
        author_name: author.name,
        author_email: author.email,
      })
    );
  } catch (err) {
    sendInternalError(res, err, 'Create iteration error:');
  }
});

router.get('/:id/iterations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const sprintId = String(req.params.id);
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const queryParsed = listIterationsSchema.safeParse(req.query);
    const queryParams = queryParsed.success ? queryParsed.data : {};

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const sprintCheck = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [sprintId, workspaceId, userId, isAdmin]
    );

    if (sprintCheck.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    let query = `
      SELECT i.*, u.name as author_name, u.email as author_email
      FROM sprint_iterations i
      JOIN users u ON i.author_id = u.id
      WHERE i.sprint_id = $1 AND i.workspace_id = $2
    `;
    const params: (string | boolean)[] = [sprintId, workspaceId];
    let paramIndex = 3;

    if (queryParams.status) {
      query += ` AND i.status = $${paramIndex++}`;
      params.push(queryParams.status);
    }

    if (queryParams.story_id) {
      query += ` AND i.story_id = $${paramIndex++}`;
      params.push(queryParams.story_id);
    }

    query += ' ORDER BY i.created_at DESC';

    const result = await pool.query<SprintIterationWithAuthorRow>(query, params);

    res.json(result.rows.map(mapSprintIterationResponse));
  } catch (err) {
    sendInternalError(res, err, 'Get iterations error:');
  }
});

export default router;
