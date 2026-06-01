import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import { logDocumentChange } from '../../utils/document-crud.js';
import { broadcastToUser } from '../../collaboration/index.js';
import { extractText } from '../../utils/document-content.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { requireWeekLifecycleAuthority } from '../../services/governance-auth.js';
import { principalFromRequest } from '../../security/principal.js';
import { requireWeekRead, requireWeekWrite } from './week-access.js';
import {
  extractReviewResponseFromRow,
  generatePrefilledReviewContent,
  sprintReviewSchema,
} from './reviews-review-content.js';
import type {
  SprintReviewSprintRow,
  SprintReviewDocumentRow,
  WeeklyPlanContentRow,
  SprintReviewInsertRow,
  UserNameEmailRow,
  SprintPropertiesOnlyRow,
  SprintCarryoverSprintRow,
  IdRow,
  SprintReviewIssueRow,
} from './types.js';

const router = Router();

// GET /api/weeks/:id/review - Get or generate pre-filled sprint review
router.get('/:id/review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const sprintResult = await pool.query<SprintReviewSprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'`,
      [id, workspaceId]
    );

    const sprint = sprintResult.rows.at(0);
    if (!sprint) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const sprintProps = sprint.properties || {};

    // Check if a weekly_review already exists for this sprint
    // Note: weekly_review documents use document_associations to link to sprint
    const existingReview = await pool.query<SprintReviewDocumentRow>(
      `SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
              u.name as owner_name, u.email as owner_email
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.document_type = 'weekly_review'
         AND d.workspace_id = $2
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existingReview.rows.length > 0) {
      // Return existing review
      const review = existingReview.rows[0];
      if (!review) {
        res.status(404).json({ error: 'Weekly review not found' });
        return;
      }
      res.json(extractReviewResponseFromRow(review, id));
      return;
    }

    // No existing review - generate pre-filled draft
    // Get issues for this sprint
    const issuesResult = await pool.query<SprintReviewIssueRow>(
      `SELECT d.id, d.title, d.properties, d.ticket_number
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
       WHERE d.document_type = 'issue'`,
      [id]
    );

    // Fetch weekly_plan documents for this sprint (plans are now separate documents, not sprint properties)
    const weeklyPlansResult = await pool.query<WeeklyPlanContentRow>(
      `SELECT content FROM documents
       WHERE document_type = 'weekly_plan'
         AND (properties->>'week_number')::int = $1
         AND workspace_id = $2
         AND deleted_at IS NULL`,
      [sprintProps.sprint_number || 1, workspaceId]
    );
    const planTexts = weeklyPlansResult.rows
      .map((row) => extractText(row.content))
      .filter((t) => t.trim().length > 0);

    const sprintData = {
      sprint_number: sprintProps.sprint_number || 1,
      program_name: sprint.program_name,
      plan: planTexts.length > 0 ? planTexts.join('\n\n') : null,
    };

    const prefilledContent = await generatePrefilledReviewContent(sprintData, issuesResult.rows);

    res.json({
      id: null, // No ID yet - this is a draft
      sprint_id: id,
      title: `Week ${sprintData.sprint_number} Review`,
      content: prefilledContent,
      plan_validated: null,
      owner_id: null,
      owner_name: null,
      owner_email: null,
      created_at: null,
      updated_at: null,
      is_draft: true,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get sprint review error:');
  }
});

