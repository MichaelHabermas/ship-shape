// My-week aggregation and personal sprint action-item routes.
import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { sendInternalError } from '../../utils/route-http.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import { readIssueListFields } from '../../utils/document-properties.js';
import type {
  SprintActionItemRow,
  MyWeekIssueRow,
  MyWeekIssue,
} from './types.js';

type WorkspaceSprintStartRow = {
  sprint_start_date: Date | string | null;
};

const router = Router();

router.get('/my-action-items', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get workspace sprint configuration
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = requireFirstRow(workspaceResult.rows).sprint_start_date;
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

    // Get sprints owned by this user that need either plan or retro - join via document_associations
    // Include current sprint (for plans) and previous sprint (for retros)
    // Plans/retros are matched by week_number property and created_by user
    const result = await pool.query<SprintActionItemRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name,
              (d.properties->>'sprint_number')::int as sprint_number,
              (SELECT COUNT(*) > 0 FROM documents pl
               WHERE pl.workspace_id = d.workspace_id
                 AND pl.document_type = 'weekly_plan'
                 AND (pl.properties->>'week_number')::int = (d.properties->>'sprint_number')::int
                 AND pl.created_by = $2) as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt
               WHERE rt.workspace_id = d.workspace_id
                 AND rt.document_type = 'weekly_retro'
                 AND (rt.properties->>'week_number')::int = (d.properties->>'sprint_number')::int
                 AND rt.created_by = $2) as has_retro
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'sprint'
         AND (d.properties->>'owner_id')::uuid = $2
         AND (d.properties->>'sprint_number')::int >= $3 - 1
         AND (d.properties->>'sprint_number')::int <= $3
       ORDER BY (d.properties->>'sprint_number')::int DESC`,
      [workspaceId, userId, currentSprintNumber]
    );

    interface ActionItem {
      id: string;
      type: 'plan' | 'retro';
      sprint_id: string;
      sprint_title: string;
      program_id: string | null;
      program_name: string | null;
      sprint_number: number;
      urgency: 'overdue' | 'due_today' | 'due_soon' | 'upcoming';
      days_until_due: number;
      message: string;
    }

    const actionItems: ActionItem[] = [];

    for (const row of result.rows) {
      const sprintNumber = parseInt(String(row.sprint_number), 10);
      const hasPlan = row.has_plan === true || row.has_plan === 't';
      const hasRetro = row.has_retro === true || row.has_retro === 't';

      // Calculate sprint dates
      const sprintStart = new Date(workspaceStartDate);
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (sprintNumber - 1) * sprintDuration);
      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDuration - 1);

      // Days into current sprint (for plan urgency)
      const daysIntoSprint = Math.floor((today.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
      // Days since sprint ended (for retro urgency)
      const daysSinceEnd = Math.floor((today.getTime() - sprintEnd.getTime()) / (1000 * 60 * 60 * 24));

      // Check for missing sprint plan (active sprint only)
      if (sprintNumber === currentSprintNumber && !hasPlan) {
        let urgency: ActionItem['urgency'] = 'upcoming';
        let message = 'Write weekly plan';

        if (daysIntoSprint >= 3) {
          urgency = 'overdue';
          message = `Weekly plan is ${daysIntoSprint - 2} days overdue`;
        } else if (daysIntoSprint >= 2) {
          urgency = 'due_today';
          message = 'Weekly plan due today';
        } else if (daysIntoSprint >= 1) {
          urgency = 'due_soon';
          message = 'Weekly plan due tomorrow';
        }

        actionItems.push({
          id: `plan-${row.id}`,
          type: 'plan',
          sprint_id: row.id,
          sprint_title: row.title || `Week ${sprintNumber}`,
          program_id: row.program_id,
          program_name: row.program_name,
          sprint_number: sprintNumber,
          urgency,
          days_until_due: Math.max(0, 2 - daysIntoSprint),
          message,
        });
      }

      // Check for missing retro (past sprints only)
      if (sprintNumber < currentSprintNumber && !hasRetro) {
        let urgency: ActionItem['urgency'] = 'upcoming';
        let message = 'Write sprint retro';

        if (daysSinceEnd > 3) {
          urgency = 'overdue';
          message = `Weekly retro is ${daysSinceEnd - 3} days overdue`;
        } else if (daysSinceEnd === 3) {
          urgency = 'due_today';
          message = 'Weekly retro due today';
        } else if (daysSinceEnd >= 1) {
          urgency = 'due_soon';
          message = `Weekly retro due in ${3 - daysSinceEnd} days`;
        }

        actionItems.push({
          id: `retro-${row.id}`,
          type: 'retro',
          sprint_id: row.id,
          sprint_title: row.title || `Week ${sprintNumber}`,
          program_id: row.program_id,
          program_name: row.program_name,
          sprint_number: sprintNumber,
          urgency,
          days_until_due: Math.max(0, 3 - daysSinceEnd),
          message,
        });
      }
    }

    // Sort by urgency (overdue first, then due_today, due_soon, upcoming)
    const urgencyOrder = { overdue: 0, due_today: 1, due_soon: 2, upcoming: 3 };
    actionItems.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    res.json({ action_items: actionItems });
  } catch (err) {
    sendInternalError(res, err, 'Get my action items error:');
  }
});

// Get "My Week" view - aggregates issues from all active sprints
// Virtual aggregation: no 'week' document created, purely computed
// Supports historical week viewing via sprint_number query param
router.get('/my-week', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { state, assignee, show_mine, sprint_number: requestedSprintNumber } = req.query;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get workspace sprint_start_date to calculate current sprint number
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = requireFirstRow(workspaceResult.rows).sprint_start_date;
    const sprintDuration = 7;

    // Calculate current sprint number
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

    // Determine which sprint to show (current or historical)
    let targetSprintNumber = currentSprintNumber;
    let isHistorical = false;

    if (requestedSprintNumber && typeof requestedSprintNumber === 'string') {
      const parsed = parseInt(requestedSprintNumber, 10);
      // Validate: must be positive, not in the future, and within 12 weeks back
      if (!isNaN(parsed) && parsed > 0 && parsed <= currentSprintNumber && parsed >= currentSprintNumber - 12) {
        targetSprintNumber = parsed;
        isHistorical = targetSprintNumber < currentSprintNumber;
      }
    }

    // Calculate sprint dates for the target sprint
    const targetSprintStart = new Date(workspaceStartDate);
    targetSprintStart.setUTCDate(targetSprintStart.getUTCDate() + (targetSprintNumber - 1) * sprintDuration);
    const targetSprintEnd = new Date(targetSprintStart);
    targetSprintEnd.setUTCDate(targetSprintEnd.getUTCDate() + sprintDuration - 1);

    // Days remaining only makes sense for current sprint
    const daysRemaining = isHistorical ? 0 : Math.max(0, Math.ceil((targetSprintEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // Build dynamic WHERE clause for issue filters
    const params: unknown[] = [workspaceId, targetSprintNumber, userId, isAdmin];
    let filterConditions = '';

    if (state && typeof state === 'string') {
      params.push(state);
      filterConditions += ` AND i.properties->>'state' = $${params.length}`;
    }

    if (show_mine === 'true') {
      params.push(userId);
      filterConditions += ` AND (i.properties->>'assignee_id')::uuid = $${params.length}`;
    } else if (assignee && typeof assignee === 'string') {
      params.push(assignee);
      filterConditions += ` AND (i.properties->>'assignee_id')::uuid = $${params.length}`;
    }

    // Get all issues from all active sprints, grouped by sprint - join via document_associations
    const result = await pool.query<MyWeekIssueRow>(
      `SELECT
        i.id as issue_id, i.title as issue_title, i.properties as issue_properties,
        i.ticket_number, i.created_at as issue_created_at, i.updated_at as issue_updated_at,
        s.id as sprint_id, s.title as sprint_name, s.properties as sprint_properties,
        p.id as program_id, p.title as program_name, p.properties->>'prefix' as program_prefix,
        u.name as assignee_name,
        CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived
       FROM documents i
       JOIN document_associations da ON da.document_id = i.id AND da.relationship_type = 'sprint'
       JOIN documents s ON s.id = da.related_id AND s.document_type = 'sprint'
       LEFT JOIN document_associations prog_da ON prog_da.document_id = s.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       LEFT JOIN users u ON (i.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = i.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = i.properties->>'assignee_id'
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND (s.properties->>'sprint_number')::int = $2
         AND ${VISIBILITY_FILTER_SQL('i', '$3', '$4')}
         AND ${VISIBILITY_FILTER_SQL('s', '$3', '$4')}
         ${filterConditions}
       ORDER BY
         p.title,
         s.title,
         CASE i.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         i.updated_at DESC`,
      params
    );

    // Group issues by sprint/program
    const groupedData: Record<string, {
      sprint: { id: string; name: string; sprint_number: number };
      program: { id: string; name: string; prefix: string } | null;
      issues: MyWeekIssue[];
    }> = {};

    for (const row of result.rows) {
      const sprintKey = row.sprint_id;
      if (!groupedData[sprintKey]) {
        const sprintProps = row.sprint_properties;
        groupedData[sprintKey] = {
          sprint: {
            id: row.sprint_id,
            name: row.sprint_name,
            sprint_number: sprintProps?.sprint_number ?? targetSprintNumber,
          },
          program: row.program_id ? {
            id: row.program_id,
            name: row.program_name || '',
            prefix: row.program_prefix || '',
          } : null,
          issues: [],
        };
      }

      const issueFields = readIssueListFields(row.issue_properties);
      groupedData[sprintKey].issues.push({
        id: row.issue_id,
        title: row.issue_title,
        state: issueFields.state ?? 'backlog',
        priority: issueFields.priority ?? 'medium',
        assignee_id: issueFields.assignee_id ?? null,
        assignee_name: row.assignee_name,
        assignee_archived: row.assignee_archived || false,
        estimate: issueFields.estimate ?? null,
        ticket_number: row.ticket_number,
        display_id: `#${row.ticket_number}`,
        created_at: row.issue_created_at,
        updated_at: row.issue_updated_at,
      });
    }

    // Convert to array
    const groups = Object.values(groupedData);

    // Calculate totals
    const totalIssues = groups.reduce((sum, g) => sum + g.issues.length, 0);
    const completedIssues = groups.reduce((sum, g) =>
      sum + g.issues.filter(i => i.state === 'done').length, 0);
    const inProgressIssues = groups.reduce((sum, g) =>
      sum + g.issues.filter(i => i.state === 'in_progress' || i.state === 'in_review').length, 0);

    res.json({
      groups,
      summary: {
        total_issues: totalIssues,
        completed_issues: completedIssues,
        in_progress_issues: inProgressIssues,
        remaining_issues: totalIssues - completedIssues,
      },
      week: {
        sprint_number: targetSprintNumber,
        current_sprint_number: currentSprintNumber,
        start_date: targetSprintStart.toISOString().split('T')[0],
        end_date: targetSprintEnd.toISOString().split('T')[0],
        days_remaining: daysRemaining,
        is_historical: isHistorical,
      },
    });
  } catch (err) {
    sendInternalError(res, err, 'Get my-week error:');
  }
});

// Get single sprint
// Automatically takes a plan snapshot when sprint becomes active (start_date reached)

export default router;
