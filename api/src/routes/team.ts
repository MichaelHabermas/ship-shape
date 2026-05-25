import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { getActor } from '../services/document-access.js';
import { requireTeamAllocationAuthority } from '../services/governance-auth.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { hasContent } from '../utils/document-content.js';
import { sendInternalError } from '../utils/route-http.js';
import {
  assignTeamMember,
  unassignTeamMember,
} from '../services/team-allocation-service.js';
import {
  buildWorkspaceSprintCalendar,
  sprintNumberFromDate,
  SPRINT_DURATION_DAYS,
} from '../services/team/sprint-calendar.js';

function parseMetricEstimate(estimate: string | number): number {
  if (typeof estimate === 'number') {
    return Number.isFinite(estimate) ? estimate : 0;
  }
  const parsed = parseFloat(estimate);
  return Number.isFinite(parsed) ? parsed : 0;
}
import {
  mapReviewPersonResponse,
  mapReviewSprintMapEntry,
  type AccountabilityGridAssignmentRow,
  type AccountabilityGridPersonRow,
  type AccountabilityGridProgramRow,
  type AccountabilityGridWeeklyDocRow,
  type AccountabilityIssueRow,
  type AccountabilityPersonRow,
  type AssignmentInferenceIssueRow,
  type ExplicitAssignmentRow,
  type IdRow,
  type PersonSprintMetricsIssueRow,
  type PersonUserIdRow,
  type ReviewPersonRow,
  type ReviewSprintMapEntry,
  type ReviewSprintRow,
  type ReviewWeeklyDocRow,
  type TeamGridIssueRow,
  type TeamGridSprintRow,
  type TeamGridUserRow,
  type TeamPersonRow,
  type TeamProgramRow,
  type TeamProjectRow,
  type WorkspaceSprintStartRow,
} from './team/types.js';

const router = Router();

// GET /api/team/grid - Get team grid data
// Query params:
//   fromSprint: number - start of range (default: current - 7)
//   toSprint: number - end of range (default: current + 7)
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

