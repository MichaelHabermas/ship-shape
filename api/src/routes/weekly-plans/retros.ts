import { Router, type Router as ExpressRouter, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { extractPlanItemsFromContent } from '@ship/shared';
import {
  getActor,
  getDocumentAccessContext,
  getReadableDocument,
  requireSelfOrAdminPerson,
  visibilityPredicate,
  type AccessibleDocument,
} from '../../services/document-access.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import {
  requireFirstRow,
  mapWeeklyRetroDocument,
  mapWeeklyRetroListItem,
  mapContentHistoryRow,
  buildRetroTemplateWithPlanItems,
  WEEKLY_RETRO_TEMPLATE,
  type WeeklyPlanDocumentRow,
  type WeeklyPlanListRow,
  type WeeklyPlanContentRow,
  type ContentHistoryRow,
} from './shared.js';

const weeklyRetroSchema = z.object({
  person_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),  // Optional - legacy field, not used for uniqueness
  week_number: z.number().int().min(1),
});

/**
 * @swagger
 * /weekly-retros:
 *   post:
 *     summary: Create or get existing weekly retro document (idempotent)
 *     tags: [Weekly Retros]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - person_id
 *               - week_number
 *             properties:
 *               person_id:
 *                 type: string
 *                 format: uuid
 *               project_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional legacy field
 *               week_number:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Existing weekly retro document returned
 *       201:
 *         description: New weekly retro document created
 */
export const weeklyRetrosRouter: ExpressRouter = Router();

weeklyRetrosRouter.post('/', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = weeklyRetroSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { person_id, project_id, week_number } = parsed.data;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor, client);

    let person: AccessibleDocument;
    try {
      person = await requireSelfOrAdminPerson(client, actor, person_id);
    } catch {
      res.status(404).json({ error: 'Person not found' });
      return;
    }
    const personName = person.title;

    // Verify project exists if provided
    if (project_id) {
      if (!(await getReadableDocument(client, actor, project_id, 'project'))) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    }

    // Check if weekly retro already exists for this person+week (uniqueness by person+week only)
    const existingResult = await client.query<WeeklyPlanDocumentRow>(
      `SELECT id, title, content, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_retro'
         AND (properties->>'person_id') = $2
         AND (properties->>'week_number')::int = $3
         AND archived_at IS NULL
         AND deleted_at IS NULL
         AND ${visibilityPredicate('documents', '$4', '$5')}`,
      [workspaceId, person_id, week_number, userId, isAdmin]
    );

    if (existingResult.rows.length > 0) {
      // Return existing document with 200
      res.status(200).json(mapWeeklyRetroDocument(requireFirstRow(existingResult.rows), personName));
      return;
    }

    // Create new weekly retro document
    await client.query('BEGIN');

    const docId = uuidv4();
    const title = `Week ${week_number} Retro`; // Base title without person name
    const properties: Record<string, unknown> = {
      person_id,
      week_number,
      submitted_at: null,
    };
    
    if (project_id) {
      properties.project_id = project_id;
    }

    // Fetch corresponding plan to auto-populate retro with plan items (by person+week only)
    let retroTemplate = WEEKLY_RETRO_TEMPLATE;
    const planResult = await client.query<WeeklyPlanContentRow>(
      `SELECT id, content FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_plan'
         AND (properties->>'person_id') = $2
         AND (properties->>'week_number')::int = $3
         AND archived_at IS NULL
         AND deleted_at IS NULL
         AND ${visibilityPredicate('documents', '$4', '$5')}`,
      [workspaceId, person_id, week_number, userId, isAdmin]
    );

    if (planResult.rows.length > 0 && planResult.rows[0]?.content) {
      const planRow = requireFirstRow(planResult.rows);
      const planItems = extractPlanItemsFromContent(planRow.content);
      if (planItems.length > 0) {
        retroTemplate = buildRetroTemplateWithPlanItems(planItems, planRow.id) as typeof WEEKLY_RETRO_TEMPLATE;
      }
    }

    // Insert the document with template content
    const insertResult = await client.query<WeeklyPlanDocumentRow>(
      `INSERT INTO documents (id, workspace_id, document_type, title, content, properties, visibility, created_by, position)
       VALUES ($1, $2, 'weekly_retro', $3, $4, $5, 'workspace', $6, 0)
       RETURNING id, title, content, properties, created_at, updated_at`,
      [docId, workspaceId, title, JSON.stringify(retroTemplate), JSON.stringify(properties), userId]
    );

    // Create association with project only if provided
    if (project_id) {
      await client.query(
        `INSERT INTO document_associations (id, document_id, related_id, relationship_type)
         VALUES ($1, $2, $3, 'project')`,
        [uuidv4(), docId, project_id]
      );
    }

    await client.query('COMMIT');

    res.status(201).json(mapWeeklyRetroDocument(requireFirstRow(insertResult.rows), personName));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendInternalError(res, err, 'Create weekly retro error:');
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /weekly-retros:
 *   get:
 *     summary: Query weekly retro documents
 *     tags: [Weekly Retros]
 *     parameters:
 *       - in: query
 *         name: person_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: week_number
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of weekly retros matching query
 */
