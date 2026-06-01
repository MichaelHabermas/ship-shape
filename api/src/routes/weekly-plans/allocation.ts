import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { TEMPLATE_HEADINGS } from '../../utils/document-content.js';
import {
  getActor,
  getDocumentAccessContext,
  getReadableDocument,
  visibilityPredicate,
} from '../../services/document-access.js';
import { sendInternalError } from '../../utils/route-http.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import {
  requireFirstRow,
  type WorkspaceSprintStartRow,
  type AllocatedPersonRow,
  type WeeklyDocStatusRow,
} from './shared.js';

const router = Router();

/**
 * @swagger
 * /project-allocation-grid/{projectId}:
 *   get:
 *     summary: Get allocation grid data for a project
 *     description: Returns people allocated to a project (via assigned issues), weeks, and plan/retro status
 *     tags: [Weekly Plans]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Allocation grid data
 */
async function getProjectAllocationGrid(req: Request, res: Response) {
  try {
    // JSONB property filters must cast to uuid (node-pg sends UUID params as uuid type).
    // Plan/retro status queries must qualify d.properties — JOIN makes bare properties ambiguous.
    const { projectId } = req.params;
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    const project = await getReadableDocument(pool, actor, String(projectId), 'project');
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
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

    const sprintStartDate = new Date(requireFirstRow(workspaceResult.rows).sprint_start_date);
    const sprintDuration = 7; // 1 week sprints (standard for Ship)

    // Calculate current sprint number
    const today = new Date();
    const daysSinceStart = Math.floor((today.getTime() - sprintStartDate.getTime()) / (24 * 60 * 60 * 1000));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDuration) + 1);

    // Find all people allocated to sprints for this project (via assignee_ids + project_id in sprint properties)
    // Note: team.ts stores project assignment in properties.project_id, NOT document_associations
    const allocatedPeopleResult = await pool.query<AllocatedPersonRow>(
      `SELECT DISTINCT p.id as person_id, p.title as person_name, (s.properties->>'sprint_number')::int as week_number
       FROM documents s
       CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.properties->'assignee_ids', '[]'::jsonb)) AS assignee_id
       JOIN documents p ON p.id = assignee_id::uuid AND p.document_type = 'person'
       WHERE s.workspace_id = $1
         AND s.document_type = 'sprint'
         AND (s.properties->>'project_id')::uuid = $2
         AND s.deleted_at IS NULL
         AND s.archived_at IS NULL
         AND ${visibilityPredicate('s', '$3', '$4')}
         AND p.workspace_id = $1
         AND p.deleted_at IS NULL
         AND p.archived_at IS NULL
         AND ${visibilityPredicate('p', '$3', '$4')}
         AND ((p.properties->>'user_id')::uuid = $3::uuid OR $4 = TRUE)`,
      [workspaceId, projectId, actor.userId, isAdmin]
    );

    // Group allocations by person
    const peopleMap = new Map<string, { id: string; name: string; allocatedWeeks: Set<number> }>();
    for (const row of allocatedPeopleResult.rows) {
      if (!peopleMap.has(row.person_id)) {
        peopleMap.set(row.person_id, {
          id: row.person_id,
          name: row.person_name || 'Unknown',
          allocatedWeeks: new Set(),
        });
      }
      const personAllocation = peopleMap.get(row.person_id);
      if (personAllocation) {
        personAllocation.allocatedWeeks.add(row.week_number);
      }
    }

    // Get weekly plans for allocated people (include content to check if "done")
    const plansResult = await pool.query<WeeklyDocStatusRow>(
      `SELECT DISTINCT ON ((d.properties->>'person_id'), (d.properties->>'week_number')::int)
              (d.properties->>'person_id') as person_id, (d.properties->>'week_number')::int as week_number, d.id, d.content
       FROM documents d
       JOIN documents p ON (d.properties->>'person_id')::uuid = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'weekly_plan'
         AND d.deleted_at IS NULL
         AND d.archived_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}
         AND p.workspace_id = $1
         AND p.document_type = 'person'
         AND p.deleted_at IS NULL
         AND p.archived_at IS NULL
         AND ${visibilityPredicate('p', '$3', '$4')}
         AND ((p.properties->>'user_id')::uuid = $3::uuid OR $4 = TRUE)
       ORDER BY (d.properties->>'person_id'),
                (d.properties->>'week_number')::int,
                ((d.properties->>'project_id')::uuid = $2) DESC,
                d.updated_at DESC`,
      [workspaceId, projectId, actor.userId, isAdmin]
    );

    // Get weekly retros for allocated people (include content to check if "done")
    const retrosResult = await pool.query<WeeklyDocStatusRow>(
      `SELECT DISTINCT ON ((d.properties->>'person_id'), (d.properties->>'week_number')::int)
              (d.properties->>'person_id') as person_id, (d.properties->>'week_number')::int as week_number, d.id, d.content
       FROM documents d
       JOIN documents p ON (d.properties->>'person_id')::uuid = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'weekly_retro'
         AND d.deleted_at IS NULL
         AND d.archived_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}
         AND p.workspace_id = $1
         AND p.document_type = 'person'
         AND p.deleted_at IS NULL
         AND p.archived_at IS NULL
         AND ${visibilityPredicate('p', '$3', '$4')}
         AND ((p.properties->>'user_id')::uuid = $3::uuid OR $4 = TRUE)
       ORDER BY (d.properties->>'person_id'),
                (d.properties->>'week_number')::int,
                ((d.properties->>'project_id')::uuid = $2) DESC,
                d.updated_at DESC`,
      [workspaceId, projectId, actor.userId, isAdmin]
    );

    // Helper to extract all text from a TipTap document
    const extractText = (node: unknown): string => {
      if (!node || typeof node !== 'object') return '';
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === 'text' && n.text) return n.text;
      if (Array.isArray(n.content)) {
        return n.content.map(extractText).join('');
      }
      return '';
    };

    // Helper to check if document has content beyond the template
    // "Done" means user has added their own text (not just the template heading)
    const hasContent = (content: unknown): boolean => {
      if (!content || typeof content !== 'object') return false;
      const doc = content as { content?: unknown[] };
      if (!Array.isArray(doc.content) || doc.content.length === 0) return false;

      // Extract all text from the document
      const allText = extractText(content).trim();

      // Remove template heading texts to see if anything user-written remains
      let textWithoutTemplate = allText;
      for (const heading of TEMPLATE_HEADINGS) {
        textWithoutTemplate = textWithoutTemplate.replace(heading, '');
      }

      // If there's any non-whitespace text left, the user has added content
      return textWithoutTemplate.trim().length > 0;
    };

    // Helper to calculate plan/retro status based on timing
    // Plan: yellow Sat 00:00 → Mon 23:59, red after Tue 00:00
    // Retro: yellow Fri 00:00 → Sun 23:59, red after Mon 00:00
    const calculateStatus = (
      docId: string | null,
      docContent: unknown,
      weekStartDate: Date,
      type: 'plan' | 'retro'
    ): 'done' | 'due' | 'late' | 'future' => {
      // If document exists with content, it's done
      if (docId && hasContent(docContent)) {
        return 'done';
      }

      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);

      if (type === 'plan') {
        // Plan timing relative to week start:
        // Yellow: Saturday before (week start - 2 days) through Monday EOD (week start + 1 day)
        // Red: After Monday (week start + 2 days onwards)
        const yellowStart = new Date(weekStartDate);
        yellowStart.setUTCDate(yellowStart.getUTCDate() - 2); // Saturday
        const redStart = new Date(weekStartDate);
        redStart.setUTCDate(redStart.getUTCDate() + 2); // Tuesday 00:00

        if (now < yellowStart) return 'future';
        if (now >= redStart) return 'late';
        return 'due';
      } else {
        // Retro timing relative to week start:
        // Yellow: Friday (week start + 4 days) through Sunday (week start + 6 days)
        // Red: Monday of next week (week start + 7 days)
        const yellowStart = new Date(weekStartDate);
        yellowStart.setUTCDate(yellowStart.getUTCDate() + 4); // Friday
        const redStart = new Date(weekStartDate);
        redStart.setUTCDate(redStart.getUTCDate() + 7); // Monday of next week

        if (now < yellowStart) return 'future';
        if (now >= redStart) return 'late';
        return 'due';
      }
    };

    // Build plan/retro maps with content for status calculation
    const plans = new Map<string, { id: string; content: unknown }>(); // `${personId}_${weekNumber}` -> {id, content}
    for (const row of plansResult.rows) {
      plans.set(`${row.person_id}_${row.week_number}`, { id: row.id, content: row.content });
    }

    const retros = new Map<string, { id: string; content: unknown }>(); // `${personId}_${weekNumber}` -> {id, content}
    for (const row of retrosResult.rows) {
      retros.set(`${row.person_id}_${row.week_number}`, { id: row.id, content: row.content });
    }

    // Determine week range to show (min/max allocated weeks or current sprint)
    let minWeek = currentSprintNumber;
    let maxWeek = currentSprintNumber;
    for (const person of peopleMap.values()) {
      for (const week of person.allocatedWeeks) {
        minWeek = Math.min(minWeek, week);
        maxWeek = Math.max(maxWeek, week);
      }
    }

    // Generate weeks array
    const weeks: { number: number; name: string; startDate: string; endDate: string; isCurrent: boolean }[] = [];
    for (let n = minWeek; n <= maxWeek; n++) {
      const weekStart = new Date(sprintStartDate);
      weekStart.setUTCDate(weekStart.getUTCDate() + (n - 1) * sprintDuration);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + sprintDuration - 1);

      weeks.push({
        number: n,
        name: `Week ${n}`,
        startDate: weekStart.toISOString().split('T')[0] || '',
        endDate: weekEnd.toISOString().split('T')[0] || '',
        isCurrent: n === currentSprintNumber,
      });
    }

    // Build people array with allocation and status per week
    const people = Array.from(peopleMap.values()).map(person => ({
      id: person.id,
      name: person.name,
      weeks: Object.fromEntries(
        weeks.map(week => {
          const weekStartDate = new Date(week.startDate);
          const planData = plans.get(`${person.id}_${week.number}`);
          const retroData = retros.get(`${person.id}_${week.number}`);

          return [
            week.number,
            {
              isAllocated: person.allocatedWeeks.has(week.number),
              planId: planData?.id || null,
              planStatus: calculateStatus(planData?.id || null, planData?.content, weekStartDate, 'plan'),
              retroId: retroData?.id || null,
              retroStatus: calculateStatus(retroData?.id || null, retroData?.content, weekStartDate, 'retro'),
            },
          ];
        })
      ),
    }));

    // Sort people alphabetically
    people.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      projectId,
      projectTitle: project.title,
      currentSprintNumber,
      weeks,
      people,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get project allocation grid error:');
  }
}


router.get('/project-allocation-grid/:projectId', authMiddleware, getProjectAllocationGrid);

export default router;
