import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getActor } from '../../services/document-access.js';
import { requireTeamAllocationAuthority } from '../../services/governance-auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError } from '../../utils/route-http.js';
import {
  assignTeamMember,
  unassignTeamMember,
} from '../../services/team-allocation-service.js';
import {
  buildWorkspaceSprintCalendar,
  sprintNumberFromDate,
  SPRINT_DURATION_DAYS,
} from '../../services/team/sprint-calendar.js';
import type {
  AssignmentInferenceIssueRow,
  ExplicitAssignmentRow,
  WorkspaceSprintStartRow,
} from './types.js';

const assignBodySchema = z.object({
  personId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  sprintNumber: z.number().int(),
});

const unassignBodySchema = z.object({
  personId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  sprintNumber: z.number().int(),
});


const router = Router();
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
    const parsed = assignBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }
    const { personId, userId, projectId, programId, sprintNumber } = parsed.data;

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
    const parsed = unassignBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }
    const { personId, userId, sprintNumber } = parsed.data;

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
export default router;