// GET /api/team/assignments - Get user->sprint->project assignments
// Combines: 1) Explicit sprint document assignments (properties.project_id)
//           2) Inferred assignments from issue assignees (fallback)
router.get('/assignments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // First, get explicit sprint document assignments (assignee_ids array + project_id in properties)
    // Program is resolved via: project -> program (preferred), or sprint -> program (fallback for legacy programId assignments)
    const explicitResult = await pool.query<ExplicitAssignmentRow>(
      `SELECT
         jsonb_array_elements_text(s.properties->'assignee_ids') as person_id,
         (s.properties->>'sprint_number')::int as sprint_number,
         proj.id as project_id,
         proj.title as project_name,
         proj.properties->>'color' as project_color,
         COALESCE(prog.id, sprint_prog.id) as program_id,
         COALESCE(prog.title, sprint_prog.title) as program_name,
         COALESCE(prog.properties->>'emoji', sprint_prog.properties->>'emoji') as program_emoji,
         COALESCE(prog.properties->>'color', sprint_prog.properties->>'color') as program_color
       FROM documents s
       LEFT JOIN documents proj ON (s.properties->>'project_id')::uuid = proj.id
         AND proj.workspace_id = s.workspace_id
         AND proj.document_type = 'project'
         AND proj.archived_at IS NULL
         AND proj.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('proj', '$2', '$3')}
       LEFT JOIN document_associations prog_da ON proj.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id AND prog.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('prog', '$2', '$3')}
       LEFT JOIN document_associations sprint_prog_da ON s.id = sprint_prog_da.document_id AND sprint_prog_da.relationship_type = 'program'
       LEFT JOIN documents sprint_prog ON sprint_prog_da.related_id = sprint_prog.id AND sprint_prog.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('sprint_prog', '$2', '$3')}
       WHERE s.workspace_id = $1
         AND s.document_type = 'sprint'
         AND jsonb_array_length(COALESCE(s.properties->'assignee_ids', '[]'::jsonb)) > 0
         AND ${VISIBILITY_FILTER_SQL('s', '$2', '$3')}`,
      [workspaceId, userId, isAdmin]
    );

    // Build assignments map starting with explicit assignments
    const assignments: Record<string, Record<number, {
      projectId: string | null;
      projectName: string | null;
      projectColor: string | null;
      programId: string | null;
      programName: string | null;
      emoji: string | null;
      color: string | null;
    }>> = {};

    for (const row of explicitResult.rows) {
      const personId = row.person_id;
      const sprintNumber = row.sprint_number;
      if (!personId || !sprintNumber) continue;

      if (!assignments[personId]) {
        assignments[personId] = {};
      }
      assignments[personId][sprintNumber] = {
        projectId: row.project_id,
        projectName: row.project_name,
        projectColor: row.project_color,
        programId: row.program_id,
        programName: row.program_name,
        emoji: row.program_emoji,
        color: row.program_color,
      };
    }

    // Get workspace sprint configuration for issue-based inference
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const { startDate } = buildWorkspaceSprintCalendar(workspaceResult.rows[0]?.sprint_start_date);

    // Get all issues with assignees, projects, and sprint info for inferred assignments
    const issuesResult = await pool.query<AssignmentInferenceIssueRow>(
      `SELECT
         i.properties->>'assignee_id' as assignee_id,
         proj.id as project_id,
         proj.title as project_name,
         proj.properties->>'color' as project_color,
         prog.id as program_id,
         prog.title as program_name,
         prog.properties->>'emoji' as program_emoji,
         prog.properties->>'color' as program_color,
         s.properties->>'start_date' as sprint_start
       FROM documents i
       JOIN document_associations da_sprint ON da_sprint.document_id = i.id AND da_sprint.relationship_type = 'sprint'
       JOIN documents s ON s.id = da_sprint.related_id
       JOIN document_associations da_project ON da_project.document_id = i.id AND da_project.relationship_type = 'project'
       LEFT JOIN documents proj ON proj.id = da_project.related_id
         AND proj.workspace_id = i.workspace_id
         AND proj.document_type = 'project'
         AND proj.archived_at IS NULL
         AND proj.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('proj', '$2', '$3')}
       LEFT JOIN document_associations proj_prog_da ON proj.id = proj_prog_da.document_id AND proj_prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON proj_prog_da.related_id = prog.id AND prog.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('prog', '$2', '$3')}
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.properties->>'assignee_id' IS NOT NULL
         AND ${VISIBILITY_FILTER_SQL('i', '$2', '$3')}`,
      [workspaceId, userId, isAdmin]
    );

    // Build inferred assignments: pick project with most issues per person+sprint
    const projectCounts: Record<string, Record<number, Record<string, {
      count: number;
      projectId: string;
      projectName: string;
      projectColor: string | null;
      programId: string | null;
      programName: string | null;
      programEmoji: string | null;
      programColor: string | null;
    }>>> = {};

    for (const issue of issuesResult.rows) {
      const personId = issue.assignee_id;
      const sprintStart = new Date(issue.sprint_start + 'T00:00:00Z');
      const sprintNumber = sprintNumberFromDate(sprintStart, startDate, SPRINT_DURATION_DAYS);
      const projectId = issue.project_id;

      if (!personId || !projectId) continue;

      // Skip if we already have an explicit assignment for this person+sprint
      if (assignments[personId]?.[sprintNumber]) continue;

      if (!projectCounts[personId]) {
        projectCounts[personId] = {};
      }
      if (!projectCounts[personId][sprintNumber]) {
        projectCounts[personId][sprintNumber] = {};
      }
      if (!projectCounts[personId][sprintNumber][projectId]) {
        projectCounts[personId][sprintNumber][projectId] = {
          count: 0,
          projectId,
          projectName: issue.project_name,
          projectColor: issue.project_color,
          programId: issue.program_id,
          programName: issue.program_name,
          programEmoji: issue.program_emoji,
          programColor: issue.program_color,
        };
      }
      projectCounts[personId][sprintNumber][projectId].count++;
    }

    // Add inferred assignments (only for person+sprint combos without explicit assignments)
    for (const [personId, sprints] of Object.entries(projectCounts)) {
      if (!assignments[personId]) {
        assignments[personId] = {};
      }
      for (const [sprintNumStr, projects] of Object.entries(sprints)) {
        const sprintNum = parseInt(sprintNumStr, 10);
        // Skip if explicit assignment exists
        if (assignments[personId][sprintNum]) continue;

        // Find project with most issues
        let maxCount = 0;
        let primaryProject: typeof projects[string] | null = null;
        for (const proj of Object.values(projects)) {
          if (proj.count > maxCount) {
            maxCount = proj.count;
            primaryProject = proj;
          }
        }
        if (primaryProject) {
          assignments[personId][sprintNum] = {
            projectId: primaryProject.projectId,
            projectName: primaryProject.projectName,
            projectColor: primaryProject.projectColor,
            programId: primaryProject.programId,
            programName: primaryProject.programName,
            emoji: primaryProject.programEmoji,
            color: primaryProject.programColor,
          };
        }
      }
    }

    res.json(assignments);
  } catch (err) {
    sendInternalError(res, err, 'Get assignments error:');
  }
});

