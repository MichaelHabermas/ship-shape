import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { sendInternalError } from '../../utils/route-http.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import {
  type WorkspaceSprintStartRow,
  type DashboardIssueRow,
  type DashboardProjectRow,
  type DashboardSprintRow,
  extractDashboardIssueWorkItem,
  extractDashboardProjectWorkItem,
  extractDashboardSprintWorkItem,
  type WorkItem,
} from './types.js';

const router = Router();
router.get('/my-work', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get workspace sprint configuration to calculate current sprint number
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0]?.sprint_start_date;
    if (rawStartDate === undefined) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    const sprintDuration = 7; // 7-day sprints

    // Calculate the current sprint number
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

    // Calculate days remaining in current sprint
    const currentSprintStart = new Date(workspaceStartDate);
    currentSprintStart.setUTCDate(currentSprintStart.getUTCDate() + (currentSprintNumber - 1) * sprintDuration);
    const currentSprintEnd = new Date(currentSprintStart);
    currentSprintEnd.setUTCDate(currentSprintEnd.getUTCDate() + sprintDuration - 1);
    const daysRemaining = Math.max(0, Math.ceil((currentSprintEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const workItems: WorkItem[] = [];

    // 1. Get issues assigned to current user (not done/cancelled)
    const issuesResult = await pool.query<DashboardIssueRow>(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              sprint_assoc.related_id as sprint_id,
              sprint.title as sprint_name,
              (sprint.properties->>'sprint_number')::int as sprint_number,
              p.title as program_name
       FROM documents d
       LEFT JOIN document_associations sprint_assoc ON sprint_assoc.document_id = d.id AND sprint_assoc.relationship_type = 'sprint'
       LEFT JOIN documents sprint ON sprint.id = sprint_assoc.related_id AND sprint.document_type = 'sprint'
       LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
       WHERE d.workspace_id = $1
         AND d.document_type = 'issue'
         AND (d.properties->>'assignee_id')::uuid = $2
         AND d.properties->>'state' NOT IN ('done', 'cancelled')
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [workspaceId, userId, userId, isAdmin]
    );

    for (const row of issuesResult.rows) {
      workItems.push(extractDashboardIssueWorkItem(row, currentSprintNumber));
    }

    // 2. Get projects owned by current user (not archived)
    const projectsResult = await pool.query<DashboardProjectRow>(
      `SELECT d.id, d.title, d.properties,
              p.title as program_name,
              CASE
                WHEN d.archived_at IS NOT NULL THEN 'archived'
                ELSE COALESCE(
                  (
                    SELECT
                      CASE MAX(
                        CASE
                          WHEN CURRENT_DATE BETWEEN
                            (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                            AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                          THEN 3
                          WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                          THEN 2
                          ELSE 1
                        END
                      )
                      WHEN 3 THEN 'active'
                      WHEN 2 THEN 'planned'
                      WHEN 1 THEN 'completed'
                      ELSE NULL
                      END
                    FROM documents issue
                    JOIN document_associations sprint_assoc ON sprint_assoc.document_id = issue.id AND sprint_assoc.relationship_type = 'sprint'
                    JOIN documents sprint ON sprint.id = sprint_assoc.related_id AND sprint.document_type = 'sprint'
                    JOIN document_associations proj_assoc ON proj_assoc.document_id = issue.id AND proj_assoc.relationship_type = 'project'
                    JOIN workspaces w ON w.id = d.workspace_id
                    WHERE proj_assoc.related_id = d.id
                      AND issue.document_type = 'issue'
                  ),
                  'backlog'
                )
              END as inferred_status
       FROM documents d
       LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
       WHERE d.workspace_id = $1
         AND d.document_type = 'project'
         AND (d.properties->>'owner_id')::uuid = $2
         AND d.archived_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY d.updated_at DESC`,
      [workspaceId, userId, userId, isAdmin]
    );

    for (const row of projectsResult.rows) {
      workItems.push(extractDashboardProjectWorkItem(row));
    }

    // 3. Get active sprints owned by current user
    const sprintsResult = await pool.query<DashboardSprintRow>(
      `SELECT d.id, d.title, d.properties,
              p.title as program_name,
              (d.properties->>'sprint_number')::int as sprint_number
       FROM documents d
       JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
       WHERE d.workspace_id = $1
         AND d.document_type = 'sprint'
         AND (d.properties->>'owner_id')::uuid = $2
         AND (d.properties->>'sprint_number')::int = $3
         AND ${VISIBILITY_FILTER_SQL('d', '$4', '$5')}
       ORDER BY p.title`,
      [workspaceId, userId, currentSprintNumber, userId, isAdmin]
    );

    for (const row of sprintsResult.rows) {
      workItems.push(extractDashboardSprintWorkItem(row, daysRemaining));
    }

    // Group by urgency for the response
    const grouped = {
      overdue: workItems.filter(item => item.urgency === 'overdue'),
      this_sprint: workItems.filter(item => item.urgency === 'this_sprint'),
      later: workItems.filter(item => item.urgency === 'later'),
    };

    res.json({
      items: workItems,
      grouped,
      current_sprint_number: currentSprintNumber,
      days_remaining: daysRemaining,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get my work error:');
  }
});
export default router;
