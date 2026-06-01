import { Router, Request, Response } from 'express';
import { pool } from '../../../db/client.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../../utils/auth-context.js';
import { sendInternalError } from '../../../utils/route-http.js';
import type { PersonLookupRow, SprintLookupRow } from '../types.js';

const router = Router();

router.get('/lookup-person', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const userId = req.query.user_id as string;

    if (!userId) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }

    const result = await pool.query<PersonLookupRow>(
      `SELECT id, title FROM documents
       WHERE workspace_id = $1 AND document_type = 'person'
         AND (properties->>'user_id') = $2
       LIMIT 1`,
      [workspaceId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    sendInternalError(res, err, 'Person lookup error:');
  }
});

// GET /api/weeks/lookup - Find sprint by project_id + sprint_number
// Returns the sprint document with its approval properties
router.get('/lookup', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const projectId = req.query.project_id as string;
    const sprintNumber = parseInt(req.query.sprint_number as string, 10);

    if (!projectId || isNaN(sprintNumber)) {
      res.status(400).json({ error: 'project_id and sprint_number are required' });
      return;
    }

    const result = await pool.query<SprintLookupRow>(
      `SELECT d.id, d.properties
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id
         AND da.related_id = $2 AND da.relationship_type = 'project'
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND (d.properties->>'sprint_number')::int = $3
       LIMIT 1`,
      [workspaceId, projectId, sprintNumber]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    sendInternalError(res, err, 'Sprint lookup error:');
  }
});

export default router;