// POST /api/team/assign - Assign user as sprint owner for a program
// Accepts personId (person document ID) - preferred for pending users
// Falls back to userId for backward compatibility
router.post('/assign', authMiddleware, async (req: Request, res: Response) => {
  try {
    const actor = getActor(req);
    const auth = await requireTeamAllocationAuthority(actor);
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const { workspaceId } = getAuthenticatedRouteContext(req);
    const { personId, userId, projectId, programId, sprintNumber } = req.body;

    const result = await assignTeamMember({
      workspaceId,
      personId,
      userId,
      projectId,
      programId,
      sprintNumber,
    });

    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }

    res.status(result.status).json(result.body);
  } catch (err) {
    sendInternalError(res, err, 'Assign error:');
  }
});

// DELETE /api/team/assign - Remove user as sprint owner
// Accepts personId (person document ID) - preferred
// Falls back to userId for backward compatibility
router.delete('/assign', authMiddleware, async (req: Request, res: Response) => {
  try {
    const actor = getActor(req);
    const auth = await requireTeamAllocationAuthority(actor);
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const { userId: currentUserId, workspaceId } = getAuthenticatedRouteContext(req);
    const { personId, userId, sprintNumber } = req.body;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(currentUserId, workspaceId);

    const result = await unassignTeamMember({
      workspaceId,
      currentUserId,
      isAdmin,
      personId,
      userId,
      sprintNumber,
    });

    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }

    res.status(result.status).json(result.body);
  } catch (err) {
    sendInternalError(res, err, 'Unassign error:');
  }
});

// GET /api/team/people - Get all people (person documents)
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

// GET /api/team/accountability - Get sprint completion metrics per person (admin only)
// Returns: { people, sprints, metrics } where metrics[userId][sprintNumber] = { committed, completed }
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

