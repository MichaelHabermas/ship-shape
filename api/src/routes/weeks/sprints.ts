import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getActor } from '../../services/document-access.js';
import { requireWeekLifecycleAuthority } from '../../services/governance-auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import { formatWireDate } from '../../utils/format-wire-date.js';
import { logDocumentChange } from '../../utils/document-crud.js';
import {
  asApprovalRecord,
} from '../../utils/approval-workflow.js';
import { broadcastToUser } from '../../collaboration/index.js';
import type {
  SprintRow,
  PersonLookupRow,
  SprintLookupRow,
  SprintInsertRow,
  WorkspaceSprintStartRow,
  SprintIssueIdRow,
  ProgramExistsRow,
  IdRow,
  UserIdRow,
  WorkspaceMemberUserRow,
  SprintExistsRow,
  SprintPrefixRow,
  SprintIssueListRow,
  SprintTitleRow,
  SprintScopeInfoRow,
  SprintIssueEstimateRow,
  SprintHistoryRow,
} from './types.js';

const router = Router();

router.get('/lookup-person', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const userId = req.query.user_id as string;

    if (!userId) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }

    const result = await pool.query<PersonLookupRow>(
      `SELECT id, title FROM documents
       WHERE workspace_id = $1 AND document_type = 'person'
         AND (properties->>'user_id') = $2
       LIMIT 1`,
      [workspaceId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    sendInternalError(res, err, 'Person lookup error:');
  }
});

// GET /api/weeks/lookup - Find sprint by project_id + sprint_number
// Returns the sprint document with its approval properties
router.get('/lookup', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getAuthenticatedRouteContext(req);
    const projectId = req.query.project_id as string;
    const sprintNumber = parseInt(req.query.sprint_number as string, 10);

    if (!projectId || isNaN(sprintNumber)) {
      res.status(400).json({ error: 'project_id and sprint_number are required' });
      return;
    }

    const result = await pool.query<SprintLookupRow>(
      `SELECT d.id, d.properties
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id
         AND da.related_id = $2 AND da.relationship_type = 'project'
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND (d.properties->>'sprint_number')::int = $3
       LIMIT 1`,
      [workspaceId, projectId, sprintNumber]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    sendInternalError(res, err, 'Sprint lookup error:');
  }
});

// Validation schemas
// Sprint properties: sprint_number, assignee_ids (array), and plan fields
// API accepts owner_id for backwards compatibility, stored internally as assignee_ids[0]
// Dates and status are computed from sprint_number + workspace.sprint_start_date
// program_id is optional - sprints can be projectless (ad-hoc work)
const createSprintSchema = z.object({
  program_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(200).optional().default('Untitled'),
  sprint_number: z.number().int().positive(),
  owner_id: z.string().uuid().optional(),
  // Plan tracking (optional at creation) - what will we learn/validate?
  plan: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

const updateSprintSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  owner_id: z.string().uuid().optional().nullable(), // Allow clearing owner
  sprint_number: z.number().int().positive().optional(),
  status: z.enum(['planning', 'active', 'completed']).optional(),
});

