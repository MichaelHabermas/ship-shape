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

router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists, user can access it, and get program info
    const sprintResult = await pool.query<SprintPrefixRow>(
      `SELECT d.id, p.properties->>'prefix' as prefix FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const result = await pool.query<SprintIssueListRow>(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived
       FROM documents d
       JOIN document_associations sprint_da ON sprint_da.document_id = d.id AND sprint_da.related_id = $1 AND sprint_da.relationship_type = 'sprint'
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       WHERE d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id, userId, isAdmin]
    );

    // Get carryover sprint names for issues that have carryover_from_sprint_id
    const carryoverSprintIds = result.rows
      .map(row => row.properties?.carryover_from_sprint_id)
      .filter(Boolean);

    let carryoverSprintNames: Record<string, string> = {};
    if (carryoverSprintIds.length > 0) {
      const uniqueIds = [...new Set(carryoverSprintIds)];
      const sprintNamesResult = await pool.query<SprintTitleRow>(
        `SELECT id, title FROM documents WHERE id = ANY($1) AND document_type = 'sprint'`,
        [uniqueIds]
      );
      carryoverSprintNames = Object.fromEntries(
        sprintNamesResult.rows.map(r => [r.id, r.title])
      );
    }

    const issues = result.rows.map(row => {
      const props = row.properties || {};
      const carryoverFromSprintId = props.carryover_from_sprint_id || null;
      return {
        id: row.id,
        title: row.title,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        estimate: props.estimate ?? null,
        ticket_number: row.ticket_number,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        assignee_name: row.assignee_name,
        assignee_archived: row.assignee_archived || false,
        display_id: `#${row.ticket_number}`,
        carryover_from_sprint_id: carryoverFromSprintId,
        carryover_from_sprint_name: carryoverFromSprintId
          ? carryoverSprintNames[carryoverFromSprintId] || null
          : null,
      };
    });

    res.json(issues);
  } catch (err) {
    sendInternalError(res, err, 'Get sprint issues error:');
  }
});

// Get sprint scope changes
// Returns: { originalScope, currentScope, scopeChangePercent, scopeChanges }
router.get('/:id/scope-changes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get sprint info including sprint_number and workspace start date
    const sprintResult = await pool.query<SprintScopeInfoRow>(
      `SELECT d.id, d.properties->>'sprint_number' as sprint_number,
              w.sprint_start_date as workspace_sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const sprintNumber = parseInt(String(sprintResult.rows[0]?.sprint_number ?? ''), 10);
    const rawStartDate = sprintResult.rows[0]?.workspace_sprint_start_date;
    const sprintDuration = 7; // 1-week sprints

    // Calculate sprint start date
    let workspaceStartDate: Date;
    if (rawStartDate instanceof Date) {
      workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
    } else if (typeof rawStartDate === 'string') {
      workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
    } else {
      workspaceStartDate = new Date();
    }

    const sprintStartDate = new Date(workspaceStartDate);
    sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

    // Get all issues currently in the sprint with their estimates
    const issuesResult = await pool.query<SprintIssueEstimateRow>(
      `SELECT d.id, COALESCE((d.properties->>'estimate')::numeric, 0) as estimate
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
       WHERE d.document_type = 'issue'`,
      [id]
    );

    // Get when each issue was added to this sprint from document_history
    // field = 'sprint_id' and new_value = sprint_id means issue was added to sprint
    const historyResult = await pool.query<SprintHistoryRow>(
      `SELECT document_id, created_at, old_value, new_value
       FROM document_history
       WHERE field = 'sprint_id' AND new_value = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Build a map of issue_id -> first_added_at (when issue was added to this sprint)
    const issueAddedAtMap: Record<string, Date> = {};
    for (const row of historyResult.rows) {
      if (!issueAddedAtMap[row.document_id]) {
        issueAddedAtMap[row.document_id] = new Date(row.created_at);
      }
    }

    // Calculate original scope (issues added before or at sprint start)
    // and current scope (all issues)
    let originalScope = 0;
    let currentScope = 0;

    for (const issue of issuesResult.rows) {
      const estimate = parseFloat(String(issue.estimate)) || 0;
      currentScope += estimate;

      const addedAt = issueAddedAtMap[issue.id];
      // If no history record, assume it was always there (original)
      // If added before or at sprint start, it's original scope
      if (!addedAt || addedAt <= sprintStartDate) {
        originalScope += estimate;
      }
    }

    // Build scope changes timeline for the graph
    // Each entry: { timestamp, newScope, changeType, estimateChange }
    const scopeChanges: Array<{
      timestamp: string;
      scopeAfter: number;
      changeType: 'added' | 'removed';
      estimateChange: number;
    }> = [];

    // Get estimates for issues when they were added
    const issueEstimateMap: Record<string, number> = {};
    for (const issue of issuesResult.rows) {
      issueEstimateMap[issue.id] = parseFloat(String(issue.estimate)) || 0;
    }

    // Only track changes after sprint starts
    let runningScope = originalScope;
    for (const row of historyResult.rows) {
      const createdAt = new Date(row.created_at);
      if (createdAt > sprintStartDate) {
        const estimate = issueEstimateMap[row.document_id] || 0;
        runningScope += estimate;
        scopeChanges.push({
          timestamp: createdAt.toISOString(),
          scopeAfter: runningScope,
          changeType: 'added',
          estimateChange: estimate,
        });
      }
    }

    // Also check for issues removed from sprint (sprint_id changed away from this sprint)
    const removedResult = await pool.query<SprintHistoryRow>(
      `SELECT document_id, created_at, old_value, new_value
       FROM document_history
       WHERE field = 'sprint_id' AND old_value = $1 AND created_at > $2
       ORDER BY created_at ASC`,
      [id, sprintStartDate.toISOString()]
    );

    for (const row of removedResult.rows) {
      // We need the estimate of the issue at time of removal
      // For simplicity, we'll use the current estimate (or 0 if issue no longer in sprint)
      // In a real system, you might want to track historical estimates
      const issueResult = await pool.query<SprintIssueEstimateRow>(
        `SELECT COALESCE((properties->>'estimate')::numeric, 0) as estimate
         FROM documents WHERE id = $1`,
        [row.document_id]
      );
      const estimate = issueResult.rows[0]
        ? parseFloat(String(issueResult.rows[0].estimate))
        : 0;

      scopeChanges.push({
        timestamp: new Date(row.created_at).toISOString(),
        scopeAfter: -1, // Will be recalculated when sorting
        changeType: 'removed',
        estimateChange: -estimate,
      });
    }

    // Sort scope changes by timestamp and recalculate running scope
    scopeChanges.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    runningScope = originalScope;
    for (const change of scopeChanges) {
      runningScope += change.estimateChange;
      change.scopeAfter = runningScope;
    }

    // Calculate scope change percentage
    const scopeChangePercent = originalScope > 0
      ? Math.round(((currentScope - originalScope) / originalScope) * 100)
      : 0;

    res.json({
      originalScope,
      currentScope,
      scopeChangePercent,
      sprintStartDate: sprintStartDate.toISOString(),
      scopeChanges,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get sprint scope changes error:');
  }
});

export default router;
