import { Router, Request, Response } from 'express';
import { pool } from '../../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../../middleware/visibility.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../../../utils/route-http.js';
import { formatWireDate } from '../../../utils/format-wire-date.js';
import type {
  SprintRow,
  SprintInsertRow,
  WorkspaceSprintStartRow,
  ProgramExistsRow,
  IdRow,
  WorkspaceMemberUserRow,
} from '../types.js';
import {
  visibleSprintIssueCountSql,
  createSprintSchema,
  extractSprintFromRow,
} from './shared.js';

const router = Router();

router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // First, get the workspace sprint_start_date to calculate current sprint number
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0]?.sprint_start_date;
    if (rawStartDate === undefined) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
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

    // Get all sprints that match the current sprint number - join via document_associations
    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              $5::timestamp as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (${visibleSprintIssueCountSql('$3', '$4')}) as issue_count,
              (${visibleSprintIssueCountSql('$3', '$4', "i.properties->>'state' = 'done'")}) as completed_count,
              (${visibleSprintIssueCountSql('$3', '$4', "i.properties->>'state' IN ('in_progress', 'in_review')")}) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'weekly_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND (d.properties->>'sprint_number')::int = $2
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY (d.properties->>'sprint_number')::int, p.title`,
      [workspaceId, currentSprintNumber, userId, isAdmin, rawStartDate]
    );

    const sprints = result.rows.map(row => ({
      ...extractSprintFromRow(row),
      days_remaining: daysRemaining,
      status: 'active' as const,
    }));

    res.json({
      weeks: sprints,
      current_sprint_number: currentSprintNumber,
      days_remaining: daysRemaining,
      sprint_start_date: currentSprintStart.toISOString().split('T')[0],
      sprint_end_date: currentSprintEnd.toISOString().split('T')[0],
    });
  } catch (err) {
    sendInternalError(res, err, 'Get active sprints error:');
  }
});

router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = createSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { program_id, title, sprint_number, owner_id, plan, success_criteria, confidence } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get workspace info (always needed for sprint_start_date)
    const workspaceResult = await pool.query<WorkspaceSprintStartRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const sprintStartDate = workspaceResult.rows[0]?.sprint_start_date;

    // If program_id provided, verify it belongs to workspace and user can access it
    if (program_id) {
      const programCheck = await pool.query<ProgramExistsRow>(
        `SELECT d.id
         FROM documents d
         WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'program'
           AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
        [program_id, workspaceId, userId, isAdmin]
      );

      if (programCheck.rows.length === 0) {
        res.status(404).json({ error: 'Program not found' });
        return;
      }

      // Check if sprint already exists for this program + sprint_number
      const existingCheck = await pool.query<IdRow>(
        `SELECT d.id FROM documents d
         JOIN document_associations da ON da.document_id = d.id
         WHERE da.related_id = $1 AND da.relationship_type = 'program'
           AND d.document_type = 'sprint' AND (d.properties->>'sprint_number')::int = $2`,
        [program_id, sprint_number]
      );

      if (existingCheck.rows.length > 0) {
        res.status(400).json({ error: `Week ${sprint_number} already exists for this program` });
        return;
      }
    } else {
      // For projectless sprints, check workspace-wide uniqueness (sprints without program association)
      const existingCheck = await pool.query<IdRow>(
        `SELECT d.id FROM documents d
         WHERE d.workspace_id = $1
           AND d.document_type = 'sprint'
           AND (d.properties->>'sprint_number')::int = $2
           AND NOT EXISTS (
             SELECT 1 FROM document_associations da
             WHERE da.document_id = d.id AND da.relationship_type = 'program'
           )`,
        [workspaceId, sprint_number]
      );

      if (existingCheck.rows.length > 0) {
        res.status(400).json({ error: `Programless week ${sprint_number} already exists` });
        return;
      }
    }

    // Verify owner exists in workspace (if provided)
    let ownerData = null;
    if (owner_id) {
      const ownerCheck = await pool.query<WorkspaceMemberUserRow>(
        `SELECT u.id, u.name, u.email FROM users u
         JOIN workspace_memberships wm ON wm.user_id = u.id
         WHERE u.id = $1 AND wm.workspace_id = $2`,
        [owner_id, workspaceId]
      );

      if (ownerCheck.rows.length === 0) {
        res.status(400).json({ error: 'Owner not found in workspace' });
        return;
      }
      ownerData = ownerCheck.rows[0];
    }

    // Build properties JSONB - sprint_number, assignee_ids, and plan fields
    const properties: Record<string, unknown> = {
      sprint_number,
      assignee_ids: owner_id ? [owner_id] : [],
    };

    if (owner_id) {
      properties.owner_id = owner_id;
    }

    // Add plan fields if provided
    if (plan !== undefined) {
      properties.plan = plan;
      // Initialize plan_history with the initial plan
      properties.plan_history = [{
        plan,
        timestamp: new Date().toISOString(),
        author_id: userId,
      }];
    }
    if (success_criteria !== undefined) {
      properties.success_criteria = success_criteria;
    }
    if (confidence !== undefined) {
      properties.confidence = confidence;
    }

    // Default TipTap content for new sprints with HypothesisBlock and Success Criteria
    // The hypothesisBlock syncs bidirectionally with sprint.properties.hypothesis
    const defaultContent = {
      type: 'doc',
      content: [
        {
          type: 'hypothesisBlock',
          attrs: { placeholder: 'What will get done this sprint?' },
          content: []
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Success Criteria' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'How will we know if the hypothesis is validated? What metrics or outcomes will we measure?' }]
        }
      ]
    };

    const result = await pool.query<SprintInsertRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, content)
       VALUES ($1, 'sprint', $2, $3, $4, $5)
       RETURNING id, title, properties`,
      [workspaceId, title, JSON.stringify(properties), userId, JSON.stringify(defaultContent)]
    );

    const newSprint = result.rows[0];
    if (!newSprint) {
      throw new Error('Create sprint did not return a row');
    }

    const sprintId = newSprint.id;

    // Create document_association to link sprint to program (required for queries that join via associations)
    if (program_id) {
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [sprintId, program_id]
      );
    }

    const wireStartDate = formatWireDate(sprintStartDate);
    if (!wireStartDate) {
      res.status(500).json({ error: 'Workspace sprint start date is not configured' });
      return;
    }

    res.status(201).json({
      id: newSprint.id,
      name: newSprint.title,
      sprint_number,
      owner: ownerData ? {
        id: ownerData.id,
        name: ownerData.name,
        email: ownerData.email,
      } : null,
      program_id: program_id || null,
      workspace_sprint_start_date: wireStartDate,
      issue_count: 0,
      completed_count: 0,
      started_count: 0,
      // Plan tracking fields - what will we learn/validate?
      plan: properties.plan || null,
      success_criteria: properties.success_criteria || null,
      confidence: properties.confidence ?? null,
      plan_history: properties.plan_history || null,
    });
  } catch (err) {
    sendInternalError(res, err, 'Create sprint error:');
  }
});

export default router;
