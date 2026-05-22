import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { sendInternalError } from '../../utils/route-http.js';
import { logDocumentChange } from '../../utils/document-crud.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import {
  asApprovalRecord,
  buildApprovedApprovalRecord,
  buildChangesRequestedApprovalRecord,
  buildReviewRatingRecord,
  checkSprintSupervisorAuth,
  getApprovalComment,
  logApprovalPropertyChangeIfCommentChanged,
  logApprovalRevoked,
  parseApprovalComment,
  resolveApprovalComment,
  resolveApprovedVersionId,
  validateReviewRating,
} from '../../utils/approval-workflow.js';
import { broadcastToUser } from '../../collaboration/index.js';
import {
  broadcastAccountabilityUpdateToSprintOwner,
  getSprintOwnerReportsTo,
} from './shared.js';

const router = Router();

function parseWeekId(req: Request, res: Response): string | null {
  const { id } = req.params;
  if (typeof id !== 'string' || id.length === 0) {
    res.status(400).json({ error: 'Week id is required' });
    return null;
  }
  return id;
}

// POST /api/weeks/:id/approve-plan - Approve sprint plan
router.post('/:id/approve-plan', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseWeekId(req, res);
    if (!id) {
      return;
    }
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const parsedComment = parseApprovalComment(req.body);
    if (parsedComment.error) {
      res.status(400).json({ error: parsedComment.error });
      return;
    }

    // Get visibility context for admin check
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists, get properties and program's accountable_id
    const sprintResult = await pool.query(
      `SELECT d.id, d.properties, d.properties->>'owner_id' as sprint_owner_id,
              prog.properties->>'accountable_id' as program_accountable_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const sprint = sprintResult.rows[0];
    const ownerReportsTo = await getSprintOwnerReportsTo(id, workspaceId);
    const auth = checkSprintSupervisorAuth(
      sprint.program_accountable_id,
      ownerReportsTo,
      userId,
      isAdmin,
      'approve_plans',
    );
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const versionId = await resolveApprovedVersionId(id, 'plan');
    const currentProps = sprint.properties || {};
    const previousApproval = asApprovalRecord(currentProps.plan_approval);
    const previousComment = getApprovalComment(previousApproval);
    const resolvedComment = resolveApprovalComment(parsedComment, previousApproval);
    const newApproval = buildApprovedApprovalRecord(userId, versionId, resolvedComment);
    const newProps = {
      ...currentProps,
      plan_approval: newApproval,
    };

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND document_type = 'sprint'`,
      [JSON.stringify(newProps), id]
    );

    await logApprovalPropertyChangeIfCommentChanged(
      id,
      'plan_approval',
      previousApproval,
      previousComment,
      newApproval,
      userId,
    );

    await broadcastAccountabilityUpdateToSprintOwner(
      sprint.sprint_owner_id,
      id,
      'plan_approved'
    );

    res.json({
      success: true,
      approval: newApproval,
    });
  } catch (err) {
    sendInternalError(res, err, 'Approve sprint plan error:');
  }
});

// POST /api/weeks/:id/unapprove-plan - Revoke plan approval (logged to history)
router.post('/:id/unapprove-plan', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseWeekId(req, res);
    if (!id) {
      return;
    }
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const sprintResult = await pool.query(
      `SELECT d.id, d.properties, prog.properties->>'accountable_id' as program_accountable_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const sprint = sprintResult.rows[0];
    const ownerReportsTo = await getSprintOwnerReportsTo(id, workspaceId);
    const auth = checkSprintSupervisorAuth(
      sprint.program_accountable_id,
      ownerReportsTo,
      userId,
      isAdmin,
      'unapprove_plans',
    );
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const currentProps = sprint.properties || {};
    const previousApproval = asApprovalRecord(currentProps.plan_approval);

    await logApprovalRevoked(id, 'plan_approval', previousApproval, userId);

    // Remove the approval from properties
    const { plan_approval: _, ...restProps } = currentProps;

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND document_type = 'sprint'`,
      [JSON.stringify(restProps), id]
    );

    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Unapprove sprint plan error:');
  }
});

