import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { hasContent } from '../../utils/document-content.js';
import { sendInternalError } from '../../utils/route-http.js';
import {
  buildWorkspaceSprintCalendar,
  sprintNumberFromDate,
  SPRINT_DURATION_DAYS,
} from '../../services/team/sprint-calendar.js';
import { parseMetricEstimate } from './parse-metric.js';
import type {
  AccountabilityGridAssignmentRow,
  AccountabilityGridPersonRow,
  AccountabilityGridProgramRow,
  AccountabilityGridWeeklyDocRow,
  AssignmentInferenceIssueRow,
  WorkspaceSprintStartRow,
} from './types.js';

const router = Router();
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
