import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { z } from 'zod';
import {
  getActor,
  getDocumentAccessContext,
  getReadableDocument,
  visibilityPredicate,
} from '../services/document-access.js';
import { sendInternalError, sendLegacyError } from '../utils/route-http.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Valid entity types for activity queries
const entityTypeSchema = z.enum(['program', 'project', 'sprint']);

/**
 * @swagger
 * /activity/{entityType}/{entityId}:
 *   get:
 *     summary: Get activity data for an entity
 *     description: Returns 30 days of activity counts for the specified entity and its children
 *     tags: [Activity]
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [program, project, sprint]
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Activity data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 days:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       count:
 *                         type: integer
 *       400:
 *         description: Invalid entity type
 *       404:
 *         description: Entity not found
 */
router.get('/:entityType/:entityId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.params;
    const workspaceId = req.workspaceId!;
    const actor = getActor(req);

    // Validate entity type
    const typeResult = entityTypeSchema.safeParse(entityType);
    if (!typeResult.success) {
      sendLegacyError(res, 400, 'Invalid entity type. Must be program, project, or sprint.');
      return;
    }

    // Verify entity exists and is readable.
    if (!(await getReadableDocument(pool, actor, String(entityId), typeResult.data))) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    const { isAdmin } = await getDocumentAccessContext(actor);

    // Build query based on entity type
    // Activity includes:
    // - Document edits (updated_at changes)
    // - Issue state changes (tracked via document updates)
    // - Standup posts (created_at for standups)
    let activityQuery: string;

    switch (entityType) {
      case 'program':
        // Program activity: documents directly linked to program + documents in its projects + documents in its sprints
        activityQuery = `
          WITH date_range AS (
            SELECT generate_series(
              CURRENT_DATE - INTERVAL '29 days',
              CURRENT_DATE,
              INTERVAL '1 day'
            )::date AS date
          ),
          program_projects AS (
            SELECT d.id FROM documents d
            JOIN document_associations da ON d.id = da.document_id
              AND da.relationship_type = 'program' AND da.related_id = $1
            WHERE d.document_type = 'project' AND d.workspace_id = $2
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
              AND ${visibilityPredicate('d', '$3', '$4')}
          ),
          program_sprints AS (
            SELECT d.id FROM documents d
            JOIN document_associations da ON d.id = da.document_id
              AND da.relationship_type = 'project' AND da.related_id IN (SELECT id FROM program_projects)
            WHERE d.document_type = 'sprint' AND d.workspace_id = $2
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
              AND ${visibilityPredicate('d', '$3', '$4')}
          ),
          activity_counts AS (
            SELECT updated_at::date AS activity_date, COUNT(*) AS count
            FROM documents d
            WHERE d.workspace_id = $2
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
              AND ${visibilityPredicate('d', '$3', '$4')}
              AND (
                -- Direct program documents (linked via document_associations)
                d.id IN (SELECT document_id FROM document_associations WHERE related_id = $1 AND relationship_type = 'program')
                -- Project documents (linked to projects in this program)
                OR d.id IN (SELECT document_id FROM document_associations WHERE related_id IN (SELECT id FROM program_projects) AND relationship_type = 'project')
                -- Sprint documents (issues, standups linked via document_associations)
                OR d.id IN (SELECT document_id FROM document_associations WHERE related_id IN (SELECT id FROM program_sprints) AND relationship_type = 'sprint')
                -- The program document itself
                OR d.id = $1
              )
              AND d.updated_at >= CURRENT_DATE - INTERVAL '29 days'
            GROUP BY d.updated_at::date
          )
          SELECT dr.date::text, COALESCE(ac.count, 0)::integer AS count
          FROM date_range dr
          LEFT JOIN activity_counts ac ON dr.date = ac.activity_date
          ORDER BY dr.date ASC
        `;
        break;

      case 'project':
        // Project activity: documents directly linked to project + documents in its sprints
        activityQuery = `
          WITH date_range AS (
            SELECT generate_series(
              CURRENT_DATE - INTERVAL '29 days',
              CURRENT_DATE,
              INTERVAL '1 day'
            )::date AS date
          ),
          project_sprints AS (
            SELECT da.document_id as id FROM document_associations da
            JOIN documents d ON d.id = da.document_id
            WHERE da.related_id = $1 AND da.relationship_type = 'project'
              AND d.document_type = 'sprint' AND d.workspace_id = $2
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
              AND ${visibilityPredicate('d', '$3', '$4')}
          ),
          activity_counts AS (
            SELECT updated_at::date AS activity_date, COUNT(*) AS count
            FROM documents d
            WHERE d.workspace_id = $2
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
              AND ${visibilityPredicate('d', '$3', '$4')}
              AND (
                -- Sprints linked to this project via document_associations
                d.id IN (SELECT id FROM project_sprints)
                -- Documents linked to sprints via junction table (issues)
                OR d.id IN (SELECT da.document_id FROM document_associations da
                          JOIN project_sprints ps ON ps.id = da.related_id AND da.relationship_type = 'sprint')
                -- Documents linked directly to project via junction table (issues)
                OR d.id IN (SELECT document_id FROM document_associations WHERE related_id = $1 AND relationship_type = 'project')
                -- The project document itself
                OR d.id = $1
              )
              AND d.updated_at >= CURRENT_DATE - INTERVAL '29 days'
            GROUP BY d.updated_at::date
          )
          SELECT dr.date::text, COALESCE(ac.count, 0)::integer AS count
          FROM date_range dr
          LEFT JOIN activity_counts ac ON dr.date = ac.activity_date
          ORDER BY dr.date ASC
        `;
        break;

      case 'sprint':
        // Sprint activity: documents directly linked to sprint + the sprint itself
        activityQuery = `
          WITH date_range AS (
            SELECT generate_series(
              CURRENT_DATE - INTERVAL '29 days',
              CURRENT_DATE,
              INTERVAL '1 day'
            )::date AS date
          ),
          activity_counts AS (
            SELECT updated_at::date AS activity_date, COUNT(*) AS count
            FROM documents d
            WHERE d.workspace_id = $2
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
              AND ${visibilityPredicate('d', '$3', '$4')}
              AND (
                -- Documents linked to this sprint via junction table (issues)
                d.id IN (SELECT document_id FROM document_associations WHERE related_id = $1 AND relationship_type = 'sprint')
                -- The sprint document itself
                OR d.id = $1
              )
              AND d.updated_at >= CURRENT_DATE - INTERVAL '29 days'
            GROUP BY d.updated_at::date
          )
          SELECT dr.date::text, COALESCE(ac.count, 0)::integer AS count
          FROM date_range dr
          LEFT JOIN activity_counts ac ON dr.date = ac.activity_date
          ORDER BY dr.date ASC
        `;
        break;

      default:
        sendLegacyError(res, 400, 'Invalid entity type');
        return;
    }

    const result = await pool.query(activityQuery, [entityId, workspaceId, actor.userId, isAdmin]);

    res.json({
      days: result.rows.map(row => ({
        date: row.date,
        count: row.count,
      })),
    });
  } catch (error) {
    sendInternalError(res, error, 'Activity fetch error:', { error: 'Failed to fetch activity data' });
  }
});

export default router;
