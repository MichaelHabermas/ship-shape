import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { computeICEScore, extractPlanItemsFromContent } from '@ship/shared';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Urgency levels for work items
type Urgency = 'overdue' | 'this_sprint' | 'later';

interface WorkItem {
  id: string;
  title: string;
  type: 'issue' | 'project' | 'sprint';
  urgency: Urgency;
  // Issue-specific
  state?: string;
  priority?: string;
  ticket_number?: number;
  sprint_id?: string | null;
  sprint_name?: string | null;
  // Project-specific
  ice_score?: number | null;
  inferred_status?: string;
  // Sprint-specific
  sprint_number?: number;
  days_remaining?: number;
  // Common
  program_name?: string | null;
}

/**
 * GET /api/dashboard/my-work
 * Returns work items for the current user organized by urgency.
 * - Issues assigned to current user
 * - Projects owned by current user
 * - Sprints owned by current user (active ones only, not action items)
 */
router.get('/my-work', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get workspace sprint configuration to calculate current sprint number
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0].sprint_start_date;
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
    const issuesResult = await pool.query(
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
      const props = row.properties || {};
      const sprintNumber = row.sprint_number;

      // Determine urgency based on sprint status
      let urgency: Urgency = 'later';
      if (sprintNumber) {
        if (sprintNumber < currentSprintNumber) {
          urgency = 'overdue'; // Past sprint, issue not done
        } else if (sprintNumber === currentSprintNumber) {
          urgency = 'this_sprint';
        }
        // Future sprints stay as 'later'
      }
      // No sprint = 'later' (backlog)

      workItems.push({
        id: row.id,
        title: row.title,
        type: 'issue',
        urgency,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        ticket_number: row.ticket_number,
        sprint_id: row.sprint_id,
        sprint_name: row.sprint_name,
        program_name: row.program_name,
      });
    }

    // 2. Get projects owned by current user (not archived)
    const projectsResult = await pool.query(
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
      const props = row.properties || {};
      const impact = props.impact !== undefined ? props.impact : null;
      const confidence = props.confidence !== undefined ? props.confidence : null;
      const ease = props.ease !== undefined ? props.ease : null;

      // Determine urgency based on project status
      let urgency: Urgency = 'later';
      if (row.inferred_status === 'active') {
        urgency = 'this_sprint';
      }
      // 'completed' projects are filtered out or could be shown differently
      // 'planned' and 'backlog' stay as 'later'

      workItems.push({
        id: row.id,
        title: row.title,
        type: 'project',
        urgency,
        ice_score: computeICEScore(impact, confidence, ease),
        inferred_status: row.inferred_status,
        program_name: row.program_name,
      });
    }

    // 3. Get active sprints owned by current user
    const sprintsResult = await pool.query(
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
      workItems.push({
        id: row.id,
        title: row.title || `Week ${row.sprint_number}`,
        type: 'sprint',
        urgency: 'this_sprint',
        sprint_number: row.sprint_number,
        days_remaining: daysRemaining,
        program_name: row.program_name,
      });
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

// ============== My Focus ==============

interface PlanItem {
  text: string;
  checked: boolean;
}

function extractPlanItems(content: unknown): PlanItem[] {
  return extractPlanItemsFromContent(content, {
    includeParagraphs: false,
    withChecked: true,
  });
}

/**
 * GET /api/dashboard/my-focus
 * Returns the current user's project context for the dashboard:
 * - Projects the user is allocated to for the current week
 * - Current and previous week plans with parsed items
 * - Recent activity (issues updated in last 7 days) per project
 */
router.get('/my-focus', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // 1. Look up the user's person document
    const personResult = await pool.query(
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

    const personId = personResult.rows[0].id;

    // 2. Get workspace sprint configuration
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0].sprint_start_date;
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
    const allocationsResult = await pool.query(
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
    let plansResult = { rows: [] as { id: string; content: unknown; properties: Record<string, unknown> }[] };
    if (projectIds.length > 0) {
      plansResult = await pool.query(
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
    let activityResult = { rows: [] as { id: string; title: string; ticket_number: number; state: string; updated_at: string; project_id: string }[] };
    if (projectIds.length > 0) {
      activityResult = await pool.query(
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

/**
 * GET /api/dashboard/my-week
 * Returns aggregated data for the current user's week dashboard:
 * - Week metadata (number, dates, is_current)
 * - Plan document (or null)
 * - Previous week retro (for "incomplete retro" nudge)
 * - Current week retro (or null)
 * - Standups (7 slots, one per day, nulls for missing)
 * - Project allocations for the week
 */
router.get('/my-week', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // 1. Look up the user's person document
    const personResult = await pool.query(
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

    const personId = personResult.rows[0].id;
    const personName = personResult.rows[0].title;

    // 2. Get workspace sprint configuration
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0].sprint_start_date;
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

    // Determine target week (support ?week_number=N for navigation)
    let targetWeekNumber = currentWeekNumber;
    if (req.query.week_number && typeof req.query.week_number === 'string') {
      const parsed = parseInt(req.query.week_number, 10);
      if (!isNaN(parsed) && parsed > 0) {
        targetWeekNumber = parsed;
      }
    }

    const isCurrent = targetWeekNumber === currentWeekNumber;
    const previousWeekNumber = targetWeekNumber - 1;

    // Calculate week start/end dates
    const weekStart = new Date(workspaceStartDate);
    weekStart.setUTCDate(weekStart.getUTCDate() + (targetWeekNumber - 1) * sprintDuration);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + sprintDuration - 1);

    // 3. Fetch plan for target week (by person_id + week_number only)
    const planResult = await pool.query(
      `SELECT id, title, content, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_plan'
         AND (properties->>'person_id') = $2
         AND (properties->>'week_number')::int = $3
         AND archived_at IS NULL
         AND deleted_at IS NULL
       LIMIT 1`,
      [workspaceId, personId, targetWeekNumber]
    );

    const plan = planResult.rows.length > 0
      ? {
          id: planResult.rows[0].id,
          title: planResult.rows[0].title,
          submitted_at: planResult.rows[0].properties?.submitted_at || null,
          items: extractPlanItems(planResult.rows[0].content),
        }
      : null;

    // 4. Fetch retro for target week
    const retroResult = await pool.query(
      `SELECT id, title, content, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_retro'
         AND (properties->>'person_id') = $2
         AND (properties->>'week_number')::int = $3
         AND archived_at IS NULL
         AND deleted_at IS NULL
       LIMIT 1`,
      [workspaceId, personId, targetWeekNumber]
    );

    const retro = retroResult.rows.length > 0
      ? {
          id: retroResult.rows[0].id,
          title: retroResult.rows[0].title,
          submitted_at: retroResult.rows[0].properties?.submitted_at || null,
          items: extractPlanItems(retroResult.rows[0].content),
        }
      : null;

    // 5. Fetch previous week retro (for "incomplete retro" nudge)
    let previousRetro = null;
    if (previousWeekNumber > 0) {
      const prevRetroResult = await pool.query(
        `SELECT id, title, properties
         FROM documents
         WHERE workspace_id = $1
           AND document_type = 'weekly_retro'
           AND (properties->>'person_id') = $2
           AND (properties->>'week_number')::int = $3
           AND archived_at IS NULL
           AND deleted_at IS NULL
         LIMIT 1`,
        [workspaceId, personId, previousWeekNumber]
      );

      previousRetro = prevRetroResult.rows.length > 0
        ? {
            id: prevRetroResult.rows[0].id,
            title: prevRetroResult.rows[0].title,
            submitted_at: prevRetroResult.rows[0].properties?.submitted_at || null,
            week_number: previousWeekNumber,
          }
        : { id: null, title: null, submitted_at: null, week_number: previousWeekNumber };
    }

    // 6. Fetch standups for the 7 days of the target week
    // Compute the 7 dates
    const standupDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setUTCDate(d.getUTCDate() + i);
      const dateStr = d.toISOString().split('T')[0] as string;
      standupDates.push(dateStr);
    }

    const standupsResult = await pool.query(
      `SELECT id, title, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'standup'
         AND (properties->>'author_id') = $2
         AND (properties->>'date') = ANY($3)
         AND deleted_at IS NULL
       ORDER BY (properties->>'date') ASC`,
      [workspaceId, userId, standupDates]
    );

    // Build standup map by date
    const standupMap = new Map<string, { id: string; title: string; date: string; created_at: string }>();
    for (const row of standupsResult.rows) {
      const date = row.properties?.date;
      if (date) {
        standupMap.set(date, {
          id: row.id,
          title: row.title,
          date,
          created_at: row.created_at,
        });
      }
    }

    // Build 7-slot standup array
    const standups = standupDates.map(date => {
      const standup = standupMap.get(date);
      const dayOfWeek = new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      return standup
        ? { date, day: dayOfWeek, standup }
        : { date, day: dayOfWeek, standup: null };
    });

    // 7. Fetch project allocations for the target week
    const allocationsResult = await pool.query(
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
      [workspaceId, personId, targetWeekNumber]
    );

    const projects = allocationsResult.rows.map(row => ({
      id: row.project_id,
      title: row.project_title,
      program_name: row.program_name || null,
    }));

    // 8. Assemble response
    res.json({
      person_id: personId,
      person_name: personName,
      week: {
        week_number: targetWeekNumber,
        current_week_number: currentWeekNumber,
        start_date: weekStart.toISOString().split('T')[0],
        end_date: weekEnd.toISOString().split('T')[0],
        is_current: isCurrent,
      },
      plan,
      retro,
      previous_retro: previousRetro,
      standups,
      projects,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get my-week error:');
  }
});

export default router;
