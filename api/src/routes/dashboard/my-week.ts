import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { sendInternalError } from '../../utils/route-http.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { extractPlanItems } from './plan-items.js';
import {
  type FocusAllocationRow,
  type MyWeekContextRow,
  type WeeklyDocRow,
  type StandupDocRow,
} from './types.js';

const router = Router();
router.get('/my-week', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // 1. Look up the user's person document and workspace sprint configuration.
    const contextResult = await pool.query<MyWeekContextRow>(
      `SELECT
         person.id as person_id,
         person.title as person_name,
         w.sprint_start_date
       FROM workspaces w
       LEFT JOIN documents person ON person.workspace_id = w.id
         AND person.document_type = 'person'
         AND person.properties->>'user_id' = $2
       WHERE w.id = $1
       LIMIT 1`,
      [workspaceId, userId]
    );

    if (contextResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (!contextResult.rows[0]?.person_id) {
      res.status(404).json({ error: 'Person not found for current user' });
      return;
    }

    const personId = contextResult.rows[0].person_id;
    const personName = contextResult.rows[0].person_name;
    const rawStartDate = contextResult.rows[0].sprint_start_date;
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

    // 3. Fetch plan, current retro, and previous retro in one pass.
    const weeklyDocsResult = await pool.query<WeeklyDocRow>(
      `SELECT id, title, content, properties, document_type, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type IN ('weekly_plan', 'weekly_retro')
         AND (properties->>'person_id') = $2
         AND (properties->>'week_number')::int = ANY($3)
         AND archived_at IS NULL
         AND deleted_at IS NULL
       ORDER BY updated_at DESC`,
      [workspaceId, personId, previousWeekNumber > 0 ? [targetWeekNumber, previousWeekNumber] : [targetWeekNumber]]
    );

    const planRow = weeklyDocsResult.rows.find(row =>
      row.document_type === 'weekly_plan'
      && Number(row.properties?.week_number) === targetWeekNumber
    );
    const retroRow = weeklyDocsResult.rows.find(row =>
      row.document_type === 'weekly_retro'
      && Number(row.properties?.week_number) === targetWeekNumber
    );
    const previousRetroRow = previousWeekNumber > 0
      ? weeklyDocsResult.rows.find(row =>
          row.document_type === 'weekly_retro'
          && Number(row.properties?.week_number) === previousWeekNumber
        )
      : undefined;

    const plan = planRow
      ? {
          id: planRow.id,
          title: planRow.title,
          submitted_at: planRow.properties?.submitted_at || null,
          items: extractPlanItems(planRow.content),
        }
      : null;

    const retro = retroRow
      ? {
          id: retroRow.id,
          title: retroRow.title,
          submitted_at: retroRow.properties?.submitted_at || null,
          items: extractPlanItems(retroRow.content),
        }
      : null;

    const previousRetro = previousWeekNumber > 0
      ? previousRetroRow
        ? {
            id: previousRetroRow.id,
            title: previousRetroRow.title,
            submitted_at: previousRetroRow.properties?.submitted_at || null,
            week_number: previousWeekNumber,
          }
        : { id: null, title: null, submitted_at: null, week_number: previousWeekNumber }
      : null;

    // 4. Compute the 7 dates of the target week.
    // Compute the 7 dates
    const standupDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setUTCDate(d.getUTCDate() + i);
      const dateStr = d.toISOString().split('T')[0] as string;
      standupDates.push(dateStr);
    }

    // 5. Fetch standups and project allocations in parallel.
    const [standupsResult, allocationsResult] = await Promise.all([
      pool.query<StandupDocRow>(
        `SELECT id, title, properties, created_at, updated_at
         FROM documents
         WHERE workspace_id = $1
           AND document_type = 'standup'
           AND (properties->>'author_id') = $2
           AND (properties->>'date') = ANY($3)
           AND deleted_at IS NULL
         ORDER BY (properties->>'date') ASC`,
        [workspaceId, userId, standupDates]
      ),
      pool.query<FocusAllocationRow>(
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
      ),
    ]);

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