// GET /api/team/people/:personId/sprint-metrics - Get sprint completion metrics for a specific person
// Only visible to the person themselves or workspace admins
router.get('/people/:personId/sprint-metrics', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { personId } = req.params;

    // Get the person document to find the user_id
    const personResult = await pool.query<PersonUserIdRow>(
      `SELECT properties->>'user_id' as user_id
       FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
      [personId, workspaceId]
    );

    if (!personResult.rows[0]) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    const targetUserId = personResult.rows[0].user_id;

    // Check if user can view this person's metrics (self or admin)
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    const isSelf = userId === targetUserId;

    if (!isAdmin && !isSelf) {
      res.status(403).json({ error: 'Access denied' });
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

// GET /api/team/reviews - Manager review grid (approval status + performance ratings)
// Returns: { people, weeks, reviews, currentSprintNumber }
router.get('/reviews', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const sprintCount = Math.min(parseInt(req.query.sprint_count as string, 10) || 5, 20);
    const showArchived = req.query.showArchived === 'true';

    // Check admin access
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    // Get workspace sprint config
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const { sprints: weeks, currentSprintNumber } = buildWorkspaceSprintCalendar(
      workspaceResult.rows[0]?.sprint_start_date,
      { trailingSprintCount: sprintCount }
    );
    const fromSprint = weeks[0]?.number ?? 1;
    const toSprint = weeks[weeks.length - 1]?.number ?? fromSprint;

    // Get all workspace people (include reports_to for My Team filter)
    const peopleResult = await pool.query<ReviewPersonRow>(
      `SELECT id, title as name, properties->>'reports_to' as "reportsTo"
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'person'
         AND ($2 OR archived_at IS NULL)
       ORDER BY title`,
      [workspaceId, showArchived]
    );

    // Get sprint documents with approval/rating properties
    const sprintsResult = await pool.query<ReviewSprintRow>(
      `SELECT
         jsonb_array_elements_text(s.properties->'assignee_ids') as person_id,
         (s.properties->>'sprint_number')::int as sprint_number,
         s.id as sprint_id,
         s.properties->>'project_id' as project_id,
         s.properties->'plan_approval' as plan_approval,
         s.properties->'review_approval' as review_approval,
         s.properties->'review_rating' as review_rating,
         proj.title as project_name,
         prog_da.related_id as program_id,
         prog.title as program_name,
         prog.properties->>'color' as program_color
       FROM documents s
       LEFT JOIN documents proj ON (s.properties->>'project_id')::uuid = proj.id
       LEFT JOIN document_associations prog_da ON proj.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id AND prog.document_type = 'program'
       WHERE s.workspace_id = $1
         AND s.document_type = 'sprint'
         AND jsonb_array_length(COALESCE(s.properties->'assignee_ids', '[]'::jsonb)) > 0
         AND (s.properties->>'sprint_number')::int BETWEEN $2 AND $3`,
      [workspaceId, fromSprint, toSprint]
    );

    // Get weekly plans (to check content existence)
    const plansResult = await pool.query<ReviewWeeklyDocRow>(
      `SELECT
         (properties->>'person_id') as person_id,
         (properties->>'week_number')::int as week_number,
         id, content
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_plan'
         AND deleted_at IS NULL
         AND (properties->>'week_number')::int BETWEEN $2 AND $3`,
      [workspaceId, fromSprint, toSprint]
    );

    // Get weekly retros (to check content existence)
    const retrosResult = await pool.query<ReviewWeeklyDocRow>(
      `SELECT
         (properties->>'person_id') as person_id,
         (properties->>'week_number')::int as week_number,
         id, content
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_retro'
         AND deleted_at IS NULL
         AND (properties->>'week_number')::int BETWEEN $2 AND $3`,
      [workspaceId, fromSprint, toSprint]
    );

    // Build plan/retro content maps: personId_weekNumber -> { hasContent, docId }
    const planContent = new Map<string, { hasContent: boolean; docId: string }>();
    for (const row of plansResult.rows) {
      if (row.person_id && row.week_number) {
        const key = `${row.person_id}_${row.week_number}`;
        const existing = planContent.get(key);
        if (!existing || hasContent(row.content)) {
          planContent.set(key, { hasContent: hasContent(row.content), docId: row.id });
        }
      }
    }

    const retroContent = new Map<string, { hasContent: boolean; docId: string }>();
    for (const row of retrosResult.rows) {
      if (row.person_id && row.week_number) {
        const key = `${row.person_id}_${row.week_number}`;
        const existing = retroContent.get(key);
        if (!existing || hasContent(row.content)) {
          retroContent.set(key, { hasContent: hasContent(row.content), docId: row.id });
        }
      }
    }

    // Build sprint approval map: personId_sprintNumber -> { sprintId, planApproval, reviewApproval, reviewRating, programId, programName }
    const sprintMap = new Map<string, ReviewSprintMapEntry>();

    for (const row of sprintsResult.rows) {
      const mapped = mapReviewSprintMapEntry(row);
      if (mapped) {
        sprintMap.set(mapped.key, mapped.entry);
      }
    }

    // Build people list with program info from current sprint
    const people = peopleResult.rows.map((person) =>
      mapReviewPersonResponse(person, currentSprintNumber, sprintMap),
    );

    // Build reviews map: personId -> sprintNumber -> cell data
    const reviews: Record<string, Record<number, {
      planApproval: unknown;
      reviewApproval: unknown;
      reviewRating: unknown;
      hasPlan: boolean;
      hasRetro: boolean;
      sprintId: string | null;
      planDocId: string | null;
      retroDocId: string | null;
    }>> = {};

    for (const person of peopleResult.rows) {
      const personReviews: Record<number, {
        planApproval: unknown;
        reviewApproval: unknown;
        reviewRating: unknown;
        hasPlan: boolean;
        hasRetro: boolean;
        sprintId: string | null;
        planDocId: string | null;
        retroDocId: string | null;
      }> = {};
      for (const week of weeks) {
        const key = `${person.id}_${week.number}`;
        const sprint = sprintMap.get(key);
        const contentKey = `${person.id}_${week.number}`;
        const plan = planContent.get(contentKey);
        const retro = retroContent.get(contentKey);

        personReviews[week.number] = {
          planApproval: sprint?.planApproval || null,
          reviewApproval: sprint?.reviewApproval || null,
          reviewRating: sprint?.reviewRating || null,
          hasPlan: plan?.hasContent || false,
          hasRetro: retro?.hasContent || false,
          sprintId: sprint?.sprintId || null,
          planDocId: plan?.docId || null,
          retroDocId: retro?.docId || null,
        };
      }
      reviews[person.id] = personReviews;
    }

    res.json({
      people,
      weeks,
      reviews,
      currentSprintNumber,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get team reviews error:');
  }
});

// GET /api/team/accountability-grid-v3 - Person-centric plan/retro status (like Allocation view)
// Returns: { programs: [{ people: [{ weeks }] }], weeks, currentSprintNumber }
// Groups people by their current week's allocation's program
// Each person's week shows plan/retro status for their allocated project
router.get('/accountability-grid-v3', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const showArchived = req.query.showArchived === 'true';

    // Check if user is admin
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    // Get workspace sprint config
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const { sprints: weeks, startDate: sprintStartDate, currentSprintNumber } = buildWorkspaceSprintCalendar(
      workspaceResult.rows[0]?.sprint_start_date,
      { rangeDefaults: { back: 6, forward: 2 } }
    );
    const fromSprint = weeks[0]?.number ?? 1;
    const toSprint = weeks[weeks.length - 1]?.number ?? fromSprint;

    // Get all workspace people
    const peopleResult = await pool.query<AccountabilityGridPersonRow>(
      `SELECT id, title as name
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'person'
         AND ($2 OR archived_at IS NULL)
       ORDER BY title`,
      [workspaceId, showArchived]
    );

    // Get all programs
    const programsResult = await pool.query<AccountabilityGridProgramRow>(
      `SELECT id, title as name, properties->>'color' as color
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'program'
         AND archived_at IS NULL
       ORDER BY title`,
      [workspaceId]
    );

    // Get explicit sprint assignments (person -> sprint -> project)
    const explicitAssignmentsResult = await pool.query<AccountabilityGridAssignmentRow>(
      `SELECT
         jsonb_array_elements_text(s.properties->'assignee_ids') as person_id,
         (s.properties->>'sprint_number')::int as sprint_number,
         s.properties->>'project_id' as project_id,
         s.properties->'plan_approval'->>'state' as plan_approval_state,
         s.properties->'review_approval'->>'state' as review_approval_state,
         proj.title as project_name,
         proj.properties->>'color' as project_color,
         prog_da.related_id as program_id,
         prog.title as program_name,
         prog.properties->>'color' as program_color
       FROM documents s
       LEFT JOIN documents proj ON (s.properties->>'project_id')::uuid = proj.id
       LEFT JOIN document_associations prog_da ON proj.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id AND prog.document_type = 'program'
       WHERE s.workspace_id = $1
         AND s.document_type = 'sprint'
         AND jsonb_array_length(COALESCE(s.properties->'assignee_ids', '[]'::jsonb)) > 0`,
      [workspaceId]
    );

    // Build assignments map: personId -> sprintNumber -> assignment
    const assignments: Record<string, Record<number, {
      projectId: string | null;
      projectName: string | null;
      projectColor: string | null;
      programId: string | null;
      programName: string | null;
      programColor: string | null;
      planApprovalState: string | null;
      reviewApprovalState: string | null;
    }>> = {};

    for (const row of explicitAssignmentsResult.rows) {
      const personId = row.person_id;
      const sprintNumber = row.sprint_number;
      if (!personId || !sprintNumber) continue;

      if (!assignments[personId]) {
        assignments[personId] = {};
      }
      assignments[personId][sprintNumber] = {
        projectId: row.project_id,
        projectName: row.project_name,
        projectColor: row.project_color,
        programId: row.program_id,
        programName: row.program_name,
        programColor: row.program_color,
        planApprovalState: row.plan_approval_state || null,
        reviewApprovalState: row.review_approval_state || null,
      };
    }

    // Infer assignments from issues (fallback for people without explicit assignments)
    const issuesResult = await pool.query<AssignmentInferenceIssueRow>(
      `SELECT
         i.properties->>'assignee_id' as assignee_id,
         da_project.related_id as project_id,
         proj.title as project_name,
         proj.properties->>'color' as project_color,
         proj_prog_da.related_id as program_id,
         prog.title as program_name,
         prog.properties->>'color' as program_color,
         s.properties->>'start_date' as sprint_start
       FROM documents i
       JOIN document_associations da_sprint ON da_sprint.document_id = i.id AND da_sprint.relationship_type = 'sprint'
       JOIN documents s ON s.id = da_sprint.related_id
       JOIN document_associations da_project ON da_project.document_id = i.id AND da_project.relationship_type = 'project'
       JOIN documents proj ON proj.id = da_project.related_id
       LEFT JOIN document_associations proj_prog_da ON proj.id = proj_prog_da.document_id AND proj_prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON proj_prog_da.related_id = prog.id AND prog.document_type = 'program'
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.properties->>'assignee_id' IS NOT NULL`,
      [workspaceId]
    );

    // Count issues per person+sprint+project to infer primary project
    const projectCounts: Record<string, Record<number, Record<string, {
      count: number;
      projectId: string;
      projectName: string;
      projectColor: string | null;
      programId: string | null;
      programName: string | null;
      programColor: string | null;
    }>>> = {};

    for (const issue of issuesResult.rows) {
      const personId = issue.assignee_id;
      const sprintStart = new Date(issue.sprint_start + 'T00:00:00Z');
      const sprintNumber = sprintNumberFromDate(sprintStart, sprintStartDate, SPRINT_DURATION_DAYS);
      const projectId = issue.project_id;

      if (!personId || !projectId) continue;
      if (assignments[personId]?.[sprintNumber]) continue; // Skip if explicit assignment exists

      if (!projectCounts[personId]) projectCounts[personId] = {};
      if (!projectCounts[personId][sprintNumber]) projectCounts[personId][sprintNumber] = {};
      if (!projectCounts[personId][sprintNumber][projectId]) {
        projectCounts[personId][sprintNumber][projectId] = {
          count: 0,
          projectId,
          projectName: issue.project_name,
          projectColor: issue.project_color,
          programId: issue.program_id,
          programName: issue.program_name,
          programColor: issue.program_color,
        };
      }
      projectCounts[personId][sprintNumber][projectId].count++;
    }

    // Add inferred assignments
    for (const [personId, sprints] of Object.entries(projectCounts)) {
      if (!assignments[personId]) assignments[personId] = {};
      for (const [sprintNumStr, projects] of Object.entries(sprints)) {
        const sprintNum = parseInt(sprintNumStr, 10);
        if (assignments[personId][sprintNum]) continue;

        let maxCount = 0;
        let primaryProject: (typeof projects)[string] | null = null;
        for (const proj of Object.values(projects)) {
          if (proj.count > maxCount) {
            maxCount = proj.count;
            primaryProject = proj;
          }
        }
        if (primaryProject) {
          assignments[personId][sprintNum] = {
            projectId: primaryProject.projectId,
            projectName: primaryProject.projectName,
            projectColor: primaryProject.projectColor,
            programId: primaryProject.programId,
            programName: primaryProject.programName,
            programColor: primaryProject.programColor,
            planApprovalState: null,
            reviewApprovalState: null,
          };
        }
      }
    }

    // Get ALL weekly plans in the workspace for the week range
    const plansResult = await pool.query<AccountabilityGridWeeklyDocRow>(
      `SELECT
         (properties->>'person_id') as person_id,
         (properties->>'project_id') as project_id,
         (properties->>'week_number')::int as week_number,
         id,
         content
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_plan'
         AND deleted_at IS NULL
         AND (properties->>'week_number')::int BETWEEN $2 AND $3`,
      [workspaceId, fromSprint, toSprint]
    );

    // Get ALL weekly retros in the workspace for the week range
    const retrosResult = await pool.query<AccountabilityGridWeeklyDocRow>(
      `SELECT
         (properties->>'person_id') as person_id,
         (properties->>'project_id') as project_id,
         (properties->>'week_number')::int as week_number,
         id,
         content
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_retro'
         AND deleted_at IS NULL
         AND (properties->>'week_number')::int BETWEEN $2 AND $3`,
      [workspaceId, fromSprint, toSprint]
    );

    const calculateStatus = (
      docId: string | null,
      docContent: unknown,
      weekStartDate: Date,
      type: 'plan' | 'retro',
      approvalState: string | null
    ): 'done' | 'due' | 'late' | 'future' | 'changes_requested' => {
      if (approvalState === 'changes_requested') return 'changes_requested';
      if (docId && hasContent(docContent)) return 'done';

      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);

      if (type === 'plan') {
        // Plan: yellow (due) from Saturday (weekStart - 2) through end-of-day Monday
        // Red (late) from Tuesday morning (weekStart + 1) onward
        const yellowStart = new Date(weekStartDate);
        yellowStart.setUTCDate(yellowStart.getUTCDate() - 2);
        const redStart = new Date(weekStartDate);
        redStart.setUTCDate(redStart.getUTCDate() + 1);
        if (now < yellowStart) return 'future';
        if (now >= redStart) return 'late';
        return 'due';
      } else {
        // Retro: yellow (due) from Thursday (weekStart + 3) through end-of-day Friday
        // Red (late) from Saturday morning (weekStart + 5) onward
        const yellowStart = new Date(weekStartDate);
        yellowStart.setUTCDate(yellowStart.getUTCDate() + 3);
        const redStart = new Date(weekStartDate);
        redStart.setUTCDate(redStart.getUTCDate() + 5);
        if (now < yellowStart) return 'future';
        if (now >= redStart) return 'late';
        return 'due';
      }
    };

    // Build plan/retro maps: `${projectId}_${personId}_${weekNumber}` -> { id, content }
    const plans = new Map<string, { id: string; content: unknown }>();
    for (const row of plansResult.rows) {
      plans.set(`${row.project_id}_${row.person_id}_${row.week_number}`, { id: row.id, content: row.content });
    }

    const retros = new Map<string, { id: string; content: unknown }>();
    for (const row of retrosResult.rows) {
      retros.set(`${row.project_id}_${row.person_id}_${row.week_number}`, { id: row.id, content: row.content });
    }

    // Build person data: for each week, get their allocation and corresponding plan/retro status
    const buildPersonWeeks = (personId: string) => {
      return Object.fromEntries(
        weeks.map(week => {
          const allocation = assignments[personId]?.[week.number];
          const projectId = allocation?.projectId;

          // Get plan/retro for this person's allocated project
          const planData = projectId ? plans.get(`${projectId}_${personId}_${week.number}`) : null;
          const retroData = projectId ? retros.get(`${projectId}_${personId}_${week.number}`) : null;
          const weekStartDate = new Date(week.startDate);
          const planApprovalState = allocation?.planApprovalState || null;
          const reviewApprovalState = allocation?.reviewApprovalState || null;

          return [
            week.number,
            {
              projectId: projectId || null,
              projectName: allocation?.projectName || null,
              projectColor: allocation?.projectColor || null,
              planId: planData?.id || null,
              planStatus: projectId ? calculateStatus(planData?.id || null, planData?.content, weekStartDate, 'plan', planApprovalState) : null,
              retroId: retroData?.id || null,
              retroStatus: projectId ? calculateStatus(retroData?.id || null, retroData?.content, weekStartDate, 'retro', reviewApprovalState) : null,
            },
          ];
        })
      );
    };

    // Group people by their current week's allocation's program
    const programGroups = new Map<string, {
      id: string;
      name: string;
      color: string;
      people: Array<{ id: string; name: string; weeks: Record<number, unknown> }>;
    }>();

    // Initialize all programs
    for (const prog of programsResult.rows) {
      programGroups.set(prog.id, {
        id: prog.id,
        name: prog.name,
        color: prog.color || '#6b7280',
        people: [],
      });
    }

    // Add "No Program" group
    programGroups.set('unassigned', {
      id: 'unassigned',
      name: 'No Program',
      color: '#6b7280',
      people: [],
    });

    // Assign each person to a program based on current week's allocation
    for (const person of peopleResult.rows) {
      const currentAllocation = assignments[person.id]?.[currentSprintNumber];
      const programId = currentAllocation?.programId || 'unassigned';

      const personData = {
        id: person.id,
        name: person.name,
        weeks: buildPersonWeeks(person.id),
      };

      const group = programGroups.get(programId);
      if (group) {
        group.people.push(personData);
      } else {
        // Program doesn't exist (maybe archived), add to unassigned
        const unassignedGroup = programGroups.get('unassigned');
        if (!unassignedGroup) {
          throw new Error('Unassigned program group was not initialized');
        }
        unassignedGroup.people.push(personData);
      }
    }

    // Filter out empty programs and convert to array
    const programs = Array.from(programGroups.values()).filter(p => p.people.length > 0);

    res.json({
      programs,
      weeks,
      currentSprintNumber,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get accountability grid v3 error:');
  }
});


export default router;