// POST /api/weeks/:id/review - Create finalized sprint review
router.post('/:id/review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekWrite(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = sprintReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { content, title, plan_validated } = parsed.data;

    const sprintCheck = await pool.query<SprintPropertiesOnlyRow>(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'`,
      [id, workspaceId]
    );

    if (sprintCheck.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    // Check if a weekly_review already exists
    const existingCheck = await pool.query<IdRow>(
      `SELECT d.id FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
       WHERE d.document_type = 'weekly_review'
         AND d.workspace_id = $2`,
      [id, workspaceId]
    );

    if (existingCheck.rows.length > 0) {
      res.status(409).json({ error: 'Weekly review already exists. Use PATCH to update.' });
      return;
    }

    const sprintProps = sprintCheck.rows[0]?.properties || {};

    // Create the weekly_review document
    const properties = {
      sprint_id: id,
      owner_id: userId,
      plan_validated: plan_validated ?? null,
    };

    const reviewTitle = title || `Week ${sprintProps.sprint_number || 'N'} Review`;
    const reviewContent = content || { type: 'doc', content: [{ type: 'paragraph' }] };

    const result = await pool.query<SprintReviewInsertRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by, visibility)
       VALUES ($1, 'weekly_review', $2, $3, $4, $5, 'workspace')
       RETURNING id, title, content, properties, created_at, updated_at`,
      [workspaceId, reviewTitle, JSON.stringify(reviewContent), JSON.stringify(properties), userId]
    );

    const review = result.rows[0];
    if (!review) {
      throw new Error('Create weekly review did not return a row');
    }

    // Create document_association to link weekly_review to sprint
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')`,
      [review.id, id]
    );

    // Get owner info
    const ownerResult = await pool.query<UserNameEmailRow>(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId]
    );

    // Broadcast celebration when sprint review is created
    broadcastToUser(userId, 'accountability:updated', { type: 'weekly_review', targetId: id });

    // Log initial review content to document_history for approval workflow tracking
    if (reviewContent) {
      await logDocumentChange(
        review.id,
        'review_content',
        null,
        JSON.stringify(reviewContent),
        userId
      );
    }

    const owner = ownerResult.rows[0];

    res.status(201).json({
      id: review.id,
      sprint_id: id,
      title: review.title,
      content: review.content,
      plan_validated: plan_validated ?? null,
      owner_id: userId,
      owner_name: owner?.name || null,
      owner_email: owner?.email || null,
      created_at: review.created_at,
      updated_at: review.updated_at,
      is_draft: false,
    });
  } catch (err) {
    sendInternalError(res, err, 'Create sprint review error:');
  }
});

// PATCH /api/weeks/:id/review - Update existing sprint review
router.patch('/:id/review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekWrite(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = sprintReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { content, title, plan_validated } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Find existing weekly_review for this sprint
    const existing = await pool.query<SprintReviewDocumentRow>(
      `SELECT d.id, d.properties, d.content FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
       WHERE d.document_type = 'weekly_review'
         AND d.workspace_id = $2
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Weekly review not found. Use POST to create.' });
      return;
    }

    const existingReview = existing.rows[0];
    if (!existingReview) {
      res.status(404).json({ error: 'Weekly review not found. Use POST to create.' });
      return;
    }

    const reviewId = existingReview.id;
    const currentProps = existingReview.properties || {};
    const currentContent = existingReview.content;

    // Check if user is owner or admin
    const ownerId = currentProps.owner_id;
    if (ownerId !== userId && !isAdmin) {
      res.status(403).json({ error: 'Only the owner or admin can update this review' });
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

    // Handle properties update
    let propsChanged = false;
    const newProps = { ...currentProps };

    if (plan_validated !== undefined) {
      newProps.plan_validated = plan_validated;
      propsChanged = true;
    }

    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND document_type = 'weekly_review'`,
      [...values, reviewId]
    );

    // Log review content changes to document_history for approval workflow tracking
    if (content !== undefined) {
      const oldContent = currentContent ? JSON.stringify(currentContent) : null;
      const newContent = JSON.stringify(content);
      if (oldContent !== newContent) {
        await logDocumentChange(
          reviewId,
          'review_content',
          oldContent,
          newContent,
          userId
        );
      }
    }

    // If review content or plan_validated changed, update parent sprint's review_approval
    const reviewFieldsChanged = content !== undefined || plan_validated !== undefined;
    if (reviewFieldsChanged) {
      // Fetch parent sprint to check review_approval state
      const sprintResult = await pool.query<SprintPropertiesOnlyRow>(
        `SELECT properties FROM documents WHERE id = $1 AND document_type = 'sprint'`,
        [id]
      );
      if (sprintResult.rows.length > 0) {
        const sprintProps = sprintResult.rows[0]?.properties || {};
        const reviewApproval = sprintProps.review_approval as { state?: string } | null | undefined;
        if (reviewApproval?.state === 'approved') {
          const newSprintProps = {
            ...sprintProps,
            review_approval: {
              ...reviewApproval,
              state: 'changed_since_approved',
            },
          };
          await pool.query(
            `UPDATE documents SET properties = $1, updated_at = now()
             WHERE id = $2 AND document_type = 'sprint'`,
            [JSON.stringify(newSprintProps), id]
          );
        }
      }
    }

    // Re-query to get full review with owner info
    // Note: weekly_review documents use owner_id (not assignee_ids like sprint docs)
    const result = await pool.query<SprintReviewDocumentRow>(
      `SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
              u.name as owner_name, u.email as owner_email
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'weekly_review'`,
      [reviewId]
    );

    const review = result.rows[0];
    if (!review) {
      res.status(404).json({ error: 'Weekly review not found' });
      return;
    }

    res.json(extractReviewResponseFromRow(review, id));
  } catch (err) {
    sendInternalError(res, err, 'Update sprint review error:');
  }
});

