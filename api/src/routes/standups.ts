import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Schema for creating a standalone standup
const createStandupSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

/**
 * @swagger
 * /standups:
 *   post:
 *     summary: Create a standalone standup for the current user on a given date (idempotent)
 *     tags: [Standups]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - date
 *             properties:
 *               date:
 *                 type: string
 *                 format: date
 *                 description: ISO date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Existing standup returned (idempotent)
 *       201:
 *         description: New standup created
 *       400:
 *         description: Invalid input
 */
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createStandupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { date } = parsed.data;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Check if standup already exists for this user+date
    const existingResult = await pool.query(
      `SELECT id, title, content, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'standup'
         AND (properties->>'author_id') = $2
         AND (properties->>'date') = $3
         AND deleted_at IS NULL`,
      [workspaceId, userId, date]
    );

    if (existingResult.rows.length > 0) {
      const doc = existingResult.rows[0];
      res.status(200).json({
        id: doc.id,
        title: doc.title,
        document_type: 'standup',
        content: doc.content,
        properties: doc.properties,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      });
      return;
    }

    // Format the date for the title
    const dateObj = new Date(date + 'T00:00:00Z');
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const title = `${dayName} ${monthDay} Standup`;

    const docId = uuidv4();
    const properties = {
      author_id: userId,
      date,
    };

    const defaultContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'What I did' }],
        },
        { type: 'paragraph' },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'What I plan to do' }],
        },
        { type: 'paragraph' },
      ],
    };

    const insertResult = await pool.query(
      `INSERT INTO documents (id, workspace_id, document_type, title, content, properties, visibility, created_by, position)
       VALUES ($1, $2, 'standup', $3, $4, $5, 'workspace', $6, 0)
       RETURNING id, title, content, properties, created_at, updated_at`,
      [docId, workspaceId, title, JSON.stringify(defaultContent), JSON.stringify(properties), userId]
    );

    const doc = insertResult.rows[0];
    res.status(201).json({
      id: doc.id,
      title: doc.title,
      document_type: 'standup',
      content: doc.content,
      properties: doc.properties,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    });
  } catch (err) {
    console.error('Create standup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /standups:
 *   get:
 *     summary: Get standups for the current user within a date range
 *     tags: [Standups]
 *     parameters:
 *       - in: query
 *         name: date_from
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: date_to
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: List of standups in the date range
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const { date_from, date_to } = req.query;

    if (!date_from || !date_to) {
      res.status(400).json({ error: 'date_from and date_to query params are required' });
      return;
    }

    const result = await pool.query(
      `SELECT id, title, content, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'standup'
         AND (properties->>'author_id') = $2
         AND (properties->>'date') >= $3
         AND (properties->>'date') <= $4
         AND deleted_at IS NULL
       ORDER BY (properties->>'date') ASC`,
      [workspaceId, userId, date_from as string, date_to as string]
    );

    const standups = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      document_type: 'standup' as const,
      content: row.content,
      properties: row.properties,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json(standups);
  } catch (err) {
    console.error('Get standups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /standups/status:
 *   get:
 *     summary: Get standup due status for current user
 *     tags: [Standups]
 *     responses:
 *       200:
 *         description: Standup status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 due:
 *                   type: boolean
 *                   description: True if user has active sprint but hasn't posted today
 *                 lastPosted:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: Timestamp of last standup posted
 */
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get workspace sprint_start_date to calculate current sprint number
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0].sprint_start_date;
    const sprintDuration = 7;

    // Calculate current sprint number
    let workspaceStartDate: Date;
    if (rawStartDate instanceof Date) {
      workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
    } else if (typeof rawStartDate === 'string') {
      workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
    } else {
      workspaceStartDate = new Date();
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.floor(daysSinceStart / sprintDuration) + 1;

    // Check if user has any issues assigned to them in active sprints (current sprint number)
    const activeSprintsResult = await pool.query(
      `SELECT DISTINCT s.id as sprint_id
       FROM documents i
       JOIN document_associations da ON da.document_id = i.id AND da.relationship_type = 'sprint'
       JOIN documents s ON s.id = da.related_id AND s.document_type = 'sprint'
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND (i.properties->>'assignee_id')::uuid = $2
         AND (s.properties->>'sprint_number')::int = $3`,
      [workspaceId, userId, currentSprintNumber]
    );

    // If user has no issues assigned to active sprints, no standup is due
    if (activeSprintsResult.rows.length === 0) {
      res.json({ due: false, lastPosted: null });
      return;
    }

    const activeSprints = activeSprintsResult.rows.map(r => r.sprint_id);

    // Check if user posted a standup today
    // Check both standalone standups (by date property) and legacy sprint-parented standups
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

    const standupResult = await pool.query(
      `SELECT MAX(created_at) as last_posted
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'standup'
         AND (properties->>'author_id')::uuid = $2
         AND deleted_at IS NULL
         AND (
           (properties->>'date') = $3
           OR (parent_id = ANY($4) AND created_at >= $5)
         )`,
      [workspaceId, userId, todayStr, activeSprints, today.toISOString()]
    );

    const lastPosted = standupResult.rows[0]?.last_posted || null;
    const due = !lastPosted;

    res.json({ due, lastPosted });
  } catch (err) {
    console.error('Get standup status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Schema for updating a standup
const updateStandupSchema = z.object({
  content: z.record(z.unknown()).optional(),
  title: z.string().max(200).optional(),
});

/**
 * @swagger
 * /standups/{id}:
 *   patch:
 *     summary: Update a standup entry
 *     tags: [Standups]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: object
 *               title:
 *                 type: string
 *     responses:
 *       200:
 *         description: Standup updated successfully
 *       404:
 *         description: Standup not found
 *       403:
 *         description: Forbidden - only author or admin can update
 */
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = updateStandupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { content, title } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify standup exists and user can access it
    // Only the author or an admin can update a standup
    const existing = await pool.query(
      `SELECT id, properties->>'author_id' as author_id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'standup'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Standup not found' });
      return;
    }

    // Check if user is author or admin
    const authorId = existing.rows[0].author_id;
    if (authorId !== userId && !isAdmin) {
      res.status(403).json({ error: 'Only the author or admin can update this standup' });
      return;
    }

    // Build update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(JSON.stringify(content));
    }

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'standup'`,
      [...values, id, workspaceId]
    );

    // Re-query to get full standup with author info
    const result = await pool.query(
      `SELECT d.id, d.parent_id, d.title, d.content, d.created_at, d.updated_at,
              d.properties->>'author_id' as author_id,
              u.name as author_name, u.email as author_email
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'author_id')::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'standup'`,
      [id]
    );

    const standup = result.rows[0];
    res.json({
      id: standup.id,
      sprint_id: standup.parent_id,
      title: standup.title,
      content: standup.content,
      author_id: standup.author_id,
      author_name: standup.author_name,
      author_email: standup.author_email,
      created_at: standup.created_at,
      updated_at: standup.updated_at,
    });
  } catch (err) {
    console.error('Update standup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /standups/{id}:
 *   delete:
 *     summary: Delete a standup entry
 *     tags: [Standups]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Standup deleted successfully
 *       404:
 *         description: Standup not found
 *       403:
 *         description: Forbidden - only author or admin can delete
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify standup exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties->>'author_id' as author_id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'standup'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Standup not found' });
      return;
    }

    // Check if user is author or admin
    const authorId = existing.rows[0].author_id;
    if (authorId !== userId && !isAdmin) {
      res.status(403).json({ error: 'Only the author or admin can delete this standup' });
      return;
    }

    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND document_type = 'standup'`,
      [id]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Delete standup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