// Separate schema for plan updates (append mode)
const updatePlanSchema = z.object({
  plan: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

// Helper to extract sprint from row
// Dates and status are computed on frontend from sprint_number + workspace.sprint_start_date
function extractSprintFromRow(row: SprintRow) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    sprint_number: props.sprint_number || 1,
    status: props.status || 'planning',  // Default to 'planning' for sprints without status
    owner: row.owner_id ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    program_id: row.program_id,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    program_accountable_id: row.program_accountable_id || null,
    owner_reports_to: row.owner_reports_to || null,
    workspace_sprint_start_date: formatWireDate(row.workspace_sprint_start_date),
    issue_count: parseInt(String(row.issue_count || 0), 10) || 0,
    completed_count: parseInt(String(row.completed_count || 0), 10) || 0,
    started_count: parseInt(String(row.started_count || 0), 10) || 0,
    has_plan: row.has_plan === true || row.has_plan === 't',
    has_retro: row.has_retro === true || row.has_retro === 't',
    // Retro outcome summary (populated if retro exists)
    retro_outcome: row.retro_outcome || null,
    retro_id: row.retro_id || null,
    // Plan tracking fields - what will we learn/validate?
    plan: props.plan || null,
    success_criteria: props.success_criteria || null,
    confidence: typeof props.confidence === 'number' ? props.confidence : null,
    plan_history: props.plan_history || null,
    // Completeness flags
    is_complete: props.is_complete ?? null,
    missing_fields: props.missing_fields ?? [],
    // Plan snapshot (populated when sprint becomes active)
    planned_issue_ids: props.planned_issue_ids || null,
    snapshot_taken_at: props.snapshot_taken_at || null,
    // Approval tracking
    plan_approval: props.plan_approval || null,
    review_approval: props.review_approval || null,
    // Performance rating (OPM 5-level scale)
    review_rating: props.review_rating || null,
    // Accountability (sprints inherit from program, but may have direct assignment)
    accountable_id: props.accountable_id || null,
  };
}

// Calculate sprint dates from sprint_number and workspace start date
function calculateSprintDates(sprintNumber: number, workspaceStartDate: Date | string): { startDate: Date; endDate: Date } {
  const sprintDuration = 7; // 7-day sprints

  let baseDate: Date;
  if (workspaceStartDate instanceof Date) {
    baseDate = new Date(Date.UTC(workspaceStartDate.getFullYear(), workspaceStartDate.getMonth(), workspaceStartDate.getDate()));
  } else if (typeof workspaceStartDate === 'string') {
    baseDate = new Date(workspaceStartDate + 'T00:00:00Z');
  } else {
    baseDate = new Date();
  }

  const startDate = new Date(baseDate);
  startDate.setUTCDate(startDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + sprintDuration - 1);

  return { startDate, endDate };
}

// Check if sprint is active (start_date has passed)
function isSprintActive(sprintNumber: number, workspaceStartDate: Date | string): boolean {
  const { startDate } = calculateSprintDates(sprintNumber, workspaceStartDate);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today >= startDate;
}

// Take a snapshot of current issues in the sprint
async function takeSprintSnapshot(sprintId: string): Promise<string[]> {
  const result = await pool.query<SprintIssueIdRow>(
    `SELECT d.id FROM documents d
     JOIN document_associations da ON da.document_id = d.id
     WHERE da.related_id = $1 AND da.relationship_type = 'sprint' AND d.document_type = 'issue'`,
    [sprintId]
  );
  return result.rows.map(row => row.id);
}

// Get all active sprints across the workspace
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
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
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

