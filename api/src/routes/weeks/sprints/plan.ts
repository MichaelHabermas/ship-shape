import type { PlanHistoryEntry } from '@ship/shared';
import { Router, Request, Response } from 'express';
import { pool } from '../../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../../middleware/visibility.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { requireWeekLifecycleAuthority } from '../../../services/governance-auth.js';
import { getAuthenticatedRouteContext } from '../../../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../../../utils/route-http.js';
import { formatWireDate } from '../../../utils/format-wire-date.js';
import { logDocumentChange } from '../../../utils/document-crud.js';
import { asApprovalRecord } from '../../../utils/approval-workflow.js';
import { broadcastToUser } from '../../../collaboration/index.js';
import { principalFromRequest } from '../../../security/principal.js';
import { requireWeekRead, requireWeekWrite } from '../week-access.js';
import type {
  SprintRow,
  SprintInsertRow,
  WorkspaceSprintStartRow,
  ProgramExistsRow,
  IdRow,
  UserIdRow,
  WorkspaceMemberUserRow,
  SprintExistsRow,
  SprintPrefixRow,
  SprintIssueListRow,
  SprintTitleRow,
  SprintScopeInfoRow,
  SprintIssueEstimateRow,
  SprintHistoryRow,
} from '../types.js';
import {
  visibleSprintIssueCountSql,
  createSprintSchema,
  updateSprintSchema,
  updatePlanSchema,
  extractSprintFromRow,
  isSprintActive,
  takeSprintSnapshot,
} from './shared.js';

const router = Router();

router.patch('/:id/plan', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekWrite(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it, get current properties
    const existing = await pool.query<SprintExistsRow>(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const planExisting = existing.rows[0];
    if (!planExisting) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const currentProps = planExisting.properties || {};
    const newProps = { ...currentProps };
    const data = parsed.data;
    const now = new Date().toISOString();
    // If plan is being updated, append old one to history
    if (data.plan !== undefined && data.plan !== currentProps.plan) {
      // Initialize history if doesn't exist
      const currentHistory: PlanHistoryEntry[] = Array.isArray(currentProps.plan_history)
        ? [...currentProps.plan_history]
        : [];

      // If there was a previous plan, add it to history
      if (currentProps.plan) {
        currentHistory.push({
          plan: currentProps.plan,
          timestamp: now,
          author_id: userId,
        });
      }

      // Update to new plan
      newProps.plan = data.plan;
      newProps.plan_history = currentHistory;

    }

    // Update success_criteria and confidence directly
    if (data.success_criteria !== undefined) {
      newProps.success_criteria = data.success_criteria;
    }
    if (data.confidence !== undefined) {
      newProps.confidence = data.confidence;
    }

    // If plan or success_criteria changed and was previously approved, transition to 'changed_since_approved'
    const planChanged = data.plan !== undefined && data.plan !== currentProps.plan;
    const criteriaChanged = data.success_criteria !== undefined &&
      JSON.stringify(data.success_criteria) !== JSON.stringify(currentProps.success_criteria);

    const currentPlanApproval = asApprovalRecord(currentProps.plan_approval);
    if ((planChanged || criteriaChanged) && currentPlanApproval?.state === 'approved') {
      newProps.plan_approval = {
        ...currentPlanApproval,
        state: 'changed_since_approved',
      };
    }

    // Save updated properties
    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND workspace_id = $3 AND document_type = 'sprint'`,
      [JSON.stringify(newProps), id, workspaceId]
    );

    // Log changes to document_history for approval workflow tracking
    if (data.plan !== undefined && data.plan !== currentProps.plan) {
      await logDocumentChange(
        id,
        'plan',
        currentProps.plan || null,
        data.plan || null,
        userId
      );
    }
    if (data.success_criteria !== undefined) {
      const oldCriteria = currentProps.success_criteria ? JSON.stringify(currentProps.success_criteria) : null;
      const newCriteria = data.success_criteria ? JSON.stringify(data.success_criteria) : null;
      if (oldCriteria !== newCriteria) {
        await logDocumentChange(
          id,
          'success_criteria',
          oldCriteria,
          newCriteria,
          userId
        );
      }
    }

    // Broadcast celebration when plan is added
    if (data.plan && data.plan.trim() !== '') {
      broadcastToUser(userId, 'accountability:updated', { type: 'weekly_plan', targetId: id });
    }

    // Re-query to get full sprint with owner info
    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (${visibleSprintIssueCountSql('$2', '$3')}) as issue_count,
              (${visibleSprintIssueCountSql('$2', '$3', "i.properties->>'state' = 'done'")}) as completed_count,
              (${visibleSprintIssueCountSql('$2', '$3', "i.properties->>'state' IN ('in_progress', 'in_review')")}) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'weekly_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
	       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id, userId, isAdmin]
    );

    const updatedRow = result.rows[0];
    if (!updatedRow) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }
    res.json(extractSprintFromRow(updatedRow));
  } catch (err) {
    sendInternalError(res, err, 'Update sprint plan error:');
  }
});

export default router;
