import { Router, type Router as ExpressRouter, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { TEMPLATE_HEADINGS } from '../utils/document-content.js';
import { extractPlanItemsFromContent } from '@ship/shared';
import {
  getActor,
  getDocumentAccessContext,
  getReadableDocument,
  requireSelfOrAdminPerson,
  visibilityPredicate,
  type AccessibleDocument,
} from '../services/document-access.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';

const router = Router();

type WeeklyDocumentProperties = Record<string, unknown> & {
  person_id?: string;
  week_number?: number;
  project_id?: string;
  submitted_at?: string | null;
};

type WeeklyPlanDocumentRow = {
  id: string;
  title: string;
  content: unknown;
  properties: WeeklyDocumentProperties | null;
  created_at: Date;
  updated_at: Date;
};

type WeeklyPlanListRow = WeeklyPlanDocumentRow & {
  person_name: string | null;
  project_name: string | null;
};

type WeeklyPlanContentRow = {
  id: string;
  content: unknown;
};

type ContentHistoryRow = {
  id: string;
  old_value: string | null;
  new_value: string | null;
  created_at: Date;
  changed_by_id: string | null;
  changed_by_name: string | null;
};

type WorkspaceSprintStartRow = {
  sprint_start_date: Date | string;
};

type AllocatedPersonRow = {
  person_id: string;
  person_name: string | null;
  week_number: number;
};

type WeeklyDocStatusRow = {
  person_id: string;
  week_number: number;
  id: string;
  content: unknown;
};

function requireFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error('Expected query to return a row');
  }
  return row;
}

function computeWeeklyDocumentTitle(baseTitle: string, personName: string | null | undefined): string {
  return personName ? `${baseTitle} - ${personName}` : baseTitle;
}

function mapWeeklyPlanDocument(row: WeeklyPlanDocumentRow, personName: string | null | undefined) {
  return {
    id: row.id,
    title: computeWeeklyDocumentTitle(row.title, personName),
    document_type: 'weekly_plan' as const,
    content: row.content,
    properties: row.properties,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapWeeklyRetroDocument(row: WeeklyPlanDocumentRow, personName: string | null | undefined) {
  return {
    id: row.id,
    title: computeWeeklyDocumentTitle(row.title, personName),
    document_type: 'weekly_retro' as const,
    content: row.content,
    properties: row.properties,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapWeeklyPlanListItem(row: WeeklyPlanListRow) {
  return {
    id: row.id,
    title: computeWeeklyDocumentTitle(row.title, row.person_name),
    document_type: 'weekly_plan' as const,
    content: row.content,
    properties: row.properties,
    person_name: row.person_name,
    project_name: row.project_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapWeeklyRetroListItem(row: WeeklyPlanListRow) {
  return {
    id: row.id,
    title: computeWeeklyDocumentTitle(row.title, row.person_name),
    document_type: 'weekly_retro' as const,
    content: row.content,
    properties: row.properties,
    person_name: row.person_name,
    project_name: row.project_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapContentHistoryRow(row: ContentHistoryRow) {
  return {
    id: row.id,
    old_content: row.old_value ? (JSON.parse(row.old_value) as unknown) : null,
    new_content: row.new_value ? (JSON.parse(row.new_value) as unknown) : null,
    created_at: row.created_at,
    changed_by: row.changed_by_id ? {
      id: row.changed_by_id,
      name: row.changed_by_name,
    } : null,
  };
}

// Templates for weekly plan and retro documents
// These provide structure for users to fill in, and "done" status is based on adding content beyond the template
const WEEKLY_PLAN_TEMPLATE = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'What I plan to accomplish this week' }]
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
      ]
    }
  ]
};

const WEEKLY_RETRO_TEMPLATE = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'What I delivered this week' }]
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
      ]
    }
  ]
};