// Get action items for current user (sprints needing docs)
// Returns sprints owned by the user that need plan or retro
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
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
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const props = row.properties || {};
    const sprintNumber = props.sprint_number || 1;
    const workspaceStartDate = row.workspace_sprint_start_date;

    // Check if sprint is active and needs a snapshot
    // Take snapshot when: sprint is active (start_date reached) AND no snapshot exists yet
    if (workspaceStartDate && isSprintActive(sprintNumber, workspaceStartDate) && !props.planned_issue_ids) {
      // Take the snapshot
      const sprintId = id as string; // Safe: Express route param is always a string
      const plannedIssueIds = await takeSprintSnapshot(sprintId);
      const snapshotTakenAt = new Date().toISOString();

      // Update the sprint properties with the snapshot
      const newProps = {
        ...props,
        planned_issue_ids: plannedIssueIds,
        snapshot_taken_at: snapshotTakenAt,
      };

      await pool.query(
        `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(newProps), id]
      );

      // Update row properties for response
      row.properties = newProps;
    }

    res.json(extractSprintFromRow(row));
  } catch (err) {
    sendInternalError(res, err, 'Get sprint error:');
  }
});

// Create sprint (creates a document with document_type = 'sprint')
// Only stores sprint_number and owner_id - dates/status computed from sprint_number
// program_id is optional - allows creating projectless sprints for ad-hoc work
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

// Update sprint - title, owner_id, and sprint_number can be updated
// When sprint_number changes, the plan snapshot is cleared and will be retaken when the new date arrives
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = updateSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it, also get workspace start date
    const existing = await pool.query<SprintExistsRow>(
      `SELECT d.id, d.properties, prog_da.related_id as program_id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const existingRow = existing.rows[0];
    if (!existingRow) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const currentProps = existingRow.properties || {};
    const programId = existingRow.program_id;
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const data = parsed.data;

    // Handle title update (regular column)
    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }

    // Handle owner_id and sprint_number updates (in properties)
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.owner_id !== undefined) {
      // Only validate if owner_id is not null (i.e., setting a new owner, not clearing)
      if (data.owner_id) {
        // Verify owner exists in workspace
        const ownerCheck = await pool.query<UserIdRow>(
          `SELECT u.id FROM users u
           JOIN workspace_memberships wm ON wm.user_id = u.id
           WHERE u.id = $1 AND wm.workspace_id = $2`,
          [data.owner_id, workspaceId]
        );

        if (ownerCheck.rows.length === 0) {
          res.status(400).json({ error: 'Owner not found in workspace' });
          return;
        }
      }

      // Store as assignee_ids array (migration converted owner_id to assignee_ids)
      // Also store owner_id directly for accountability checks
      newProps.assignee_ids = data.owner_id ? [data.owner_id] : [];
      newProps.owner_id = data.owner_id ?? undefined;
      propsChanged = true;
    }

    // Handle sprint_number update - this changes the effective dates
    if (data.sprint_number !== undefined && data.sprint_number !== currentProps.sprint_number) {
      // Check if new sprint_number already exists for this program
      if (programId) {
        const existingCheck = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
           WHERE d.document_type = 'sprint' AND d.id != $2 AND (d.properties->>'sprint_number')::int = $3`,
          [programId, id, data.sprint_number]
        );

        if (existingCheck.rows.length > 0) {
          res.status(400).json({ error: `Week ${data.sprint_number} already exists for this program` });
          return;
        }
      } else {
        // For programless sprints, check workspace-wide uniqueness (sprints with no program association)
        const existingCheck = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           WHERE d.workspace_id = $1 AND d.document_type = 'sprint' AND d.id != $2
             AND (d.properties->>'sprint_number')::int = $3
             AND NOT EXISTS (SELECT 1 FROM document_associations da WHERE da.document_id = d.id AND da.relationship_type = 'program')`,
          [workspaceId, id, data.sprint_number]
        );

        if (existingCheck.rows.length > 0) {
          res.status(400).json({ error: `Programless week ${data.sprint_number} already exists` });
          return;
        }
      }

      newProps.sprint_number = data.sprint_number;

      // Clear the plan snapshot - it will be retaken when the new date arrives
      delete newProps.planned_issue_ids;
      delete newProps.snapshot_taken_at;

      propsChanged = true;
    }

    // Handle status update — lifecycle only (SS-FIND-003); not generic member PATCH
    if (data.status !== undefined) {
      if (!isAdmin) {
        res.status(403).json({ error: 'Sprint status cannot be changed via this endpoint' });
        return;
      }
      newProps.status = data.status;
      propsChanged = true;
    }

    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'sprint'`,
      [...values, id, workspaceId]
    );

    // Re-query to get full sprint with owner info
    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
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
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id]
    );

    const updatedRow = result.rows[0];
    if (!updatedRow) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }
    res.json(extractSprintFromRow(updatedRow));
  } catch (err) {
    sendInternalError(res, err, 'Update sprint error:');
  }
});

// Start sprint - manually activate a planning sprint with scope snapshot
// POST /api/weeks/:id/start
router.post('/:id/start', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const existing = await pool.query<SprintExistsRow>(
      `SELECT d.id, d.properties, prog_da.related_id as program_id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const actor = getActor(req);
    const auth = await requireWeekLifecycleAuthority(pool, actor, id as string, 'start_week');
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const startExisting = existing.rows[0];
    if (!startExisting) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const currentProps = startExisting.properties || {};
    const currentStatus = currentProps.status || 'planning';
    if (currentStatus !== 'planning') {
      res.status(400).json({
        error: `Cannot start week: week is already ${currentStatus}`,
      });
      return;
    }

    // Take the scope snapshot
    const sprintId = id as string;
    const plannedIssueIds = await takeSprintSnapshot(sprintId);
    const snapshotTakenAt = new Date().toISOString();

    // Update sprint properties with snapshot and active status
    const newProps = {
      ...currentProps,
      status: 'active',
      planned_issue_ids: plannedIssueIds,
      snapshot_taken_at: snapshotTakenAt,
    };

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(newProps), id]
    );

    // Broadcast celebration when sprint is started
    broadcastToUser(userId, 'accountability:updated', { type: 'week_start', targetId: id as string });

    // Re-query to get full sprint with owner info
    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
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
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id]
    );

    const sprintRow = result.rows[0];
    if (!sprintRow) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }
    const sprint = extractSprintFromRow(sprintRow);

    res.json({
      ...sprint,
      snapshot_issue_count: plannedIssueIds.length,
    });
  } catch (err) {
    sendInternalError(res, err, 'Start sprint error:');
  }
});