weeklyRetrosRouter.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);
    const { person_id, project_id, week_number } = req.query;

    let query = `
      SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
             p.title as person_name, pr.title as project_name
      FROM documents d
      LEFT JOIN documents p
        ON (d.properties->>'person_id')::uuid = p.id
       AND p.workspace_id = $1
       AND p.document_type = 'person'
       AND p.deleted_at IS NULL
       AND p.archived_at IS NULL
       AND ${visibilityPredicate('p', '$2', '$3')}
      LEFT JOIN documents pr
        ON (d.properties->>'project_id')::uuid = pr.id
       AND pr.workspace_id = $1
       AND pr.document_type = 'project'
       AND pr.deleted_at IS NULL
       AND pr.archived_at IS NULL
       AND ${visibilityPredicate('pr', '$2', '$3')}
      WHERE d.workspace_id = $1
        AND d.document_type = 'weekly_retro'
        AND d.archived_at IS NULL
        AND d.deleted_at IS NULL
        AND ${visibilityPredicate('d', '$2', '$3')}
        AND ((p.properties->>'user_id')::uuid = $2::uuid OR $3 = TRUE)
    `;
    const params: (string | number | boolean)[] = [workspaceId, actor.userId, isAdmin];
    let paramIndex = 4;

    if (person_id) {
      // Cast JSONB text to uuid — node-pg sends UUID params as uuid type (text = uuid fails).
      query += ` AND (d.properties->>'person_id')::uuid = $${paramIndex++}::uuid`;
      params.push(person_id as string);
    }

    if (project_id) {
      query += ` AND (d.properties->>'project_id')::uuid = $${paramIndex++}::uuid`;
      params.push(project_id as string);
    }

    if (week_number) {
      query += ` AND (d.properties->>'week_number')::int = $${paramIndex++}`;
      params.push(parseInt(week_number as string, 10));
    }

    query += ` ORDER BY (d.properties->>'week_number')::int DESC, d.created_at DESC`;

    const result = await pool.query<WeeklyPlanListRow>(query, params);

    res.json(result.rows.map(mapWeeklyRetroListItem));
  } catch (err) {
    sendInternalError(res, err, 'Get weekly retros error:');
  }
});

/**
 * @swagger
 * /weekly-retros/{id}/history:
 *   get:
 *     summary: Get content version history for a weekly retro
 *     tags: [Weekly Retros]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of content versions
 *       404:
 *         description: Weekly retro not found
 */
weeklyRetrosRouter.get('/:id/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actor = getActor(req);

    // Verify document exists and is a weekly_retro
    const document = await getReadableDocument(pool, actor, String(id), 'weekly_retro');
    if (!document) {
      res.status(404).json({ error: 'Weekly retro not found' });
      return;
    }
    const personId = typeof document.properties?.person_id === 'string' ? document.properties.person_id : '';
    try {
      await requireSelfOrAdminPerson(pool, actor, personId);
    } catch {
      res.status(404).json({ error: 'Weekly retro not found' });
      return;
    }

    // Get content history entries
    const result = await pool.query<ContentHistoryRow>(
      `SELECT h.id, h.old_value, h.new_value, h.created_at,
              u.id as changed_by_id, u.name as changed_by_name
       FROM document_history h
       LEFT JOIN users u ON h.changed_by = u.id
       WHERE h.document_id = $1 AND h.field = 'content'
       ORDER BY h.created_at DESC`,
      [id]
    );

    res.json(result.rows.map(mapContentHistoryRow));
  } catch (err) {
    sendInternalError(res, err, 'Get weekly retro history error:');
  }
});

/**
 * @swagger
 * /weekly-retros/{id}:
 *   get:
 *     summary: Get a specific weekly retro by ID
 *     tags: [Weekly Retros]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Weekly retro document
 *       404:
 *         description: Weekly retro not found
 */
weeklyRetrosRouter.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    const result = await pool.query<WeeklyPlanListRow>(
      `SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
              p.title as person_name, pr.title as project_name
       FROM documents d
       LEFT JOIN documents p
         ON (d.properties->>'person_id')::uuid = p.id
        AND p.workspace_id = $2
        AND p.document_type = 'person'
        AND p.archived_at IS NULL
        AND p.deleted_at IS NULL
        AND ${visibilityPredicate('p', '$3', '$4')}
       LEFT JOIN documents pr
         ON (d.properties->>'project_id')::uuid = pr.id
        AND pr.workspace_id = $2
        AND pr.document_type = 'project'
        AND pr.archived_at IS NULL
        AND pr.deleted_at IS NULL
        AND ${visibilityPredicate('pr', '$3', '$4')}
       WHERE d.id = $1
         AND d.workspace_id = $2
         AND d.document_type = 'weekly_retro'
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}
         AND ((p.properties->>'user_id')::uuid = $3::uuid OR $4 = TRUE)`,
      [id, workspaceId, actor.userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Weekly retro not found' });
      return;
    }

    res.json(mapWeeklyRetroListItem(requireFirstRow(result.rows)));
  } catch (err) {
    sendInternalError(res, err, 'Get weekly retro error:');
  }
});

/**
 * @swagger
 * /project-allocation-grid/{projectId}:
 *   get:
 *     summary: Get allocation grid data for a project
 *     description: Returns people allocated to a project (via assigned issues), weeks, and plan/retro status
 *     tags: [Weekly Plans]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Allocation grid data
 */