// POST /api/weeks/:id/approve-review - Approve sprint review (rating required)
router.post('/:id/approve-review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseWeekId(req, res);
    if (!id) {
      return;
    }
    const { rating } = req.body || {};
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const parsedComment = parseApprovalComment(req.body);
    if (parsedComment.error) {
      res.status(400).json({ error: parsedComment.error });
      return;
    }

    const ratingValidation = validateReviewRating(rating);
    if (!ratingValidation.ok) {
      res.status(400).json({ error: ratingValidation.error });
      return;
    }
    const ratingNum = ratingValidation.value;

    // Get visibility context for admin check
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists, get properties and program's accountable_id
    const sprintResult = await pool.query(
      `SELECT d.id, d.properties, d.properties->>'owner_id' as sprint_owner_id,
              prog.properties->>'accountable_id' as program_accountable_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const sprint = sprintResult.rows[0];
    const ownerReportsTo = await getSprintOwnerReportsTo(id, workspaceId);
    const auth = checkSprintSupervisorAuth(
      sprint.program_accountable_id,
      ownerReportsTo,
      userId,
      isAdmin,
      'approve_reviews',
    );
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const reviewResult = await pool.query(
      `SELECT d.id FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
       WHERE d.document_type = 'weekly_review' AND d.workspace_id = $2`,
      [id, workspaceId]
    );

    let versionId: number | null = null;
    if (reviewResult.rows.length > 0) {
      const reviewId = reviewResult.rows[0].id;
      versionId = await resolveApprovedVersionId(reviewId, 'review_content');
    }

    const currentProps = sprint.properties || {};
    const previousApproval = asApprovalRecord(currentProps.review_approval);
    const previousComment = getApprovalComment(previousApproval);
    const resolvedComment = resolveApprovalComment(parsedComment, previousApproval);
    const newApproval = buildApprovedApprovalRecord(userId, versionId, resolvedComment);
    const reviewRating = buildReviewRatingRecord(ratingNum, userId);
    const newProps: Record<string, unknown> = {
      ...currentProps,
      review_approval: newApproval,
      review_rating: reviewRating,
    };

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND document_type = 'sprint'`,
      [JSON.stringify(newProps), id]
    );

    await logApprovalPropertyChangeIfCommentChanged(
      id,
      'review_approval',
      previousApproval,
      previousComment,
      newApproval,
      userId,
    );

    await broadcastAccountabilityUpdateToSprintOwner(
      sprint.sprint_owner_id,
      id,
      'review_approved'
    );

    res.json({
      success: true,
      approval: newApproval,
      review_rating: newProps.review_rating,
    });
  } catch (err) {
    sendInternalError(res, err, 'Approve sprint review error:');
  }
});

// POST /api/weeks/:id/request-plan-changes - Request changes on sprint plan
router.post('/:id/request-plan-changes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseWeekId(req, res);
    if (!id) {
      return;
    }
    const { feedback } = req.body || {};
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Validate feedback is provided and not too long
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      res.status(400).json({ error: 'Feedback is required when requesting changes' });
      return;
    }
    if (feedback.length > 2000) {
      res.status(400).json({ error: 'Feedback must be 2000 characters or less' });
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and get authorization info
    const sprintResult = await pool.query(
      `SELECT d.id, d.properties, d.properties->>'owner_id' as sprint_owner_id,
              prog.properties->>'accountable_id' as program_accountable_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const sprint = sprintResult.rows[0];
    const ownerReportsTo = await getSprintOwnerReportsTo(id, workspaceId);
    const auth = checkSprintSupervisorAuth(
      sprint.program_accountable_id,
      ownerReportsTo,
      userId,
      isAdmin,
      'request_changes',
    );
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const currentProps = sprint.properties || {};
    const newProps = {
      ...currentProps,
      plan_approval: buildChangesRequestedApprovalRecord(userId, feedback.trim()),
    };

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND document_type = 'sprint'`,
      [JSON.stringify(newProps), id]
    );

    // Notify the sprint owner that changes were requested
    await broadcastAccountabilityUpdateToSprintOwner(
      sprint.sprint_owner_id,
      id,
      'changes_requested_plan',
    );

    res.json({
      success: true,
      approval: newProps.plan_approval,
    });
  } catch (err) {
    sendInternalError(res, err, 'Request plan changes error:');
  }
});

// POST /api/weeks/:id/request-retro-changes - Request changes on sprint retro
router.post('/:id/request-retro-changes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseWeekId(req, res);
    if (!id) {
      return;
    }
    const { feedback } = req.body || {};
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Validate feedback is provided and not too long
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      res.status(400).json({ error: 'Feedback is required when requesting changes' });
      return;
    }
    if (feedback.length > 2000) {
      res.status(400).json({ error: 'Feedback must be 2000 characters or less' });
      return;
    }

    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and get authorization info
    const sprintResult = await pool.query(
      `SELECT d.id, d.properties, d.properties->>'owner_id' as sprint_owner_id,
              prog.properties->>'accountable_id' as program_accountable_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const sprint = sprintResult.rows[0];
    const ownerReportsTo = await getSprintOwnerReportsTo(id, workspaceId);
    const auth = checkSprintSupervisorAuth(
      sprint.program_accountable_id,
      ownerReportsTo,
      userId,
      isAdmin,
      'request_changes',
    );
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const currentProps = sprint.properties || {};
    const newProps = {
      ...currentProps,
      review_approval: buildChangesRequestedApprovalRecord(userId, feedback.trim()),
    };

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND document_type = 'sprint'`,
      [JSON.stringify(newProps), id]
    );

    await broadcastAccountabilityUpdateToSprintOwner(
      sprint.sprint_owner_id,
      id,
      'changes_requested_retro',
    );

    res.json({
      success: true,
      approval: newProps.review_approval,
    });
  } catch (err) {
    sendInternalError(res, err, 'Request retro changes error:');
  }
});

export default router;