/** Build a retro template auto-populated with plan reference blocks */
function buildRetroTemplateWithPlanItems(planItems: string[], planDocumentId: string): object {
  const content: unknown[] = [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'What I delivered this week' }],
    },
  ];

  // Add a planReference block + empty paragraph for each plan item
  for (let i = 0; i < planItems.length; i++) {
    content.push({
      type: 'planReference',
      attrs: {
        planItemText: planItems[i],
        planDocumentId,
        itemIndex: i,
      },
    });
    content.push({
      type: 'paragraph',
    });
  }

  // Add "Unplanned work" section
  content.push({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: 'Unplanned work' }],
  });
  content.push({
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [{ type: 'paragraph' }] },
      { type: 'listItem', content: [{ type: 'paragraph' }] },
      { type: 'listItem', content: [{ type: 'paragraph' }] },
    ],
  });

  return { type: 'doc', content };
}

// Schema for creating/getting a weekly plan
const weeklyPlanSchema = z.object({
  person_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),  // Optional - legacy field, not used for uniqueness
  week_number: z.number().int().min(1),
});

/**
 * @swagger
 * /weekly-plans:
 *   post:
 *     summary: Create or get existing weekly plan document (idempotent)
 *     tags: [Weekly Plans]
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
 *         description: Existing weekly plan document returned
 *       201:
 *         description: New weekly plan document created
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Person not found
 */
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = weeklyPlanSchema.safeParse(req.body);
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

    // Verify project exists if provided.
    // Note that project_id is a legacy field that is no longer present on new documents
    if (project_id) {
      if (!(await getReadableDocument(client, actor, project_id, 'project'))) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
    }

    // Check if weekly plan already exists for this person+week (uniqueness by person+week only)
    const existingResult = await client.query<WeeklyPlanDocumentRow>(
      `SELECT id, title, content, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_plan'
         AND (properties->>'person_id') = $2
         AND (properties->>'week_number')::int = $3
         AND archived_at IS NULL
         AND deleted_at IS NULL
         AND ${visibilityPredicate('documents', '$4', '$5')}`,
      [workspaceId, person_id, week_number, userId, isAdmin]
    );

    if (existingResult.rows.length > 0) {
      // Return existing document with 200
      res.status(200).json(mapWeeklyPlanDocument(requireFirstRow(existingResult.rows), personName));
      return;
    }

    // Create new weekly plan document
    await client.query('BEGIN');

    const docId = uuidv4();
    const title = `Week ${week_number} Plan`; // Base title without person name
    const properties: Record<string, unknown> = {
      person_id,
      week_number,
      submitted_at: null,
    };

    if (project_id) {
      properties.project_id = project_id;
    }

    // Insert the document with template content
    const insertResult = await client.query<WeeklyPlanDocumentRow>(
      `INSERT INTO documents (id, workspace_id, document_type, title, content, properties, visibility, created_by, position)
       VALUES ($1, $2, 'weekly_plan', $3, $4, $5, 'workspace', $6, 0)
       RETURNING id, title, content, properties, created_at, updated_at`,
      [docId, workspaceId, title, JSON.stringify(WEEKLY_PLAN_TEMPLATE), JSON.stringify(properties), userId]
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

    res.status(201).json(mapWeeklyPlanDocument(requireFirstRow(insertResult.rows), personName));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendInternalError(res, err, 'Create weekly plan error:');
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /weekly-plans:
 *   get:
 *     summary: Query weekly plan documents
 *     tags: [Weekly Plans]
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
 *         description: List of weekly plans matching query
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
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
        AND d.document_type = 'weekly_plan'
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

    res.json(result.rows.map(mapWeeklyPlanListItem));
  } catch (err) {
    sendInternalError(res, err, 'Get weekly plans error:');
  }
});

/**
 * @swagger
 * /weekly-plans/{id}/history:
 *   get:
 *     summary: Get content version history for a weekly plan
 *     tags: [Weekly Plans]
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
 *         description: Weekly plan not found
 */
