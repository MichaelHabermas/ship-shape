import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { hasContent } from '../utils/document-content.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';

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
  type EmptyRow,
  type ExplicitAssignmentRow,
  type IdRow,
  type PersonSprintMetricsIssueRow,
  type PersonUserIdRow,
  type ProjectWithProgramRow,
  type ReviewPersonRow,
  type ReviewSprintMapEntry,
  type ReviewSprintRow,
  type ReviewWeeklyDocRow,
  type SprintDocumentRow,
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

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7; // 1-week sprints

    const today = new Date();

    // Normalize sprint start date to midnight UTC to avoid timezone issues
    // pg driver may return DATE as a Date object with local timezone offset
    let startDate: Date;
    if (rawSprintStartDate instanceof Date) {
      // Extract just the date parts and create a UTC midnight date
      startDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      // Parse string as UTC midnight
      startDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      // Fallback to today
      startDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Calculate which sprint number we're in
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Parse query params for sprint range (default: ~quarter each way)
    const defaultBack = 7;
    const defaultForward = 7;
    const fromSprint = req.query.fromSprint
      ? Math.max(1, parseInt(req.query.fromSprint as string, 10))
      : Math.max(1, currentSprintNumber - defaultBack);
    const toSprint = req.query.toSprint
      ? parseInt(req.query.toSprint as string, 10)
      : currentSprintNumber + defaultForward;

    // Generate sprint periods for requested range
    const sprints = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const sprintStart = new Date(startDate);
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (i - 1) * sprintDurationDays);

      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDurationDays - 1);

      sprints.push({
        number: i,
        name: `Week ${i}`,
        startDate: sprintStart.toISOString().split('T')[0],
        endDate: sprintEnd.toISOString().split('T')[0],
        isCurrent: i === currentSprintNumber,
      });
    }

    // Get all sprints from database that fall within our date range
    const minDate = sprints[0]?.startDate || today.toISOString().split('T')[0];
    const maxDate = sprints[sprints.length - 1]?.endDate || today.toISOString().split('T')[0];

    await pool.query<TeamGridSprintRow>(
      `SELECT d.id, d.title as name, d.properties->>'start_date' as start_date, d.properties->>'end_date' as end_date,
              prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'emoji' as program_emoji, p.properties->>'color' as program_color
       FROM documents d
       LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND (d.properties->>'start_date')::date >= $2 AND (d.properties->>'end_date')::date <= $3
         AND ${VISIBILITY_FILTER_SQL('d', '$4', '$5')}`,
      [workspaceId, minDate, maxDate, userId, isAdmin]
    );

    // Get issues with sprint and assignee info (only visible issues)
    const issuesResult = await pool.query<TeamGridIssueRow>(
      `SELECT i.id, i.title, da_sprint.related_id as sprint_id, i.properties->>'assignee_id' as assignee_id, i.properties->>'state' as state, i.ticket_number,
              s.properties->>'start_date' as sprint_start, s.properties->>'end_date' as sprint_end,
              prog_da.related_id as program_id, p.title as program_name, p.properties->>'emoji' as program_emoji, p.properties->>'color' as program_color
       FROM documents i
       JOIN document_associations da_sprint ON da_sprint.document_id = i.id AND da_sprint.relationship_type = 'sprint'
       JOIN documents s ON s.id = da_sprint.related_id
       LEFT JOIN document_associations prog_da ON i.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
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
      // Parse issue's sprint start date as UTC midnight to match startDate
      const sprintStart = new Date(issue.sprint_start + 'T00:00:00Z');

      // Calculate which sprint number this issue belongs to
      const daysSinceStart = Math.floor((sprintStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const sprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

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
         prog_da.related_id as "programId",
         prog.title as "programName",
         prog.properties->>'emoji' as "programEmoji",
         prog.properties->>'color' as "programColor"
       FROM documents proj
       LEFT JOIN document_associations prog_da ON proj.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id AND prog.document_type = 'program'
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
         s.properties->>'project_id' as project_id,
         proj.title as project_name,
         proj.properties->>'color' as project_color,
         COALESCE(prog_da.related_id, sprint_prog_da.related_id) as program_id,
         COALESCE(prog.title, sprint_prog.title) as program_name,
         COALESCE(prog.properties->>'emoji', sprint_prog.properties->>'emoji') as program_emoji,
         COALESCE(prog.properties->>'color', sprint_prog.properties->>'color') as program_color
       FROM documents s
       LEFT JOIN documents proj ON (s.properties->>'project_id')::uuid = proj.id
       LEFT JOIN document_associations prog_da ON proj.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog ON prog_da.related_id = prog.id AND prog.document_type = 'program'
       LEFT JOIN document_associations sprint_prog_da ON s.id = sprint_prog_da.document_id AND sprint_prog_da.relationship_type = 'program'
       LEFT JOIN documents sprint_prog ON sprint_prog_da.related_id = sprint_prog.id AND sprint_prog.document_type = 'program'
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

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7;
    const today = new Date();

    let startDate: Date;
    if (rawSprintStartDate instanceof Date) {
      startDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      startDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      startDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Get all issues with assignees, projects, and sprint info for inferred assignments
    const issuesResult = await pool.query<AssignmentInferenceIssueRow>(
      `SELECT
         i.properties->>'assignee_id' as assignee_id,
         da_project.related_id as project_id,
         proj.title as project_name,
         proj.properties->>'color' as project_color,
         proj_prog_da.related_id as program_id,
         prog.title as program_name,
         prog.properties->>'emoji' as program_emoji,
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
      const daysSinceStart = Math.floor((sprintStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const sprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);
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
    const { workspaceId } = getAuthenticatedRouteContext(req);
    // Support both projectId (new) and programId (legacy)
    const { personId, userId, projectId, programId, sprintNumber } = req.body;

    // personId is preferred (works for both pending and active users)
    // userId is for backward compatibility
    const ownerId = personId || userId;
    // Support projectId (new) or programId (legacy)
    const assignmentId = projectId || programId;
    const isProjectAssignment = !!projectId;

    if (!ownerId || !assignmentId || !sprintNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Validate personId belongs to current workspace (SECURITY: prevent cross-workspace injection)
    let personDocId = personId;
    if (personId) {
      const personCheck = await pool.query<IdRow>(
        `SELECT id FROM documents
         WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
        [personId, workspaceId]
      );
      if (!personCheck.rows[0]) {
        res.status(400).json({ error: 'Invalid personId for this workspace' });
        return;
      }
    } else if (userId) {
      // If userId was provided instead of personId, look up the person doc ID
      const personResult = await pool.query<IdRow>(
        `SELECT id FROM documents
         WHERE workspace_id = $1 AND document_type = 'person'
           AND properties->>'user_id' = $2 AND archived_at IS NULL`,
        [workspaceId, userId]
      );
      if (personResult.rows[0]) {
        personDocId = personResult.rows[0].id;
      } else {
        res.status(400).json({ error: 'Invalid userId for this workspace' });
        return;
      }
    }

    let resolvedProgramId: string | null = null;
    let resolvedProjectId: string | null = null;

    if (isProjectAssignment) {
      // Validate projectId and get its parent program via document_associations
      const projectCheck = await pool.query<ProjectWithProgramRow>(
        `SELECT d.id, prog_da.related_id as program_id
         FROM documents d
         LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
         WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'`,
        [projectId, workspaceId]
      );
      if (!projectCheck.rows[0]) {
        res.status(400).json({ error: 'Invalid projectId for this workspace' });
        return;
      }
      resolvedProjectId = projectId;
      resolvedProgramId = projectCheck.rows[0].program_id; // Can be null for projects without programs
    } else {
      // Legacy: Validate programId belongs to current workspace
      const programCheck = await pool.query<IdRow>(
        `SELECT id FROM documents
         WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
        [programId, workspaceId]
      );
      if (!programCheck.rows[0]) {
        res.status(400).json({ error: 'Invalid programId for this workspace' });
        return;
      }
      resolvedProgramId = programId;
    }

    // Check if person is already assigned to this exact project/sprint (prevent duplicates)
    // Use IS NOT DISTINCT FROM for program_id to handle NULL values correctly
    const existingAssignment = await pool.query<IdRow>(
      `SELECT s.id
       FROM documents s
       WHERE s.workspace_id = $1 AND s.document_type = 'sprint'
         AND s.properties->'assignee_ids' ? $2
         AND (s.properties->>'sprint_number')::int = $3
         AND s.properties->>'project_id' = $4
         AND ($5::uuid IS NULL AND NOT EXISTS (SELECT 1 FROM document_associations WHERE document_id = s.id AND relationship_type = 'program') OR s.id IN (SELECT document_id FROM document_associations WHERE related_id = $5 AND relationship_type = 'program'))`,
      [workspaceId, personDocId, sprintNumber, resolvedProjectId, resolvedProgramId]
    );

    if (existingAssignment.rows[0]) {
      // Already assigned to this exact project/sprint - no-op, return success
      res.json({ success: true, sprintId: existingAssignment.rows[0].id });
      return;
    }

    // Enforce one allocation per person per week: remove from any OTHER project's sprint
    // for the same sprint_number before assigning to the new one.
    const conflictingSprints = await pool.query<SprintDocumentRow>(
      `SELECT id, properties FROM documents
       WHERE workspace_id = $1 AND document_type = 'sprint'
         AND (properties->>'sprint_number')::int = $2
         AND properties->'assignee_ids' @> to_jsonb($3::text)
         AND (properties->>'project_id' IS DISTINCT FROM $4)`,
      [workspaceId, sprintNumber, personDocId, resolvedProjectId]
    );

    for (const conflicting of conflictingSprints.rows) {
      const props = conflicting.properties || {};
      const assignees: string[] = (props.assignee_ids || []).filter((id: string) => id !== personDocId);
      await pool.query<EmptyRow>(
        `UPDATE documents SET properties = jsonb_set(properties, '{assignee_ids}', $1::jsonb), updated_at = now() WHERE id = $2`,
        [JSON.stringify(assignees), conflicting.id]
      );
    }

    // Find existing sprint for this program, project, and sprint number
    // Use IS NOT DISTINCT FROM for program_id to handle NULL values correctly
    let sprintResult = await pool.query<SprintDocumentRow>(
      `SELECT id, properties FROM documents
       WHERE workspace_id = $1 AND document_type = 'sprint'
         AND ($2::uuid IS NULL AND NOT EXISTS (SELECT 1 FROM document_associations WHERE document_id = documents.id AND relationship_type = 'program') OR id IN (SELECT document_id FROM document_associations WHERE related_id = $2 AND relationship_type = 'program'))
         AND (properties->>'sprint_number')::int = $3
         AND properties->>'project_id' = $4`,
      [workspaceId, resolvedProgramId, sprintNumber, resolvedProjectId]
    );

    let sprintId: string;
    if (sprintResult.rows[0]) {
      // Add person to existing sprint's assignee_ids array
      sprintId = sprintResult.rows[0].id;
      const currentProps = sprintResult.rows[0].properties || {};
      const currentAssignees: string[] = currentProps.assignee_ids || [];

      // Add person to array if not already present
      if (!currentAssignees.includes(personDocId)) {
        currentAssignees.push(personDocId);
      }

      const updatedProps = {
        ...currentProps,
        assignee_ids: currentAssignees,
      };

      await pool.query<EmptyRow>(
        `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(updatedProps), sprintId]
      );
    } else {
      // Create new sprint with assignee_ids array and project_id
      const props: Record<string, unknown> = {
        sprint_number: sprintNumber,
        assignee_ids: [personDocId],
      };
      if (resolvedProjectId) {
        props.project_id = resolvedProjectId;
      }

      const newSprintResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, properties)
         VALUES ($1, 'sprint', $2, $3)
         RETURNING id`,
        [workspaceId, `Week ${sprintNumber}`, JSON.stringify(props)]
      );
      const createdSprint = newSprintResult.rows[0];
      if (!createdSprint) {
        throw new Error('Failed to create sprint');
      }
      sprintId = createdSprint.id;

      // Create program association for the new sprint
      await pool.query<EmptyRow>(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [sprintId, resolvedProgramId]
      );
    }

    res.json({ success: true, sprintId });
  } catch (err) {
    sendInternalError(res, err, 'Assign error:');
  }
});

// DELETE /api/team/assign - Remove user as sprint owner
// Accepts personId (person document ID) - preferred
// Falls back to userId for backward compatibility
router.delete('/assign', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId: currentUserId, workspaceId } = getAuthenticatedRouteContext(req);
    const { personId, userId, sprintNumber } = req.body;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(currentUserId, workspaceId);

    const ownerId = personId || userId;
    if (!ownerId || !sprintNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Validate personId belongs to current workspace (SECURITY: prevent cross-workspace injection)
    let personDocId = personId;
    if (personId) {
      const personCheck = await pool.query<IdRow>(
        `SELECT id FROM documents
         WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
        [personId, workspaceId]
      );
      if (!personCheck.rows[0]) {
        res.status(400).json({ error: 'Invalid personId for this workspace' });
        return;
      }
    } else if (userId) {
      // If userId was provided instead of personId, look up the person doc ID
      const personResult = await pool.query<IdRow>(
        `SELECT id FROM documents
         WHERE workspace_id = $1 AND document_type = 'person'
           AND properties->>'user_id' = $2 AND archived_at IS NULL`,
        [workspaceId, userId]
      );
      if (personResult.rows[0]) {
        personDocId = personResult.rows[0].id;
      } else {
        res.status(400).json({ error: 'Invalid userId for this workspace' });
        return;
      }
    }

    // Find the sprint containing this person in assignee_ids for this sprint number
    const sprintResult = await pool.query<SprintDocumentRow>(
      `SELECT id, properties FROM documents
       WHERE workspace_id = $1 AND document_type = 'sprint'
         AND properties->'assignee_ids' ? $2
         AND (properties->>'sprint_number')::int = $3
         AND ${VISIBILITY_FILTER_SQL('documents', '$4', '$5')}`,
      [workspaceId, personDocId, sprintNumber, currentUserId, isAdmin]
    );

    if (!sprintResult.rows[0]) {
      res.status(404).json({ error: 'No assignment found' });
      return;
    }

    const sprintId = sprintResult.rows[0].id;
    const currentProps = sprintResult.rows[0].properties || {};

    // Remove person from assignee_ids array (keep sprint doc even if empty - Story 5)
    const currentAssignees: string[] = currentProps.assignee_ids || [];
    const updatedAssignees = currentAssignees.filter((id: string) => id !== personDocId);

    const updatedProps = {
      ...currentProps,
      assignee_ids: updatedAssignees,
    };

    await pool.query<EmptyRow>(
      `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(updatedProps), sprintId]
    );

    res.json({ success: true });
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

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7; // 1-week sprints
    const today = new Date();

    let startDate: Date;
    if (rawSprintStartDate instanceof Date) {
      startDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      startDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      startDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Calculate current sprint number
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Get last 6 sprints (including current)
    const fromSprint = Math.max(1, currentSprintNumber - 5);
    const toSprint = currentSprintNumber;

    // Generate sprint info
    const sprints = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const sprintStart = new Date(startDate);
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (i - 1) * sprintDurationDays);
      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDurationDays - 1);

      sprints.push({
        number: i,
        name: `Week ${i}`,
        startDate: sprintStart.toISOString().split('T')[0],
        endDate: sprintEnd.toISOString().split('T')[0],
        isCurrent: i === currentSprintNumber,
      });
    }

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

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7; // 1-week sprints
    const today = new Date();

    let startDate: Date;
    if (rawSprintStartDate instanceof Date) {
      startDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      startDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      startDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Calculate current sprint number
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Get last 6 sprints (including current)
    const fromSprint = Math.max(1, currentSprintNumber - 5);
    const toSprint = currentSprintNumber;

    // Generate sprint info
    const sprints = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const sprintStart = new Date(startDate);
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (i - 1) * sprintDurationDays);
      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDurationDays - 1);

      sprints.push({
        number: i,
        name: `Week ${i}`,
        startDate: sprintStart.toISOString().split('T')[0],
        endDate: sprintEnd.toISOString().split('T')[0],
        isCurrent: i === currentSprintNumber,
      });
    }

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

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7;
    const today = new Date();

    let sprintStartDate: Date;
    if (rawSprintStartDate instanceof Date) {
      sprintStartDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      sprintStartDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      sprintStartDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Calculate current sprint number and range
    const daysSinceStart = Math.floor((today.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);
    const fromSprint = Math.max(1, currentSprintNumber - sprintCount + 1);
    const toSprint = currentSprintNumber;

    // Generate weeks array
    const weeks: { number: number; name: string; startDate: string; endDate: string; isCurrent: boolean }[] = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const weekStart = new Date(sprintStartDate);
      weekStart.setUTCDate(weekStart.getUTCDate() + (i - 1) * sprintDurationDays);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + sprintDurationDays - 1);

      weeks.push({
        number: i,
        name: `Week ${i}`,
        startDate: weekStart.toISOString().split('T')[0] || '',
        endDate: weekEnd.toISOString().split('T')[0] || '',
        isCurrent: i === currentSprintNumber,
      });
    }

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

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7;
    const today = new Date();

    let sprintStartDate: Date;
    if (rawSprintStartDate instanceof Date) {
      sprintStartDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      sprintStartDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      sprintStartDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Calculate current sprint number
    const daysSinceStart = Math.floor((today.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Get sprint range (last 6 sprints + current + next 2)
    const fromSprint = Math.max(1, currentSprintNumber - 6);
    const toSprint = currentSprintNumber + 2;

    // Generate weeks array
    const weeks: { number: number; name: string; startDate: string; endDate: string; isCurrent: boolean }[] = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const weekStart = new Date(sprintStartDate);
      weekStart.setUTCDate(weekStart.getUTCDate() + (i - 1) * sprintDurationDays);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + sprintDurationDays - 1);

      weeks.push({
        number: i,
        name: `Week ${i}`,
        startDate: weekStart.toISOString().split('T')[0] || '',
        endDate: weekEnd.toISOString().split('T')[0] || '',
        isCurrent: i === currentSprintNumber,
      });
    }

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
      const daysSinceStart = Math.floor((sprintStart.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
      const sprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);
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
