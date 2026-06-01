import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError } from '../../utils/route-http.js';
import {
  buildWorkspaceSprintCalendar,
  sprintNumberFromDate,
  SPRINT_DURATION_DAYS,
} from '../../services/team/sprint-calendar.js';
import type {
  TeamGridIssueRow,
  TeamGridSprintRow,
  TeamGridUserRow,
  TeamProgramRow,
  TeamProjectRow,
  WorkspaceSprintStartRow,
} from './types.js';

const router = Router();
router.get('/grid', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Parse includeArchived query param
    const includeArchived = req.query.includeArchived === 'true';

    // Get all people in workspace via person documents (only visible ones)
    // Include pending users so they appear in the grid
    // personId is the document ID (used for allocations), id is the user_id (null for pending users)
    const usersResult = await pool.query<TeamGridUserRow>(
      `SELECT
         d.id as "personId",
         d.properties->>'user_id' as id,
         d.title as name,
         COALESCE(d.properties->>'email', u.email) as email,
         CASE WHEN d.archived_at IS NOT NULL THEN true ELSE false END as "isArchived",
         CASE WHEN d.properties->>'pending' = 'true' THEN true ELSE false END as "isPending",
         d.properties->>'reports_to' as "reportsTo"
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND ($4 OR d.archived_at IS NULL)
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY d.archived_at NULLS FIRST, d.title`,
      [workspaceId, userId, isAdmin, includeArchived]
    );

    // Get workspace sprint start date
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const today = new Date();
    const { startDate, sprints, currentSprintNumber } = buildWorkspaceSprintCalendar(workspaceResult.rows[0]?.sprint_start_date, {
      query: {
        fromSprint: req.query.fromSprint as string | undefined,
        toSprint: req.query.toSprint as string | undefined,
      },
      today,
    });

    // Get all sprints from database that fall within our date range
    const minDate = sprints[0]?.startDate || today.toISOString().slice(0, 10);
    const maxDate = sprints[sprints.length - 1]?.endDate || today.toISOString().slice(0, 10);

    await pool.query<TeamGridSprintRow>(
      `SELECT d.id, d.title as name, d.properties->>'start_date' as start_date, d.properties->>'end_date' as end_date,
              p.id as program_id,
              p.title as program_name, p.properties->>'emoji' as program_emoji, p.properties->>'color' as program_color
       FROM documents d
       LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('p', '$4', '$5')}
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND (d.properties->>'start_date')::date >= $2 AND (d.properties->>'end_date')::date <= $3
         AND ${VISIBILITY_FILTER_SQL('d', '$4', '$5')}`,
      [workspaceId, minDate, maxDate, userId, isAdmin]
    );

    // Get issues with sprint and assignee info (only visible issues)
    const issuesResult = await pool.query<TeamGridIssueRow>(
      `SELECT i.id, i.title, da_sprint.related_id as sprint_id, i.properties->>'assignee_id' as assignee_id, i.properties->>'state' as state, i.ticket_number,
              s.properties->>'start_date' as sprint_start, s.properties->>'end_date' as sprint_end,
              p.id as program_id, p.title as program_name, p.properties->>'emoji' as program_emoji, p.properties->>'color' as program_color
       FROM documents i
       JOIN document_associations da_sprint ON da_sprint.document_id = i.id AND da_sprint.relationship_type = 'sprint'
       JOIN documents s ON s.id = da_sprint.related_id
       LEFT JOIN document_associations prog_da ON i.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('p', '$2', '$3')}
       WHERE i.workspace_id = $1 AND i.document_type = 'issue' AND i.properties->>'assignee_id' IS NOT NULL
         AND ${VISIBILITY_FILTER_SQL('i', '$2', '$3')}`,
      [workspaceId, userId, isAdmin]
    );

    // Build associations: user_id -> sprint_number -> { programs: [...], issues: [...] }
    const associations: Record<string, Record<number, {
      programs: Array<{ id: string; name: string; emoji?: string | null; color: string; issueCount: number }>;
      issues: Array<{ id: string; title: string; displayId: string; state: string }>;
    }>> = {};

    for (const issue of issuesResult.rows) {
      const userId = issue.assignee_id;
      const sprintStart = new Date(issue.sprint_start + 'T00:00:00Z');
      const sprintNumber = sprintNumberFromDate(sprintStart, startDate, SPRINT_DURATION_DAYS);

      // Skip if outside our range
      if (!sprints.find(s => s.number === sprintNumber)) continue;

      if (!associations[userId]) {
        associations[userId] = {};
      }
      if (!associations[userId][sprintNumber]) {
        associations[userId][sprintNumber] = { programs: [], issues: [] };
      }

      const cell = associations[userId][sprintNumber];

      // Add issue
      cell.issues.push({
        id: issue.id,
        title: issue.title,
        displayId: `#${issue.ticket_number}`,
        state: issue.state ?? '',
      });

      // Add program if not already there
      if (issue.program_id) {
        const existingProgram = cell.programs.find(p => p.id === issue.program_id);
        if (existingProgram) {
          existingProgram.issueCount++;
        } else {
          cell.programs.push({
            id: issue.program_id,
            name: issue.program_name ?? '',
            emoji: issue.program_emoji ?? null,
            color: issue.program_color ?? '',
            issueCount: 1,
          });
        }
      }
    }

    res.json({
      users: usersResult.rows,
      weeks: sprints,
      associations,
      currentSprintNumber,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get team grid error:');
  }
});

// GET /api/team/projects - Get all projects with their parent program info
// Returns projects that can be assigned to team members in the assignments grid
router.get('/projects', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get all projects with their parent program info
    // Projects without a program will have null programId
    const result = await pool.query<TeamProjectRow>(
      `SELECT
         proj.id,
         proj.title,
         proj.properties->>'color' as "color",
         prog.id as "programId",
         prog.title as "programName",
         prog.properties->>'emoji' as "programEmoji",
         prog.properties->>'color' as "programColor"
       FROM documents proj
       LEFT JOIN document_associations prog_da ON proj.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id
         AND prog.workspace_id = proj.workspace_id
         AND prog.document_type = 'program'
         AND prog.archived_at IS NULL
         AND prog.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('prog', '$2', '$3')}
       WHERE proj.workspace_id = $1
         AND proj.document_type = 'project'
         AND proj.archived_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('proj', '$2', '$3')}
       ORDER BY prog.title NULLS LAST, proj.title`,
      [workspaceId, userId, isAdmin]
    );

    res.json(result.rows);
  } catch (err) {
    sendInternalError(res, err, 'Get projects error:');
  }
});

// GET /api/team/programs - Get all programs
router.get('/programs', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query<TeamProgramRow>(
      `SELECT id, title as name, properties->>'emoji' as emoji, properties->>'color' as color
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('documents', '$2', '$3')}
       ORDER BY title`,
      [workspaceId, userId, isAdmin]
    );

    res.json(result.rows);
  } catch (err) {
    sendInternalError(res, err, 'Get programs error:');
  }
});
export default router;