router.get('/:id/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const actor = getActor(req);

    // Verify document exists and is a weekly_plan
    const document = await getReadableDocument(pool, actor, String(id), 'weekly_plan');
    if (!document) {
      res.status(404).json({ error: 'Weekly plan not found' });
      return;
    }
    const personId = typeof document.properties?.person_id === 'string' ? document.properties.person_id : '';
    try {
      await requireSelfOrAdminPerson(pool, actor, personId);
    } catch {
      res.status(404).json({ error: 'Weekly plan not found' });
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
    sendInternalError(res, err, 'Get weekly plan history error:');
  }
});

/**
 * @swagger
 * /weekly-plans/{id}:
 *   get:
 *     summary: Get a specific weekly plan by ID
 *     tags: [Weekly Plans]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Weekly plan document
 *       404:
 *         description: Weekly plan not found
 */
router.get('/project-allocation-grid/:projectId', authMiddleware, getProjectAllocationGrid);

router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
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
         AND d.document_type = 'weekly_plan'
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}
         AND ((p.properties->>'user_id')::uuid = $3::uuid OR $4 = TRUE)`,
      [id, workspaceId, actor.userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Weekly plan not found' });
      return;
    }

    res.json(mapWeeklyPlanListItem(requireFirstRow(result.rows)));
  } catch (err) {
    sendInternalError(res, err, 'Get weekly plan error:');
  }
});

// ============================================
// WEEKLY RETROS ROUTES
// ============================================

// Schema for creating/getting a weekly retro
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
async function getProjectAllocationGrid(req: Request, res: Response) {
  try {
    // JSONB property filters must cast to uuid (node-pg sends UUID params as uuid type).
    // Plan/retro status queries must qualify d.properties — JOIN makes bare properties ambiguous.
    const { projectId } = req.params;
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    const project = await getReadableDocument(pool, actor, String(projectId), 'project');
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get workspace sprint config
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const sprintStartDate = new Date(requireFirstRow(workspaceResult.rows).sprint_start_date);
    const sprintDuration = 7; // 1 week sprints (standard for Ship)

    // Calculate current sprint number
    const today = new Date();
    const daysSinceStart = Math.floor((today.getTime() - sprintStartDate.getTime()) / (24 * 60 * 60 * 1000));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDuration) + 1);

    // Find all people allocated to sprints for this project (via assignee_ids + project_id in sprint properties)
    // Note: team.ts stores project assignment in properties.project_id, NOT document_associations
    const allocatedPeopleResult = await pool.query<AllocatedPersonRow>(
      `SELECT DISTINCT p.id as person_id, p.title as person_name, (s.properties->>'sprint_number')::int as week_number
       FROM documents s
       CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.properties->'assignee_ids', '[]'::jsonb)) AS assignee_id
       JOIN documents p ON p.id = assignee_id::uuid AND p.document_type = 'person'
       WHERE s.workspace_id = $1
         AND s.document_type = 'sprint'
         AND (s.properties->>'project_id')::uuid = $2
         AND s.deleted_at IS NULL
         AND s.archived_at IS NULL
         AND ${visibilityPredicate('s', '$3', '$4')}
         AND p.workspace_id = $1
         AND p.deleted_at IS NULL
         AND p.archived_at IS NULL
         AND ${visibilityPredicate('p', '$3', '$4')}
         AND ((p.properties->>'user_id')::uuid = $3::uuid OR $4 = TRUE)`,
      [workspaceId, projectId, actor.userId, isAdmin]
    );

    // Group allocations by person
    const peopleMap = new Map<string, { id: string; name: string; allocatedWeeks: Set<number> }>();
    for (const row of allocatedPeopleResult.rows) {
      if (!peopleMap.has(row.person_id)) {
        peopleMap.set(row.person_id, {
          id: row.person_id,
          name: row.person_name || 'Unknown',
          allocatedWeeks: new Set(),
        });
      }
      const personAllocation = peopleMap.get(row.person_id);
      if (personAllocation) {
        personAllocation.allocatedWeeks.add(row.week_number);
      }
    }

    // Get weekly plans for allocated people (include content to check if "done")
    const plansResult = await pool.query<WeeklyDocStatusRow>(
      `SELECT DISTINCT ON ((d.properties->>'person_id'), (d.properties->>'week_number')::int)
              (d.properties->>'person_id') as person_id, (d.properties->>'week_number')::int as week_number, d.id, d.content
       FROM documents d
       JOIN documents p ON (d.properties->>'person_id')::uuid = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'weekly_plan'
         AND d.deleted_at IS NULL
         AND d.archived_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}
         AND p.workspace_id = $1
         AND p.document_type = 'person'
         AND p.deleted_at IS NULL
         AND p.archived_at IS NULL
         AND ${visibilityPredicate('p', '$3', '$4')}
         AND ((p.properties->>'user_id')::uuid = $3::uuid OR $4 = TRUE)
       ORDER BY (d.properties->>'person_id'),
                (d.properties->>'week_number')::int,
                ((d.properties->>'project_id')::uuid = $2) DESC,
                d.updated_at DESC`,
      [workspaceId, projectId, actor.userId, isAdmin]
    );

    // Get weekly retros for allocated people (include content to check if "done")
    const retrosResult = await pool.query<WeeklyDocStatusRow>(
      `SELECT DISTINCT ON ((d.properties->>'person_id'), (d.properties->>'week_number')::int)
              (d.properties->>'person_id') as person_id, (d.properties->>'week_number')::int as week_number, d.id, d.content
       FROM documents d
       JOIN documents p ON (d.properties->>'person_id')::uuid = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'weekly_retro'
         AND d.deleted_at IS NULL
         AND d.archived_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}
         AND p.workspace_id = $1
         AND p.document_type = 'person'
         AND p.deleted_at IS NULL
         AND p.archived_at IS NULL
         AND ${visibilityPredicate('p', '$3', '$4')}
         AND ((p.properties->>'user_id')::uuid = $3::uuid OR $4 = TRUE)
       ORDER BY (d.properties->>'person_id'),
                (d.properties->>'week_number')::int,
                ((d.properties->>'project_id')::uuid = $2) DESC,
                d.updated_at DESC`,
      [workspaceId, projectId, actor.userId, isAdmin]
    );

    // Helper to extract all text from a TipTap document
    const extractText = (node: unknown): string => {
      if (!node || typeof node !== 'object') return '';
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === 'text' && n.text) return n.text;
      if (Array.isArray(n.content)) {
        return n.content.map(extractText).join('');
      }
      return '';
    };

    // Helper to check if document has content beyond the template
    // "Done" means user has added their own text (not just the template heading)
    const hasContent = (content: unknown): boolean => {
      if (!content || typeof content !== 'object') return false;
      const doc = content as { content?: unknown[] };
      if (!Array.isArray(doc.content) || doc.content.length === 0) return false;

      // Extract all text from the document
      const allText = extractText(content).trim();

      // Remove template heading texts to see if anything user-written remains
      let textWithoutTemplate = allText;
      for (const heading of TEMPLATE_HEADINGS) {
        textWithoutTemplate = textWithoutTemplate.replace(heading, '');
      }

      // If there's any non-whitespace text left, the user has added content
      return textWithoutTemplate.trim().length > 0;
    };

    // Helper to calculate plan/retro status based on timing
    // Plan: yellow Sat 00:00 → Mon 23:59, red after Tue 00:00
    // Retro: yellow Fri 00:00 → Sun 23:59, red after Mon 00:00
    const calculateStatus = (
      docId: string | null,
      docContent: unknown,
      weekStartDate: Date,
      type: 'plan' | 'retro'
    ): 'done' | 'due' | 'late' | 'future' => {
      // If document exists with content, it's done
      if (docId && hasContent(docContent)) {
        return 'done';
      }

      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);

      if (type === 'plan') {
        // Plan timing relative to week start:
        // Yellow: Saturday before (week start - 2 days) through Monday EOD (week start + 1 day)
        // Red: After Monday (week start + 2 days onwards)
        const yellowStart = new Date(weekStartDate);
        yellowStart.setUTCDate(yellowStart.getUTCDate() - 2); // Saturday
        const redStart = new Date(weekStartDate);
        redStart.setUTCDate(redStart.getUTCDate() + 2); // Tuesday 00:00

        if (now < yellowStart) return 'future';
        if (now >= redStart) return 'late';
        return 'due';
      } else {
        // Retro timing relative to week start:
        // Yellow: Friday (week start + 4 days) through Sunday (week start + 6 days)
        // Red: Monday of next week (week start + 7 days)
        const yellowStart = new Date(weekStartDate);
        yellowStart.setUTCDate(yellowStart.getUTCDate() + 4); // Friday
        const redStart = new Date(weekStartDate);
        redStart.setUTCDate(redStart.getUTCDate() + 7); // Monday of next week

        if (now < yellowStart) return 'future';
        if (now >= redStart) return 'late';
        return 'due';
      }
    };

    // Build plan/retro maps with content for status calculation
    const plans = new Map<string, { id: string; content: unknown }>(); // `${personId}_${weekNumber}` -> {id, content}
    for (const row of plansResult.rows) {
      plans.set(`${row.person_id}_${row.week_number}`, { id: row.id, content: row.content });
    }

    const retros = new Map<string, { id: string; content: unknown }>(); // `${personId}_${weekNumber}` -> {id, content}
    for (const row of retrosResult.rows) {
      retros.set(`${row.person_id}_${row.week_number}`, { id: row.id, content: row.content });
    }

    // Determine week range to show (min/max allocated weeks or current sprint)
    let minWeek = currentSprintNumber;
    let maxWeek = currentSprintNumber;
    for (const person of peopleMap.values()) {
      for (const week of person.allocatedWeeks) {
        minWeek = Math.min(minWeek, week);
        maxWeek = Math.max(maxWeek, week);
      }
    }

    // Generate weeks array
    const weeks: { number: number; name: string; startDate: string; endDate: string; isCurrent: boolean }[] = [];
    for (let n = minWeek; n <= maxWeek; n++) {
      const weekStart = new Date(sprintStartDate);
      weekStart.setUTCDate(weekStart.getUTCDate() + (n - 1) * sprintDuration);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + sprintDuration - 1);

      weeks.push({
        number: n,
        name: `Week ${n}`,
        startDate: weekStart.toISOString().split('T')[0] || '',
        endDate: weekEnd.toISOString().split('T')[0] || '',
        isCurrent: n === currentSprintNumber,
      });
    }

    // Build people array with allocation and status per week
    const people = Array.from(peopleMap.values()).map(person => ({
      id: person.id,
      name: person.name,
      weeks: Object.fromEntries(
        weeks.map(week => {
          const weekStartDate = new Date(week.startDate);
          const planData = plans.get(`${person.id}_${week.number}`);
          const retroData = retros.get(`${person.id}_${week.number}`);

          return [
            week.number,
            {
              isAllocated: person.allocatedWeeks.has(week.number),
              planId: planData?.id || null,
              planStatus: calculateStatus(planData?.id || null, planData?.content, weekStartDate, 'plan'),
              retroId: retroData?.id || null,
              retroStatus: calculateStatus(retroData?.id || null, retroData?.content, weekStartDate, 'retro'),
            },
          ];
        })
      ),
    }));

    // Sort people alphabetically
    people.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      projectId,
      projectTitle: project.title,
      currentSprintNumber,
      weeks,
      people,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get project allocation grid error:');
  }
}

export default router;
