import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendInternalError } from '../utils/route-http.js';
import { defineRoute } from '../openapi/define-route.js';
import {
  CreateStandupSchema,
  UpdateStandupSchema,
  StandupResponseSchema,
  StandupStatusSchema,
  ListStandupsQuerySchema,
  StandupIdParamsSchema,
  UpdatedStandupResponseSchema,
  StandupsListResponseSchema,
  StandupLegacyErrorSchema,
} from '../openapi/schemas/standups.js';

const router = Router();

router.post(
  '/',
  authMiddleware,
  defineRoute({
    method: 'post',
    path: '/standups',
    tags: ['Standups'],
    summary: 'Create standup (idempotent)',
    description:
      'Create a standalone standup for the current user on a given date. Returns existing standup if one already exists for that date.',
    request: {
      body: CreateStandupSchema,
    },
    responses: {
      200: { schema: StandupResponseSchema, description: 'Existing standup returned (idempotent)' },
      201: { schema: StandupResponseSchema, description: 'New standup created' },
      400: { schema: StandupLegacyErrorSchema, description: 'Validation error' },
    },
    handler: async (req, res, { body }) => {
      try {
        const { date } = body!;
        const userId = req.userId!;
        const workspaceId = req.workspaceId!;

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
        sendInternalError(res, err, 'Create standup error');
      }
    },
  })
);

router.get(
  '/',
  authMiddleware,
  defineRoute({
    method: 'get',
    path: '/standups',
    tags: ['Standups'],
    summary: 'List standups for current user',
    description: 'Get standups for the current user within a date range.',
    request: {
      query: ListStandupsQuerySchema,
    },
    responses: {
      200: { schema: StandupsListResponseSchema, description: 'List of standups in the date range' },
      400: { schema: StandupLegacyErrorSchema, description: 'Missing required date_from or date_to params' },
    },
    handler: async (req, res, { query }) => {
      try {
        const userId = req.userId!;
        const workspaceId = req.workspaceId!;
        const { date_from, date_to } = query!;

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
          [workspaceId, userId, date_from, date_to]
        );

        const standups = result.rows.map((row) => ({
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
        sendInternalError(res, err, 'Get standups error');
      }
    },
  })
);

router.get(
  '/status',
  authMiddleware,
  defineRoute({
    method: 'get',
    path: '/standups/status',
    tags: ['Standups'],
    summary: 'Get standup due status',
    description: 'Check if current user needs to post a standup today.',
    responses: {
      200: { schema: StandupStatusSchema, description: 'Standup status' },
      404: { schema: StandupLegacyErrorSchema, description: 'Workspace not found' },
    },
    handler: async (req, res) => {
      try {
        const userId = req.userId!;
        const workspaceId = req.workspaceId!;

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

        let workspaceStartDate: Date;
        if (rawStartDate instanceof Date) {
          workspaceStartDate = new Date(
            Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate())
          );
        } else if (typeof rawStartDate === 'string') {
          workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
        } else {
          workspaceStartDate = new Date();
        }

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const daysSinceStart = Math.floor(
          (today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const currentSprintNumber = Math.floor(daysSinceStart / sprintDuration) + 1;

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

        if (activeSprintsResult.rows.length === 0) {
          res.json({ due: false, lastPosted: null });
          return;
        }

        const activeSprints = activeSprintsResult.rows.map((r) => r.sprint_id);
        const todayStr = today.toISOString().split('T')[0];

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
        sendInternalError(res, err, 'Get standup status error');
      }
    },
  })
);

router.patch(
  '/:id',
  authMiddleware,
  defineRoute({
    method: 'patch',
    path: '/standups/{id}',
    tags: ['Standups'],
    summary: 'Update standup',
    description: 'Only the author or an admin can update a standup.',
    request: {
      params: StandupIdParamsSchema,
      body: UpdateStandupSchema,
    },
    responses: {
      200: { schema: UpdatedStandupResponseSchema, description: 'Updated standup' },
      400: { schema: StandupLegacyErrorSchema, description: 'Validation error or no fields to update' },
      403: { schema: StandupLegacyErrorSchema, description: 'Forbidden - only author or admin can update' },
      404: { schema: StandupLegacyErrorSchema, description: 'Standup not found' },
    },
    handler: async (req, res, { params, body }) => {
      try {
        const { id } = params!;
        const userId = req.userId!;
        const workspaceId = req.workspaceId!;
        const { content, title } = body!;

        const { isAdmin } = await getVisibilityContext(userId, workspaceId);

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

        const authorId = existing.rows[0].author_id;
        if (authorId !== userId && !isAdmin) {
          res.status(403).json({ error: 'Only the author or admin can update this standup' });
          return;
        }

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
        sendInternalError(res, err, 'Update standup error');
      }
    },
  })
);

router.delete(
  '/:id',
  authMiddleware,
  defineRoute({
    method: 'delete',
    path: '/standups/{id}',
    tags: ['Standups'],
    summary: 'Delete standup',
    description: 'Only the author or an admin can delete a standup.',
    request: {
      params: StandupIdParamsSchema,
    },
    responses: {
      204: { schema: StandupLegacyErrorSchema, description: 'Standup deleted' },
      403: { schema: StandupLegacyErrorSchema, description: 'Forbidden - only author or admin can delete' },
      404: { schema: StandupLegacyErrorSchema, description: 'Standup not found' },
    },
    handler: async (req, res, { params }) => {
      try {
        const { id } = params!;
        const userId = req.userId!;
        const workspaceId = req.workspaceId!;

        const { isAdmin } = await getVisibilityContext(userId, workspaceId);

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

        const authorId = existing.rows[0].author_id;
        if (authorId !== userId && !isAdmin) {
          res.status(403).json({ error: 'Only the author or admin can delete this standup' });
          return;
        }

        await pool.query(`DELETE FROM documents WHERE id = $1 AND document_type = 'standup'`, [id]);

        res.status(204).send();
      } catch (err) {
        sendInternalError(res, err, 'Delete standup error');
      }
    },
  })
);

export default router;
