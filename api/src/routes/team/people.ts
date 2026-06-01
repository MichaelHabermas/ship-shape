import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { guardDocumentIdParam, requirePersonRead } from '../../security/route-capability.js';
import { getActor, requireSelfOrAdminPerson } from '../../services/document-access.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError } from '../../utils/route-http.js';
import { buildWorkspaceSprintCalendar } from '../../services/team/sprint-calendar.js';
import { parseMetricEstimate } from './parse-metric.js';
import type {
  PersonSprintMetricsIssueRow,
  TeamPersonRow,
  WorkspaceSprintStartRow,
} from './types.js';

const router = Router();
router.get('/people', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Parse includeArchived query param
    const includeArchived = req.query.includeArchived === 'true';

    // Get person documents - return document id for navigation to person editor
    // Also include user_id for grid consistency
    // Email comes from properties or joined user
    // Include pending users so they appear in team lists (but can't be assigned)
    const result = await pool.query<TeamPersonRow>(
      `SELECT d.id, d.properties->>'user_id' as user_id, d.title as name,
              COALESCE(d.properties->>'email', u.email) as email,
              CASE WHEN d.archived_at IS NOT NULL THEN true ELSE false END as "isArchived",
              CASE WHEN d.properties->>'pending' = 'true' THEN true ELSE false END as "isPending",
              d.properties->>'reports_to' as "reportsTo",
              d.properties->>'role' as role
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND ($4 OR d.archived_at IS NULL)
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY d.archived_at NULLS FIRST, d.title`,
      [workspaceId, userId, isAdmin, includeArchived]
    );

    res.json(result.rows);
  } catch (err) {
    sendInternalError(res, err, 'Get people error:');
  }
});
router.get('/people/:personId/sprint-metrics', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const personId = guardDocumentIdParam(res, req.params.personId, 'Person not found');
    if (!personId || !(await requirePersonRead(req, res, personId))) {
      return;
    }

    const actor = getActor(req);
    let personDoc;
    try {
      personDoc = await requireSelfOrAdminPerson(pool, actor, personId);
    } catch {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const userIdProp = personDoc.properties?.user_id;
    const targetUserId = typeof userIdProp === 'string' ? userIdProp : undefined;
    if (!targetUserId) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    // Get workspace sprint start date
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const { sprints } = buildWorkspaceSprintCalendar(workspaceResult.rows[0]?.sprint_start_date, {
      trailingSprintCount: 6,
    });
    const fromSprint = sprints[0]?.number ?? 1;
    const toSprint = sprints[sprints.length - 1]?.number ?? fromSprint;

    // Get all issues for this person with estimates, sprint info, and completion state
    const issuesResult = await pool.query<PersonSprintMetricsIssueRow>(
      `SELECT
         COALESCE((i.properties->>'estimate')::numeric, 0) as estimate,
         i.properties->>'state' as state,
         s.properties->>'sprint_number' as sprint_number
       FROM documents i
       JOIN document_associations da_sprint ON da_sprint.document_id = i.id AND da_sprint.relationship_type = 'sprint'
       JOIN documents s ON s.id = da_sprint.related_id
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.properties->>'assignee_id' = $2`,
      [workspaceId, targetUserId]
    );

    // Calculate metrics: sprintNumber -> { committed, completed }
    const metrics: Record<number, { committed: number; completed: number }> = {};

    for (const issue of issuesResult.rows) {
      const sprintNumber = parseInt(issue.sprint_number, 10);
      const estimate = parseMetricEstimate(issue.estimate);
      const isDone = issue.state === 'done';

      // Skip if outside our range
      if (sprintNumber < fromSprint || sprintNumber > toSprint) continue;

      if (!metrics[sprintNumber]) {
        metrics[sprintNumber] = { committed: 0, completed: 0 };
      }

      metrics[sprintNumber].committed += estimate;
      if (isDone) {
        metrics[sprintNumber].completed += estimate;
      }
    }

    // Calculate average completion rate
    let totalCommitted = 0;
    let totalCompleted = 0;
    for (const data of Object.values(metrics)) {
      totalCommitted += data.committed;
      totalCompleted += data.completed;
    }
    const averageRate = totalCommitted > 0 ? Math.round((totalCompleted / totalCommitted) * 100) : 0;

    res.json({
      sprints,
      metrics,
      averageRate,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get person sprint metrics error:');
  }
});
export default router;