// Delete sprint
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const existing = await pool.query<SprintExistsRow>(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    // Remove sprint associations from issues via document_associations
    await pool.query(
      `DELETE FROM document_associations WHERE related_id = $1 AND relationship_type = 'sprint'`,
      [id]
    );

    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND document_type = 'sprint'`,
      [id]
    );

    res.status(204).send();
  } catch (err) {
    sendInternalError(res, err, 'Delete sprint error:');
  }
});

// Update sprint plan (append mode - preserves history)
// PATCH /api/weeks/:id/plan
router.patch('/:id/plan', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it, get current properties
    const existing = await pool.query<SprintExistsRow>(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const planExisting = existing.rows[0];
    if (!planExisting) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const currentProps = planExisting.properties || {};
    const newProps = { ...currentProps };
    const data = parsed.data;
    const now = new Date().toISOString();
    // If plan is being updated, append old one to history
    if (data.plan !== undefined && data.plan !== currentProps.plan) {
      // Initialize history if doesn't exist
      const currentHistory = Array.isArray(currentProps.plan_history)
        ? [...currentProps.plan_history]
        : [];

      // If there was a previous plan, add it to history
      if (currentProps.plan) {
        currentHistory.push({
          plan: currentProps.plan,
          timestamp: now,
          author_id: userId,
        });
      }

      // Update to new plan
      newProps.plan = data.plan;
      newProps.plan_history = currentHistory;

    }

    // Update success_criteria and confidence directly
    if (data.success_criteria !== undefined) {
      newProps.success_criteria = data.success_criteria;
    }
    if (data.confidence !== undefined) {
      newProps.confidence = data.confidence;
    }

    // If plan or success_criteria changed and was previously approved, transition to 'changed_since_approved'
    const planChanged = data.plan !== undefined && data.plan !== currentProps.plan;
    const criteriaChanged = data.success_criteria !== undefined &&
      JSON.stringify(data.success_criteria) !== JSON.stringify(currentProps.success_criteria);

    if ((planChanged || criteriaChanged) &&
        asApprovalRecord(currentProps.plan_approval)?.state === 'approved') {
      newProps.plan_approval = {
        ...(currentProps.plan_approval as Record<string, unknown>),
        state: 'changed_since_approved',
      };
    }

    // Save updated properties
    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND workspace_id = $3 AND document_type = 'sprint'`,
      [JSON.stringify(newProps), id, workspaceId]
    );

    // Log changes to document_history for approval workflow tracking
    if (data.plan !== undefined && data.plan !== currentProps.plan) {
      await logDocumentChange(
        id as string,
        'plan',
        currentProps.plan || null,
        data.plan || null,
        userId
      );
    }
    if (data.success_criteria !== undefined) {
      const oldCriteria = currentProps.success_criteria ? JSON.stringify(currentProps.success_criteria) : null;
      const newCriteria = data.success_criteria ? JSON.stringify(data.success_criteria) : null;
      if (oldCriteria !== newCriteria) {
        await logDocumentChange(
          id as string,
          'success_criteria',
          oldCriteria,
          newCriteria,
          userId
        );
      }
    }

    // Broadcast celebration when plan is added
    if (data.plan && data.plan.trim() !== '') {
      broadcastToUser(userId, 'accountability:updated', { type: 'weekly_plan', targetId: id as string });
    }

    // Re-query to get full sprint with owner info
    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
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
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id]
    );

    const updatedRow = result.rows[0];
    if (!updatedRow) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }
    res.json(extractSprintFromRow(updatedRow));
  } catch (err) {
    sendInternalError(res, err, 'Update sprint plan error:');
  }
});

