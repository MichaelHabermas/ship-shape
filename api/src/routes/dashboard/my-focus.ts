import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { sendInternalError } from '../../utils/route-http.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { extractPlanItems, type PlanItem } from './plan-items.js';
import {
  type WorkspaceSprintStartRow,
  type PersonLookupRow,
  type FocusAllocationRow,
  type WeeklyPlanRow,
  type FocusActivityRow,
} from './types.js';

const router = Router();

router.get('/my-focus', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // 1. Look up the user's person document
    const personResult = await pool.query<PersonLookupRow>(
      `SELECT id, title FROM documents
       WHERE workspace_id = $1 AND document_type = 'person'
         AND (properties->>'user_id') = $2
       LIMIT 1`,
      [workspaceId, userId]
    );

    if (personResult.rows.length === 0) {
      res.status(404).json({ error: 'Person not found for current user' });
      return;
    }

    const personId = personResult.rows[0]?.id;
    if (!personId) {
      res.status(404).json({ error: 'Person not found for current user' });
      return;
    }
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
    const sprintDuration = 7;

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
    const currentWeekNumber = Math.floor(daysSinceStart / sprintDuration) + 1;
    const previousWeekNumber = currentWeekNumber - 1;

    // Calculate week start/end dates
    const weekStart = new Date(workspaceStartDate);
    weekStart.setUTCDate(weekStart.getUTCDate() + (currentWeekNumber - 1) * sprintDuration);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + sprintDuration - 1);

    // 3. Find projects the user is allocated to for the current week
    //    Sprint documents have assignee_ids array and project_id in properties
    const allocationsResult = await pool.query<FocusAllocationRow>(
      `SELECT DISTINCT
         proj.id as project_id,
         proj.title as project_title,
         prog.title as program_name
       FROM documents s
       JOIN documents proj ON (s.properties->>'project_id')::uuid = proj.id AND proj.document_type = 'project'
       LEFT JOIN document_associations prog_da ON proj.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id AND prog.document_type = 'program'
       WHERE s.workspace_id = $1
         AND s.document_type = 'sprint'
         AND s.properties->'assignee_ids' ? $2
         AND (s.properties->>'sprint_number')::int = $3
         AND s.deleted_at IS NULL
         AND proj.archived_at IS NULL`,
      [workspaceId, personId, currentWeekNumber]
    );

    const projectIds = allocationsResult.rows.map(r => r.project_id);

    // 4. Get weekly plans for current AND previous week for these projects
    let plansResult = { rows: [] as WeeklyPlanRow[] };
    if (projectIds.length > 0) {
      plansResult = await pool.query<WeeklyPlanRow>(
        `SELECT id, content, properties
         FROM documents
         WHERE workspace_id = $1
           AND document_type = 'weekly_plan'
           AND (properties->>'person_id') = $2
           AND (properties->>'project_id') = ANY($3)
           AND (properties->>'week_number')::int IN ($4, $5)
           AND deleted_at IS NULL`,
        [workspaceId, personId, projectIds, currentWeekNumber, previousWeekNumber]
      );
    }

    // Build plan lookup: `${projectId}_${weekNumber}` -> plan
    const planMap = new Map<string, { id: string; items: PlanItem[] }>();
    for (const row of plansResult.rows) {
      const props = row.properties || {};
      const key = `${props.project_id}_${props.week_number}`;
      planMap.set(key, {
        id: row.id,
        items: extractPlanItems(row.content),
      });
    }

    // 5. Get recent activity: issues associated with each project updated in last 7 days
    let activityResult = { rows: [] as FocusActivityRow[] };
    if (projectIds.length > 0) {
      activityResult = await pool.query<FocusActivityRow>(
        `SELECT d.id, d.title, d.ticket_number,
                COALESCE(d.properties->>'state', 'backlog') as state,
                d.updated_at,
                proj_assoc.related_id as project_id
         FROM documents d
         JOIN document_associations proj_assoc ON proj_assoc.document_id = d.id AND proj_assoc.relationship_type = 'project'
         WHERE d.workspace_id = $1
           AND d.document_type = 'issue'
           AND proj_assoc.related_id = ANY($2)
           AND d.updated_at >= NOW() - INTERVAL '7 days'
         ORDER BY d.updated_at DESC`,
        [workspaceId, projectIds]
      );
    }

    // Group activity by project
    const activityByProject = new Map<string, { id: string; title: string; ticket_number: number; state: string; updated_at: string }[]>();
    for (const row of activityResult.rows) {
      const list = activityByProject.get(row.project_id) || [];
      list.push({
        id: row.id,
        title: row.title,
        ticket_number: row.ticket_number,
        state: row.state,
        updated_at: row.updated_at,
      });
      activityByProject.set(row.project_id, list);
    }

    // 6. Assemble response
    const projects = allocationsResult.rows.map(row => {
      const currentPlan = planMap.get(`${row.project_id}_${currentWeekNumber}`);
      const previousPlan = planMap.get(`${row.project_id}_${previousWeekNumber}`);

      return {
        id: row.project_id,
        title: row.project_title,
        program_name: row.program_name || null,
        plan: currentPlan
          ? { id: currentPlan.id, week_number: currentWeekNumber, items: currentPlan.items }
          : { id: null, week_number: currentWeekNumber, items: [] },
        previous_plan: previousPlan
          ? { id: previousPlan.id, week_number: previousWeekNumber, items: previousPlan.items }
          : { id: null, week_number: previousWeekNumber, items: [] },
        recent_activity: activityByProject.get(row.project_id) || [],
      };
    });

    res.json({
      person_id: personId,
      current_week_number: currentWeekNumber,
      week_start: weekStart.toISOString().split('T')[0],
      week_end: weekEnd.toISOString().split('T')[0],
      projects,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get my focus error:');
  }
});
export default router;
