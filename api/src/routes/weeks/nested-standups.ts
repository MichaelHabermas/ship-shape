/** Nested standup routes under sprint/week documents. */
import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import {
  transformIssueLinks,
  extractTicketNumbersFromContents,
  batchLookupIssues,
} from '../../utils/transformIssueLinks.js';
import { broadcastToUser } from '../../collaboration/index.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import type { StandupRow, UserNameEmailRow } from './types.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import { requireWeekRead, requireWeekWrite } from './week-access.js';

type StandupInsertRow = {
  id: string;
  parent_id: string;
  title: string;
  content: unknown;
  created_at: Date;
  updated_at: Date;
};

const router = Router();

const createStandupSchema = z.object({
  content: z.record(z.unknown()).default({ type: 'doc', content: [{ type: 'paragraph' }] }),
  title: z.string().max(200).optional().default('Standup Update'),
  date: z.string().optional(), // ISO date string - must be today if provided
});

// Helper to format standup response
function formatStandupResponse(row: StandupRow) {
  return {
    id: row.id,
    sprint_id: row.parent_id,
    title: row.title,
    content: row.content,
    author_id: row.author_id,
    author_name: row.author_name,
    author_email: row.author_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * @swagger
 * /sprints/{id}/standups:
 *   get:
 *     summary: List standups for a sprint
 *     tags: [Sprints, Standups]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Sprint ID
 *     responses:
 *       200:
 *         description: List of standups
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Standup'
 *       404:
 *         description: Sprint not found
 */
router.get('/:id/standups', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get all standups for this sprint (parent_id = sprint.id)
    const result = await pool.query<StandupRow>(
      `SELECT d.id, d.parent_id, d.title, d.content, d.created_at, d.updated_at,
              d.properties->>'author_id' as author_id,
              u.name as author_name, u.email as author_email
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'author_id')::uuid = u.id
       WHERE d.parent_id = $1 AND d.document_type = 'standup'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY d.created_at DESC`,
      [id, userId, isAdmin]
    );

    // Transform issue links in standup content (e.g., #123 -> clickable links)
    // Batch pre-load all issue references to avoid N+1 queries
    const allContents = result.rows.map((row) => row.content);
    const allTicketNumbers = extractTicketNumbersFromContents(allContents);
    const issueMap = await batchLookupIssues(workspaceId, allTicketNumbers);

    const standups = await Promise.all(
      result.rows.map(async (row) => {
        const formatted = formatStandupResponse(row);
        formatted.content = await transformIssueLinks(formatted.content, workspaceId, issueMap);
        return formatted;
      })
    );

    res.json(standups);
  } catch (err) {
    sendInternalError(res, err, 'Get sprint standups error:');
  }
});

/**
 * @swagger
 * /sprints/{id}/standups:
 *   post:
 *     summary: Create a standup entry
 *     tags: [Sprints, Standups]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Sprint ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: object
 *                 description: TipTap editor content
 *               title:
 *                 type: string
 *                 default: Untitled
 *     responses:
 *       201:
 *         description: Standup created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Standup'
 *       404:
 *         description: Sprint not found
 */
router.post('/:id/standups', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekWrite(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = createStandupSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { content, title, date } = parsed.data;

    // Enforce current-day-only standup posting
    // Users cannot backdate standups - they can only post for today
    if (date) {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      if (date !== todayStr) {
        res.status(400).json({
          error: 'Standups can only be posted for the current day',
          details: `Attempted to post for ${date}, but today is ${todayStr}`,
        });
        return;
      }
    }

    // Create the standup document
    // parent_id = sprint.id, properties.author_id = current user
    const properties = { author_id: userId };

    const result = await pool.query<StandupInsertRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, parent_id, properties, created_by, visibility)
       VALUES ($1, 'standup', $2, $3, $4, $5, $6, 'workspace')
       RETURNING id, parent_id, title, content, created_at, updated_at`,
      [workspaceId, title, JSON.stringify(content), id, JSON.stringify(properties), userId]
    );

    const authorResult = await pool.query<UserNameEmailRow>(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId]
    );

    const standup = requireFirstRow(result.rows);
    const author = requireFirstRow(authorResult.rows);

    broadcastToUser(userId, 'accountability:updated', { type: 'standup', targetId: id });

    res.status(201).json({
      id: standup.id,
      sprint_id: standup.parent_id,
      title: standup.title,
      content: standup.content,
      author_id: userId,
      author_name: author.name,
      author_email: author.email,
      created_at: standup.created_at,
      updated_at: standup.updated_at,
    });
  } catch (err) {
    sendInternalError(res, err, 'Create standup error:');
  }
});


export default router;