// Get sprint issues
router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists, user can access it, and get program info
    const sprintResult = await pool.query<SprintPrefixRow>(
      `SELECT d.id, p.properties->>'prefix' as prefix FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const result = await pool.query<SprintIssueListRow>(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived
       FROM documents d
       JOIN document_associations sprint_da ON sprint_da.document_id = d.id AND sprint_da.related_id = $1 AND sprint_da.relationship_type = 'sprint'
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       WHERE d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id, userId, isAdmin]
    );

    // Get carryover sprint names for issues that have carryover_from_sprint_id
    const carryoverSprintIds = result.rows
      .map(row => row.properties?.carryover_from_sprint_id)
      .filter(Boolean);

    let carryoverSprintNames: Record<string, string> = {};
    if (carryoverSprintIds.length > 0) {
      const uniqueIds = [...new Set(carryoverSprintIds)];
      const sprintNamesResult = await pool.query<SprintTitleRow>(
        `SELECT id, title FROM documents WHERE id = ANY($1) AND document_type = 'sprint'`,
        [uniqueIds]
      );
      carryoverSprintNames = Object.fromEntries(
        sprintNamesResult.rows.map(r => [r.id, r.title])
      );
    }

    const issues = result.rows.map(row => {
      const props = row.properties || {};
      const carryoverFromSprintId = props.carryover_from_sprint_id || null;
      return {
        id: row.id,
        title: row.title,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        estimate: props.estimate ?? null,
        ticket_number: row.ticket_number,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        assignee_name: row.assignee_name,
        assignee_archived: row.assignee_archived || false,
        display_id: `#${row.ticket_number}`,
        carryover_from_sprint_id: carryoverFromSprintId,
        carryover_from_sprint_name: carryoverFromSprintId
          ? carryoverSprintNames[carryoverFromSprintId] || null
          : null,
      };
    });

    res.json(issues);
  } catch (err) {
    sendInternalError(res, err, 'Get sprint issues error:');
  }
});