// Carryover schema
const carryoverSchema = z.object({
  issue_ids: z.array(z.string().uuid()).min(1),
  target_sprint_id: z.string().uuid(),
});

// POST /api/weeks/:id/carryover - Move incomplete issues to another sprint
router.post('/:id/carryover', authMiddleware, async (req: Request, res: Response) => {
  try {
    const sourceSprintId = await requireWeekWrite(req, res, req.params.id);
    if (!sourceSprintId) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = carryoverSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { issue_ids, target_sprint_id } = parsed.data;

    if (!(await requireWeekWrite(req, res, target_sprint_id))) {
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const sourceSprintResult = await pool.query<SprintCarryoverSprintRow>(
      `SELECT d.id, d.title, d.properties FROM documents d
       WHERE d.id = $1 AND d.workspace_id = $2 AND document_type = 'sprint'`,
      [sourceSprintId, workspaceId]
    );

    if (sourceSprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Source week not found' });
      return;
    }

    const auth = await requireWeekLifecycleAuthority(
      pool,
      principalFromRequest(req),
      sourceSprintId,
      'carryover'
    );
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const sourceSprint = sourceSprintResult.rows[0];
    if (!sourceSprint) {
      res.status(404).json({ error: 'Source week not found' });
      return;
    }

    // 2. Validate target sprint exists and is planning/active
    const targetSprintResult = await pool.query<SprintCarryoverSprintRow>(
      `SELECT d.id, d.title, d.properties FROM documents d
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [target_sprint_id, workspaceId, userId, isAdmin]
    );

    if (targetSprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Target week not found' });
      return;
    }

    const targetSprint = targetSprintResult.rows[0];
    if (!targetSprint) {
      res.status(404).json({ error: 'Target week not found' });
      return;
    }
    const targetProps = targetSprint.properties || {};
    const targetStatus = targetProps.status || 'planning';

    if (!['planning', 'active'].includes(targetStatus)) {
      res.status(400).json({ error: `Target week must be planning or active (currently: ${targetStatus})` });
      return;
    }

    // 3. Verify all issue_ids belong to the source sprint and user has access
    const issueCheckResult = await pool.query<IdRow>(
      `SELECT d.id FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
       WHERE d.id = ANY($2) AND d.document_type = 'issue' AND d.workspace_id = $3
         AND ${VISIBILITY_FILTER_SQL('d', '$4', '$5')}`,
      [sourceSprintId, issue_ids, workspaceId, userId, isAdmin]
    );

    const foundIssueIds = new Set(issueCheckResult.rows.map(r => r.id));
    const missingIssues = issue_ids.filter(id => !foundIssueIds.has(id));

    if (missingIssues.length > 0) {
      res.status(400).json({
        error: 'Some issues not found in source week',
        missing_issue_ids: missingIssues,
      });
      return;
    }

    // 4. Move each issue: delete old association, create new one, update properties
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const issueId of issue_ids) {
        // Delete the sprint association from source sprint
        await client.query(
          `DELETE FROM document_associations
           WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'sprint'`,
          [issueId, sourceSprintId]
        );

        // Create new sprint association to target sprint
        await client.query(
          `INSERT INTO document_associations (document_id, related_id, relationship_type)
           VALUES ($1, $2, 'sprint')
           ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
          [issueId, target_sprint_id]
        );

        // Set carryover_from_sprint_id in the issue properties
        await client.query(
          `UPDATE documents
           SET properties = properties || $1::jsonb, updated_at = now()
           WHERE id = $2`,
          [JSON.stringify({ carryover_from_sprint_id: sourceSprintId }), issueId]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // 5. Return result
    res.json({
      moved_count: issue_ids.length,
      source_sprint: {
        id: sourceSprint.id,
        name: sourceSprint.title,
        sprint_number: sourceSprint.properties?.sprint_number || null,
      },
      target_sprint: {
        id: targetSprint.id,
        name: targetSprint.title,
        sprint_number: targetProps.sprint_number || null,
      },
    });
  } catch (err) {
    sendInternalError(res, err, 'Week carryover error:');
  }
});

export default router;
