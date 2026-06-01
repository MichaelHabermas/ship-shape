import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError } from '../../utils/route-http.js';
import { buildWorkspaceSprintCalendar } from '../../services/team/sprint-calendar.js';
import { parseMetricEstimate } from './parse-metric.js';
import type {
  AccountabilityIssueRow,
  AccountabilityPersonRow,
  WorkspaceSprintStartRow,
} from './types.js';

const router = Router();
router.get('/accountability', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Check if user is admin
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    // Get workspace sprint start date
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const { sprints, currentSprintNumber: _currentSprint } = buildWorkspaceSprintCalendar(workspaceResult.rows[0]?.sprint_start_date, {
      trailingSprintCount: 6,
    });
    const fromSprint = sprints[0]?.number ?? 1;
    const toSprint = sprints[sprints.length - 1]?.number ?? fromSprint;

    // Get all people in workspace (exclude pending - they can't have assignments)
    const peopleResult = await pool.query<AccountabilityPersonRow>(
      `SELECT
         d.properties->>'user_id' as id,
         d.title as name
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND d.archived_at IS NULL
         AND (d.properties->>'pending' IS NULL OR d.properties->>'pending' != 'true')
       ORDER BY d.title`,
      [workspaceId]
    );

    // Get all issues with estimates, assignees, sprint info, and completion state
    const issuesResult = await pool.query<AccountabilityIssueRow>(
      `SELECT
         i.properties->>'assignee_id' as assignee_id,
         da_sprint.related_id as sprint_id,
         COALESCE((i.properties->>'estimate')::numeric, 0) as estimate,
         i.properties->>'state' as state,
         s.properties->>'sprint_number' as sprint_number
       FROM documents i
       JOIN document_associations da_sprint ON da_sprint.document_id = i.id AND da_sprint.relationship_type = 'sprint'
       JOIN documents s ON s.id = da_sprint.related_id
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.properties->>'assignee_id' IS NOT NULL`,
      [workspaceId]
    );

    // Calculate metrics: userId -> sprintNumber -> { committed, completed }
    const metrics: Record<string, Record<number, { committed: number; completed: number }>> = {};

    for (const issue of issuesResult.rows) {
      const assigneeId = issue.assignee_id;
      const sprintNumber = parseInt(issue.sprint_number, 10);
      const estimate = parseMetricEstimate(issue.estimate);
      const isDone = issue.state === 'done';

      // Skip if outside our range
      if (sprintNumber < fromSprint || sprintNumber > toSprint) continue;

      if (!metrics[assigneeId]) {
        metrics[assigneeId] = {};
      }
      if (!metrics[assigneeId][sprintNumber]) {
        metrics[assigneeId][sprintNumber] = { committed: 0, completed: 0 };
      }

      metrics[assigneeId][sprintNumber].committed += estimate;
      if (isDone) {
        metrics[assigneeId][sprintNumber].completed += estimate;
      }
    }

    // Detect pattern alerts: 2+ consecutive sprints below 60% completion
    const patternAlerts: Record<string, {
      hasAlert: boolean;
      consecutiveCount: number;
      trend: number[]; // completion percentages for last N sprints
    }> = {};

    for (const person of peopleResult.rows) {
      if (!person.id) {
        continue;
      }
      const personMetrics = metrics[person.id];
      if (!personMetrics) {
        patternAlerts[person.id] = { hasAlert: false, consecutiveCount: 0, trend: [] };
        continue;
      }

      // Build trend array (completion percentages in sprint order)
      const trend: number[] = [];
      let consecutiveLow = 0;
      let maxConsecutiveLow = 0;

      for (let i = fromSprint; i <= toSprint; i++) {
        const sprintMetrics = personMetrics[i];
        if (sprintMetrics && sprintMetrics.committed > 0) {
          const rate = Math.round((sprintMetrics.completed / sprintMetrics.committed) * 100);
          trend.push(rate);

          if (rate < 60) {
            consecutiveLow++;
            maxConsecutiveLow = Math.max(maxConsecutiveLow, consecutiveLow);
          } else {
            consecutiveLow = 0;
          }
        } else {
          trend.push(-1); // -1 indicates no data
          consecutiveLow = 0; // Reset streak on no data
        }
      }

      patternAlerts[person.id] = {
        hasAlert: maxConsecutiveLow >= 2,
        consecutiveCount: maxConsecutiveLow,
        trend,
      };
    }

    res.json({
      people: peopleResult.rows,
      sprints,
      metrics,
      patternAlerts,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get accountability error:');
  }
});
export default router;