// Get sprint scope changes
// Returns: { originalScope, currentScope, scopeChangePercent, scopeChanges }
router.get('/:id/scope-changes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get sprint info including sprint_number and workspace start date
    const sprintResult = await pool.query<SprintScopeInfoRow>(
      `SELECT d.id, d.properties->>'sprint_number' as sprint_number,
              w.sprint_start_date as workspace_sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const sprintNumber = parseInt(String(sprintResult.rows[0]?.sprint_number ?? ''), 10);
    const rawStartDate = sprintResult.rows[0]?.workspace_sprint_start_date;
    const sprintDuration = 7; // 1-week sprints

    // Calculate sprint start date
    let workspaceStartDate: Date;
    if (rawStartDate instanceof Date) {
      workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
    } else if (typeof rawStartDate === 'string') {
      workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
    } else {
      workspaceStartDate = new Date();
    }

    const sprintStartDate = new Date(workspaceStartDate);
    sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

    // Get all issues currently in the sprint with their estimates
    const issuesResult = await pool.query<SprintIssueEstimateRow>(
      `SELECT d.id, COALESCE((d.properties->>'estimate')::numeric, 0) as estimate
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
       WHERE d.document_type = 'issue'`,
      [id]
    );

    // Get when each issue was added to this sprint from document_history
    // field = 'sprint_id' and new_value = sprint_id means issue was added to sprint
    const historyResult = await pool.query<SprintHistoryRow>(
      `SELECT document_id, created_at, old_value, new_value
       FROM document_history
       WHERE field = 'sprint_id' AND new_value = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Build a map of issue_id -> first_added_at (when issue was added to this sprint)
    const issueAddedAtMap: Record<string, Date> = {};
    for (const row of historyResult.rows) {
      if (!issueAddedAtMap[row.document_id]) {
        issueAddedAtMap[row.document_id] = new Date(row.created_at);
      }
    }

    // Calculate original scope (issues added before or at sprint start)
    // and current scope (all issues)
    let originalScope = 0;
    let currentScope = 0;

    for (const issue of issuesResult.rows) {
      const estimate = parseFloat(String(issue.estimate)) || 0;
      currentScope += estimate;

      const addedAt = issueAddedAtMap[issue.id];
      // If no history record, assume it was always there (original)
      // If added before or at sprint start, it's original scope
      if (!addedAt || addedAt <= sprintStartDate) {
        originalScope += estimate;
      }
    }

    // Build scope changes timeline for the graph
    // Each entry: { timestamp, newScope, changeType, estimateChange }
    const scopeChanges: Array<{
      timestamp: string;
      scopeAfter: number;
      changeType: 'added' | 'removed';
      estimateChange: number;
    }> = [];

    // Get estimates for issues when they were added
    const issueEstimateMap: Record<string, number> = {};
    for (const issue of issuesResult.rows) {
      issueEstimateMap[issue.id] = parseFloat(String(issue.estimate)) || 0;
    }

    // Only track changes after sprint starts
    let runningScope = originalScope;
    for (const row of historyResult.rows) {
      const createdAt = new Date(row.created_at);
      if (createdAt > sprintStartDate) {
        const estimate = issueEstimateMap[row.document_id] || 0;
        runningScope += estimate;
        scopeChanges.push({
          timestamp: createdAt.toISOString(),
          scopeAfter: runningScope,
          changeType: 'added',
          estimateChange: estimate,
        });
      }
    }

    // Also check for issues removed from sprint (sprint_id changed away from this sprint)
    const removedResult = await pool.query<SprintHistoryRow>(
      `SELECT document_id, created_at, old_value, new_value
       FROM document_history
       WHERE field = 'sprint_id' AND old_value = $1 AND created_at > $2
       ORDER BY created_at ASC`,
      [id, sprintStartDate.toISOString()]
    );

    for (const row of removedResult.rows) {
      // We need the estimate of the issue at time of removal
      // For simplicity, we'll use the current estimate (or 0 if issue no longer in sprint)
      // In a real system, you might want to track historical estimates
      const issueResult = await pool.query<SprintIssueEstimateRow>(
        `SELECT COALESCE((properties->>'estimate')::numeric, 0) as estimate
         FROM documents WHERE id = $1`,
        [row.document_id]
      );
      const estimate = issueResult.rows[0]
        ? parseFloat(String(issueResult.rows[0].estimate))
        : 0;

      scopeChanges.push({
        timestamp: new Date(row.created_at).toISOString(),
        scopeAfter: -1, // Will be recalculated when sorting
        changeType: 'removed',
        estimateChange: -estimate,
      });
    }

    // Sort scope changes by timestamp and recalculate running scope
    scopeChanges.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    runningScope = originalScope;
    for (const change of scopeChanges) {
      runningScope += change.estimateChange;
      change.scopeAfter = runningScope;
    }

    // Calculate scope change percentage
    const scopeChangePercent = originalScope > 0
      ? Math.round(((currentScope - originalScope) / originalScope) * 100)
      : 0;

    res.json({
      originalScope,
      currentScope,
      scopeChangePercent,
      sprintStartDate: sprintStartDate.toISOString(),
      scopeChanges,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get sprint scope changes error:');
  }
});


export default router;
