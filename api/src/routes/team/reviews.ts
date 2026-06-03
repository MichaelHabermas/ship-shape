import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { getVisibilityContext } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { hasContent } from '../../utils/document-content.js';
import { sendInternalError } from '../../utils/route-http.js';
import { buildWorkspaceSprintCalendar } from '../../services/team/sprint-calendar.js';
import {
  mapReviewPersonResponse,
  mapReviewSprintMapEntry,
} from './types.js';
import type {
  ReviewCellData,
  ReviewPersonRow,
  ReviewSprintMapEntry,
  ReviewSprintRow,
  ReviewWeeklyDocRow,
  WorkspaceSprintStartRow,
} from './types.js';

const router = Router();
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
    const reviews: Record<string, Record<number, ReviewCellData>> = {};

    for (const person of peopleResult.rows) {
      const personReviews: Record<number, ReviewCellData> = {};
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
export default router;
