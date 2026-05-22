import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import type { ProjectProperties, WeekProperties } from '@ship/shared';
import { DEFAULT_PROJECT_PROPERTIES, computeICEScore } from '@ship/shared';
import { checkDocumentCompleteness } from '../utils/extractHypothesis.js';
import { logDocumentChange, syncProgramAssociation } from '../utils/document-crud.js';
import {
  applyChangedSinceApprovedOnEdit,
  asApprovalRecord,
  buildApprovedApprovalRecord,
  checkProjectAccountableAuth,
  resolveApprovedVersionId,
} from '../utils/approval-workflow.js';
import { broadcastToUser } from '../collaboration/index.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';

const router = Router();

// Inferred project status type
type InferredProjectStatus = 'active' | 'planned' | 'completed' | 'backlog' | 'archived';

type ProjectRouteProperties = Partial<ProjectProperties> & {
  is_complete?: boolean | null;
  missing_fields?: string[];
  plan?: string | null;
  has_retro?: boolean;
  target_date?: string | null;
};

type ProjectRow = {
  id: string;
  title: string;
  content?: unknown;
  properties: ProjectRouteProperties | null;
  program_id?: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  sprint_count?: string | number | null;
  issue_count?: string | number | null;
  inferred_status?: InferredProjectStatus | null;
  converted_to_id?: string | null;
  converted_from_id?: string | null;
};

type CanonicalWeekProperties = Partial<Pick<WeekProperties, 'sprint_number' | 'owner_id'>> & {
  owner_id?: string | null;
};

type ProjectSprintProperties = CanonicalWeekProperties & {
  status?: string;
  plan?: string | null;
  success_criteria?: string[] | null;
  confidence?: number | null;
};

type ProjectSprintRow = {
  id: string;
  title: string;
  properties: ProjectSprintProperties | null;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  program_id?: string | null;
  program_name?: string | null;
  program_prefix?: string | null;
  workspace_sprint_start_date?: Date | string | null;
  project_id?: string | null;
  project_name?: string | null;
  issue_count?: string | number | null;
  completed_count?: string | number | null;
  started_count?: string | number | null;
};

type ProjectIssueRow = {
  id: string;
  title: string;
  properties: {
    state?: string;
    priority?: string;
    assignee_id?: string | null;
  } | null;
  ticket_number: number | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  assignee_name: string | null;
};

type TipTapJsonContent = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: TipTapJsonContent[];
};

type TipTapJsonDoc = TipTapJsonContent & {
  content: TipTapJsonContent[];
};

type ProjectRetroProjectRow = Pick<ProjectRow, 'id' | 'title' | 'content' | 'properties'>;

type ProjectRetroSprintRow = {
  id: string;
  title: string;
  sprint_number: string | number | null;
};

type ProjectRetroIssueRow = {
  id: string;
  title: string;
  state: string | null;
};

// Helper to extract project from row with computed ice_score
function extractProjectFromRow(row: ProjectRow) {
  const props = row.properties || {};
  // ICE values can be null (not yet set) - don't default to 3
  const impact = props.impact !== undefined ? props.impact : null;
  const confidence = props.confidence !== undefined ? props.confidence : null;
  const ease = props.ease !== undefined ? props.ease : null;

  return {
    id: row.id,
    title: row.title,
    // ICE properties
    impact,
    confidence,
    ease,
    ice_score: computeICEScore(impact, confidence, ease),
    // Visual properties
    color: props.color || DEFAULT_PROJECT_PROPERTIES.color,
    emoji: props.emoji || null,
    // Associations
    program_id: row.program_id || null,
    // Timestamps
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Owner info
    owner: row.owner_name ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    // Counts
    sprint_count: parseInt(String(row.sprint_count || 0), 10) || 0,
    issue_count: parseInt(String(row.issue_count || 0), 10) || 0,
    // Completeness flags
    is_complete: props.is_complete ?? null,
    missing_fields: props.missing_fields ?? [],
    // Inferred status (computed from sprint relationships)
    inferred_status: row.inferred_status as InferredProjectStatus || 'backlog',
    // Conversion tracking
    converted_from_id: row.converted_from_id || null,
    // RACI fields
    owner_id: props.owner_id || null,
    accountable_id: props.accountable_id || null,
    consulted_ids: props.consulted_ids || [],
    informed_ids: props.informed_ids || [],
    // Hypothesis and approval tracking
    plan: props.plan || null,
    plan_approval: props.plan_approval || null,
    retro_approval: props.retro_approval || null,
    has_retro: props.has_retro ?? false,
    target_date: props.target_date || null,
    // Design review
    has_design_review: props.has_design_review ?? null,
    design_review_notes: props.design_review_notes || null,
  };
}

// Validation schemas
const iceScoreSchema = z.number().int().min(1).max(5);

const createProjectSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  impact: iceScoreSchema.optional().nullable().default(null),
  confidence: iceScoreSchema.optional().nullable().default(null),
  ease: iceScoreSchema.optional().nullable().default(null),
  owner_id: z.string().uuid().optional().nullable().default(null), // R - Responsible (does the work)
  accountable_id: z.string().uuid().optional().nullable().default(null), // A - Accountable (approver)
  consulted_ids: z.array(z.string().uuid()).optional().default([]), // C - Consulted (provide input)
  informed_ids: z.array(z.string().uuid()).optional().default([]), // I - Informed (kept in loop)
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  plan: z.string().max(2000).optional().nullable(),
  target_date: z.string().datetime().optional().nullable(),
});

const updateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  impact: iceScoreSchema.optional().nullable(),
  confidence: iceScoreSchema.optional().nullable(),
  ease: iceScoreSchema.optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(), // R - Responsible (can be cleared)
  accountable_id: z.string().uuid().optional().nullable(), // A - Accountable (can be cleared)
  consulted_ids: z.array(z.string().uuid()).optional(), // C - Consulted
  informed_ids: z.array(z.string().uuid()).optional(), // I - Informed
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  archived_at: z.string().datetime().optional().nullable(),
  plan: z.string().max(2000).optional().nullable(),
  target_date: z.string().datetime().optional().nullable(),
  has_design_review: z.boolean().optional().nullable(),
  design_review_notes: z.string().max(2000).optional().nullable(),
});

// Schema for project retro
const projectRetroSchema = z.object({
  plan_validated: z.boolean().nullable().optional(),
  monetary_impact_actual: z.string().max(500).nullable().optional(),
  success_criteria: z.array(z.string().max(500)).nullable().optional(),
  next_steps: z.string().max(2000).nullable().optional(),
  content: z.record(z.unknown()).optional(), // TipTap content for narrative
});

// Helper to generate pre-filled retro content for a project
async function generatePrefilledRetroContent(
  projectData: ProjectRetroProjectRow,
  sprints: ProjectRetroSprintRow[],
  issues: ProjectRetroIssueRow[]
) {
  const props = projectData.properties || {};

  // Categorize issues by state
  const completedIssues = issues.filter(i => i.state === 'done');
  const cancelledIssues = issues.filter(i => i.state === 'cancelled');
  const activeIssues = issues.filter(i => !['done', 'cancelled'].includes(i.state ?? ''));

  // Build TipTap content
  const content: TipTapJsonDoc = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Project Summary' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `Project: ${projectData.title}` },
        ],
      },
    ],
  };

  // Add ICE Score section
  const impact = props.impact ?? null;
  const confidence = props.confidence ?? null;
  const ease = props.ease ?? null;
  const iceScore = (impact !== null && confidence !== null && ease !== null)
    ? impact * confidence * ease
    : null;

  const formatIceValue = (val: number | null) => val !== null ? `${val}/5` : 'Not set';
  const formatIceScore = (val: number | null) => val !== null ? String(val) : 'Not set';

  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'ICE Scores' }],
  });
  content.content.push({
    type: 'bulletList',
    content: [
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Impact: ${formatIceValue(impact)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Confidence: ${formatIceValue(confidence)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Ease: ${formatIceValue(ease)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `ICE Score: ${formatIceScore(iceScore)}` }] }],
      },
    ],
  });

  // Add monetary impact expected if set
  if (props.monetary_impact_expected) {
    content.content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `Expected Impact: ${props.monetary_impact_expected}` }],
    });
  }

  // Add sprints section
  if (sprints.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Weeks (${sprints.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: sprints.map(s => ({
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: `Week ${s.sprint_number}: ${s.title}` }],
        }],
      })),
    });
  }

  // Add completed issues section
  if (completedIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Completed Issues (${completedIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: completedIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: i.title }] }],
      })),
    });
  }

  // Add active issues section if any remain
  if (activeIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Outstanding Issues (${activeIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: activeIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `${i.title} (${i.state})` }] }],
      })),
    });
  }

  // Add cancelled issues section if any
  if (cancelledIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Cancelled Issues (${cancelledIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: cancelledIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: i.title }] }],
      })),
    });
  }

  // Add plan validation section
  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Hypothesis Validation' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'Was the plan validated? (Set in properties)' }],
  });

  // Add monetary impact actual section
  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Actual Monetary Impact' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'Document the actual monetary impact here.' }],
  });

  // Add key learnings section
  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Key Learnings' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'What did we learn from this project?' }],
  });

  // Add next steps section
  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Next Steps' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'What follow-up actions are recommended?' }],
  });

  return content;
}

// Valid sort fields for projects
const VALID_SORT_FIELDS = ['ice_score', 'impact', 'confidence', 'ease', 'title', 'updated_at', 'created_at'];

// List projects (documents with document_type = 'project')
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.archived === 'true';
    const sortField = (req.query.sort as string) || 'ice_score';
    const sortDir = (req.query.dir as string) === 'asc' ? 'ASC' : 'DESC';
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Validate sort field to prevent SQL injection
    if (!VALID_SORT_FIELDS.includes(sortField)) {
      res.status(400).json({ error: `Invalid sort field. Valid fields: ${VALID_SORT_FIELDS.join(', ')}` });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Build ORDER BY clause - ice_score is computed, others are from properties or columns
    let orderByClause: string;
    if (sortField === 'ice_score') {
      // Compute ICE score: impact * confidence * ease
      orderByClause = `((COALESCE((d.properties->>'impact')::int, 3) * COALESCE((d.properties->>'confidence')::int, 3) * COALESCE((d.properties->>'ease')::int, 3))) ${sortDir}`;
    } else if (['impact', 'confidence', 'ease'].includes(sortField)) {
      orderByClause = `COALESCE((d.properties->>'${sortField}')::int, 3) ${sortDir}`;
    } else if (sortField === 'title') {
      orderByClause = `d.title ${sortDir}`;
    } else {
      orderByClause = `d.${sortField} ${sortDir}`;
    }

    // Subquery to compute inferred status based on sprint allocations
    // Priority: archived > completed (retro done) > active (current sprint allocation) > planned (future allocation) > backlog
    // Sprint timing is computed from sprint_number + workspace.sprint_start_date:
    //   - current: today is within the sprint's 7-day window
    //   - future: sprint hasn't started yet
    //   - past: sprint window has passed
    // Allocations are tracked via sprint documents with properties.project_id
    const inferredStatusSubquery = `
      CASE
        WHEN d.archived_at IS NOT NULL THEN 'archived'
        WHEN d.properties->>'plan_validated' IS NOT NULL THEN 'completed'
        ELSE COALESCE(
          (
            SELECT
              CASE MAX(
                CASE
                  -- Compute sprint timing: current=3, future=2, past=1
                  WHEN CURRENT_DATE BETWEEN
                    (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                    AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                  THEN 3  -- current sprint
                  WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                  THEN 2  -- future sprint
                  ELSE 1  -- past sprint
                END
              )
              WHEN 3 THEN 'active'
              WHEN 2 THEN 'planned'
              ELSE NULL  -- past allocations don't count
              END
            FROM documents sprint
            JOIN workspaces w ON w.id = sprint.workspace_id
            WHERE sprint.document_type = 'sprint'
              AND sprint.workspace_id = d.workspace_id
              AND (sprint.properties->>'project_id')::uuid = d.id
              AND jsonb_array_length(COALESCE(sprint.properties->'assignee_ids', '[]'::jsonb)) > 0
          ),
          'backlog'
        )
      END
    `;

    let query = `
      SELECT d.id, d.title, d.properties, prog_da.related_id as program_id, d.archived_at, d.created_at, d.updated_at,
             d.converted_from_id,
             (d.properties->>'owner_id')::uuid as owner_id,
             u.name as owner_name, u.email as owner_email,
             (SELECT COUNT(*) FROM documents s
              JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'project'
              WHERE s.document_type = 'sprint') as sprint_count,
             (SELECT COUNT(*) FROM documents i
              JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'project'
              WHERE i.document_type = 'issue') as issue_count,
             (${inferredStatusSubquery}) as inferred_status
      FROM documents d
      LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
      LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
      WHERE d.workspace_id = $1 AND d.document_type = 'project'
        AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
    `;
    const params: (string | boolean)[] = [workspaceId, userId, isAdmin];

    if (!includeArchived) {
      query += ` AND d.archived_at IS NULL`;
    }

    query += ` ORDER BY ${orderByClause}`;

    const result = await pool.query<ProjectRow>(query, params);
    res.json(result.rows.map(extractProjectFromRow));
  } catch (err) {
    sendInternalError(res, err, 'List projects error:');
  }
});

// Get single project
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Same inferred status subquery as list endpoint (allocation-based)
    const inferredStatusSubquery = `
      CASE
        WHEN d.archived_at IS NOT NULL THEN 'archived'
        WHEN d.properties->>'plan_validated' IS NOT NULL THEN 'completed'
        ELSE COALESCE(
          (
            SELECT
              CASE MAX(
                CASE
                  WHEN CURRENT_DATE BETWEEN
                    (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                    AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                  THEN 3  -- current sprint
                  WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                  THEN 2  -- future sprint
                  ELSE 1  -- past sprint
                END
              )
              WHEN 3 THEN 'active'
              WHEN 2 THEN 'planned'
              ELSE NULL  -- past allocations don't count
              END
            FROM documents sprint
            JOIN workspaces w ON w.id = sprint.workspace_id
            WHERE sprint.document_type = 'sprint'
              AND sprint.workspace_id = d.workspace_id
              AND (sprint.properties->>'project_id')::uuid = d.id
              AND jsonb_array_length(COALESCE(sprint.properties->'assignee_ids', '[]'::jsonb)) > 0
          ),
          'backlog'
        )
      END
    `;

    const result = await pool.query<ProjectRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id, d.archived_at, d.created_at, d.updated_at,
              d.converted_to_id, d.converted_from_id,
              (d.properties->>'owner_id')::uuid as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents s
               JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'project'
               WHERE s.document_type = 'sprint') as sprint_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'project'
               WHERE i.document_type = 'issue') as issue_count,
              (${inferredStatusSubquery}) as inferred_status
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Check if project was converted - redirect to new document
    if (row.converted_to_id) {
      // Fetch the new document to determine its type for proper routing
      const newDocResult = await pool.query(
        'SELECT id, document_type FROM documents WHERE id = $1 AND workspace_id = $2',
        [row.converted_to_id, workspaceId]
      );

      if (newDocResult.rows.length > 0) {
        const newDoc = newDocResult.rows[0];
        // Return 301 with Location header to the new document's API endpoint
        // Include X-Converted-Type header so frontend knows the target type for routing
        res.set('X-Converted-Type', newDoc.document_type);
        res.set('X-Converted-To', newDoc.id);
        res.redirect(301, `/api/${newDoc.document_type}s/${newDoc.id}`);
        return;
      }
    }

    res.json(extractProjectFromRow(row));
  } catch (err) {
    sendInternalError(res, err, 'Get project error:');
  }
});

// Create project (creates a document with document_type = 'project')
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { title, impact, confidence, ease, owner_id, accountable_id, consulted_ids, informed_ids, color, emoji, program_id, plan, target_date } = parsed.data;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Build properties JSONB with RACI fields
    const properties: Record<string, unknown> = {
      impact,
      confidence,
      ease,
      owner_id, // R - Responsible
      accountable_id, // A - Accountable
      consulted_ids, // C - Consulted
      informed_ids, // I - Informed
      color,
    };
    if (emoji) {
      properties.emoji = emoji;
    }
    if (plan) {
      properties.plan = plan;
    }
    if (target_date) {
      properties.target_date = target_date;
    }

    // Calculate completeness for new project (no linked issues yet)
    const completeness = checkDocumentCompleteness('project', properties, 0);
    properties.is_complete = completeness.isComplete;
    properties.missing_fields = completeness.missingFields;

    const result = await pool.query<ProjectRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'project', $2, $3, $4)
       RETURNING id, title, properties, archived_at, created_at, updated_at`,
      [workspaceId, title, JSON.stringify(properties), userId]
    );

    const createdProject = result.rows[0];
    if (!createdProject) {
      throw new Error('Create project did not return a row');
    }

    if (program_id) {
      await syncProgramAssociation(createdProject.id, program_id);
    }

    // Get user info for owner response (only if owner_id is set)
    let owner = null;
    if (owner_id) {
      const userResult = await pool.query(
        'SELECT id, name, email FROM users WHERE id = $1',
        [owner_id]
      );
      const user = userResult.rows[0];
      if (user) {
        owner = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }

    res.status(201).json({
      ...extractProjectFromRow({ ...createdProject, program_id: program_id || null, inferred_status: 'backlog' }),
      sprint_count: 0,
      issue_count: 0,
      owner,
    });
  } catch (err) {
    sendInternalError(res, err, 'Create project error:');
  }
});

// Update project
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (typeof id !== 'string') {
      res.status(400).json({ error: 'Invalid project id' });
      return;
    }
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const currentProps = existing.rows[0].properties || {};
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const data = parsed.data;

    // Handle title update (regular column)
    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }

    // Note: program_id is handled via document_associations after main update

    // Handle properties updates
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.impact !== undefined) {
      newProps.impact = data.impact;
      propsChanged = true;
    }

    if (data.confidence !== undefined) {
      newProps.confidence = data.confidence;
      propsChanged = true;
    }

    if (data.ease !== undefined) {
      newProps.ease = data.ease;
      propsChanged = true;
    }

    if (data.owner_id !== undefined) {
      newProps.owner_id = data.owner_id;
      propsChanged = true;
    }

    if (data.accountable_id !== undefined) {
      newProps.accountable_id = data.accountable_id;
      propsChanged = true;
    }

    if (data.consulted_ids !== undefined) {
      newProps.consulted_ids = data.consulted_ids;
      propsChanged = true;
    }

    if (data.informed_ids !== undefined) {
      newProps.informed_ids = data.informed_ids;
      propsChanged = true;
    }

    if (data.color !== undefined) {
      newProps.color = data.color;
      propsChanged = true;
    }

    if (data.emoji !== undefined) {
      newProps.emoji = data.emoji;
      propsChanged = true;
    }

    if (data.plan !== undefined) {
      newProps.plan = data.plan;
      propsChanged = true;

      if (data.plan !== currentProps.plan) {
        Object.assign(
          newProps,
          applyChangedSinceApprovedOnEdit(
            newProps,
            'plan_approval',
            asApprovalRecord(currentProps.plan_approval),
            true,
          ),
        );
      }
    }

    if (data.target_date !== undefined) {
      newProps.target_date = data.target_date;
      propsChanged = true;
    }

    if (data.has_design_review !== undefined) {
      newProps.has_design_review = data.has_design_review;
      propsChanged = true;
    }

    if (data.design_review_notes !== undefined) {
      newProps.design_review_notes = data.design_review_notes;
      propsChanged = true;
    }

    if (propsChanged) {
      // Recalculate completeness when properties change
      const completeness = checkDocumentCompleteness('project', newProps, 0);
      newProps.is_complete = completeness.isComplete;
      newProps.missing_fields = completeness.missingFields;

      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    // Handle archived_at (regular column)
    if (data.archived_at !== undefined) {
      updates.push(`archived_at = $${paramIndex++}`);
      values.push(data.archived_at);
    }

    if (updates.length === 0 && data.program_id === undefined) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    if (updates.length > 0) {
      updates.push(`updated_at = now()`);

      await pool.query(
        `UPDATE documents SET ${updates.join(', ')}
         WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'project'`,
        [...values, id, workspaceId]
      );
    }

    // Broadcast celebration when plan is added
    if (data.plan && data.plan.trim() !== '') {
      broadcastToUser(userId, 'accountability:updated', { type: 'project_plan', targetId: id as string });
    }

    // Log plan changes to document_history for approval workflow tracking
    if (data.plan !== undefined && data.plan !== currentProps.plan) {
      await logDocumentChange(
        id as string,
        'plan',
        currentProps.plan || null,
        data.plan || null,
        userId
      );
    }

    if (data.program_id !== undefined) {
      await syncProgramAssociation(id, data.program_id ?? null);
    }

    // Re-query to get full project with owner info and inferred status (allocation-based)
    const updateInferredStatusSubquery = `
      CASE
        WHEN d.archived_at IS NOT NULL THEN 'archived'
        WHEN d.properties->>'plan_validated' IS NOT NULL THEN 'completed'
        ELSE COALESCE(
          (
            SELECT
              CASE MAX(
                CASE
                  WHEN CURRENT_DATE BETWEEN
                    (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                    AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                  THEN 3  -- current sprint
                  WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                  THEN 2  -- future sprint
                  ELSE 1  -- past sprint
                END
              )
              WHEN 3 THEN 'active'
              WHEN 2 THEN 'planned'
              ELSE NULL  -- past allocations don't count
              END
            FROM documents sprint
            JOIN workspaces w ON w.id = sprint.workspace_id
            WHERE sprint.document_type = 'sprint'
              AND sprint.workspace_id = d.workspace_id
              AND (sprint.properties->>'project_id')::uuid = d.id
              AND jsonb_array_length(COALESCE(sprint.properties->'assignee_ids', '[]'::jsonb)) > 0
          ),
          'backlog'
        )
      END
    `;

    const result = await pool.query<ProjectRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id, d.archived_at, d.created_at, d.updated_at,
              d.converted_from_id,
              (d.properties->>'owner_id')::uuid as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents s
               JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'project'
               WHERE s.document_type = 'sprint') as sprint_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'project'
               WHERE i.document_type = 'issue') as issue_count,
              (${updateInferredStatusSubquery}) as inferred_status
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       WHERE d.id = $1 AND d.document_type = 'project'`,
      [id]
    );

    const updatedProject = result.rows[0];
    if (!updatedProject) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(extractProjectFromRow(updatedProject));
  } catch (err) {
    sendInternalError(res, err, 'Update project error:');
  }
});

// Delete project
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // First verify user can access the project
    const accessCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (accessCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Remove project associations from child documents via junction table
    await pool.query(
      `DELETE FROM document_associations WHERE related_id = $1 AND relationship_type = 'project'`,
      [id]
    );

    // Now delete it
    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'`,
      [id, workspaceId]
    );

    res.status(204).send();
  } catch (err) {
    sendInternalError(res, err, 'Delete project error:');
  }
});

// GET /api/projects/:id/retro - Returns pre-filled draft or existing retro
router.get('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get project
    const projectResult = await pool.query<ProjectRetroProjectRow>(
      `SELECT id, title, content, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    const projectData = projectResult.rows.at(0);
    if (!projectData) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const props = projectData.properties || {};

    // Check if retro has been filled (has plan_validated set)
    const hasRetro = props.plan_validated !== undefined && props.plan_validated !== null;

    // Get sprints for this project via junction table
    const sprintsResult = await pool.query<ProjectRetroSprintRow>(
      `SELECT d.id, d.title, d.properties->>'sprint_number' as sprint_number
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
       WHERE d.document_type = 'sprint'
       ORDER BY (d.properties->>'sprint_number')::int ASC`,
      [id]
    );

    // Get issues for this project via junction table
    const issuesResult = await pool.query<ProjectRetroIssueRow>(
      `SELECT d.id, d.title, d.properties->>'state' as state
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id
         AND da.related_id = $1 AND da.relationship_type = 'project'
       WHERE d.document_type = 'issue'
         AND d.archived_at IS NULL AND d.deleted_at IS NULL`,
      [id]
    );

    if (hasRetro) {
      // Return existing retro data
      res.json({
        is_draft: false,
        plan_validated: props.plan_validated,
        monetary_impact_expected: props.monetary_impact_expected || null,
        monetary_impact_actual: props.monetary_impact_actual || null,
        success_criteria: props.success_criteria || [],
        next_steps: props.next_steps || null,
        content: projectData.content || {},
        weeks: sprintsResult.rows,
        issues_summary: {
          total: issuesResult.rows.length,
          completed: issuesResult.rows.filter(i => i.state === 'done').length,
          cancelled: issuesResult.rows.filter(i => i.state === 'cancelled').length,
          active: issuesResult.rows.filter(i => !['done', 'cancelled'].includes(i.state ?? '')).length,
        },
      });
    } else {
      // Generate pre-filled draft
      const prefilledContent = await generatePrefilledRetroContent(
        projectData,
        sprintsResult.rows,
        issuesResult.rows
      );

      res.json({
        is_draft: true,
        plan_validated: null,
        monetary_impact_expected: props.monetary_impact_expected || null,
        monetary_impact_actual: null,
        success_criteria: [],
        next_steps: null,
        content: prefilledContent,
        weeks: sprintsResult.rows,
        issues_summary: {
          total: issuesResult.rows.length,
          completed: issuesResult.rows.filter(i => i.state === 'done').length,
          cancelled: issuesResult.rows.filter(i => i.state === 'cancelled').length,
          active: issuesResult.rows.filter(i => !['done', 'cancelled'].includes(i.state ?? '')).length,
        },
      });
    }
  } catch (err) {
    sendInternalError(res, err, 'Get project retro error:');
  }
});

// POST /api/projects/:id/retro - Creates finalized project retro
router.post('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = projectRetroSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const currentProps = existing.rows[0].properties || {};
    const { plan_validated, monetary_impact_actual, success_criteria, next_steps, content } = parsed.data;

    // Update properties with retro data
    const newProps = {
      ...currentProps,
      plan_validated: plan_validated ?? currentProps.plan_validated,
      monetary_impact_actual: monetary_impact_actual ?? currentProps.monetary_impact_actual,
      success_criteria: success_criteria ?? currentProps.success_criteria,
      next_steps: next_steps ?? currentProps.next_steps,
    };

    // Update project with retro properties and optional content
    const updates: string[] = ['properties = $1', 'updated_at = now()'];
    const values: unknown[] = [JSON.stringify(newProps)];

    if (content) {
      updates.push('content = $2');
      values.push(JSON.stringify(content));
    }

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${values.length + 1} AND workspace_id = $${values.length + 2} AND document_type = 'project'`,
      [...values, id, workspaceId]
    );

    // Broadcast celebration when project retro is completed
    broadcastToUser(userId, 'accountability:updated', { type: 'project_retro', targetId: id as string });

    // Log initial retro content to document_history for approval workflow tracking
    if (content) {
      await logDocumentChange(
        id as string,
        'retro_content',
        null,
        JSON.stringify(content),
        userId
      );
    }

    // Re-query to get updated data
    const result = await pool.query<ProjectRow>(
      `SELECT id, title, content, properties FROM documents WHERE id = $1`,
      [id]
    );

    const updatedRow = result.rows[0];
    if (!updatedRow) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const updatedProps = updatedRow.properties || {};
    res.status(201).json({
      is_draft: false,
      plan_validated: updatedProps.plan_validated,
      monetary_impact_expected: updatedProps.monetary_impact_expected || null,
      monetary_impact_actual: updatedProps.monetary_impact_actual || null,
      success_criteria: updatedProps.success_criteria || [],
      next_steps: updatedProps.next_steps || null,
      content: updatedRow.content || {},
    });
  } catch (err) {
    sendInternalError(res, err, 'Create project retro error:');
  }
});

// ============================================
// Sprint Endpoints - Sprints under projects
// ============================================

// Schema for creating a sprint under a project
const createProjectSprintSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  sprint_number: z.number().int().positive().optional(), // Auto-incremented if not provided
  owner_id: z.string().uuid().optional(),
  plan: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

// Helper to extract sprint from row (matches sprints.ts pattern)
function extractSprintFromRow(row: ProjectSprintRow) {
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
    project_id: row.project_id || null,
    project_name: row.project_name || null,
    program_id: row.program_id,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    workspace_sprint_start_date: row.workspace_sprint_start_date,
    issue_count: parseInt(String(row.issue_count || 0), 10) || 0,
    completed_count: parseInt(String(row.completed_count || 0), 10) || 0,
    started_count: parseInt(String(row.started_count || 0), 10) || 0,
    plan: props.plan || null,
    success_criteria: props.success_criteria || null,
    confidence: typeof props.confidence === 'number' ? props.confidence : null,
  };
}

// GET /api/projects/:id/issues - List issues for a project
router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const projectCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get issues associated with this project via junction table
    const result = await pool.query<ProjectIssueRow>(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at,
              d.started_at, d.completed_at, d.cancelled_at,
              u.name as assignee_name
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id
         AND da.related_id = $1 AND da.relationship_type = 'project'
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       WHERE d.workspace_id = $2 AND d.document_type = 'issue'
         AND d.archived_at IS NULL AND d.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id, workspaceId, userId, isAdmin]
    );

    // Transform rows to issue objects
    const issues = result.rows.map(row => {
      const props = row.properties || {};
      return {
        id: row.id,
        title: row.title,
        ticket_number: row.ticket_number,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        assignee_name: row.assignee_name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
        cancelled_at: row.cancelled_at,
      };
    });

    res.json(issues);
  } catch (err) {
    sendInternalError(res, err, 'Get project issues error:');
  }
});

// GET /api/projects/:id/weeks - List weeks (sprints) for a project
// Note: "weeks" is the user-facing terminology, "sprints" is internal
router.get('/:id/weeks', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const projectCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get sprints associated with this project via junction table
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              w.sprint_start_date as workspace_sprint_start_date,
              proj.id as project_id, proj.title as project_name,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       LEFT JOIN documents proj ON proj.id = $1
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY (d.properties->>'sprint_number')::int DESC`,
      [id, workspaceId, userId, isAdmin]
    );

    res.json(result.rows.map(extractSprintFromRow));
  } catch (err) {
    sendInternalError(res, err, 'Get project weeks error:');
  }
});

// GET /api/projects/:id/sprints - List sprints for a project (deprecated, use /weeks)
router.get('/:id/sprints', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const projectCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get sprints associated with this project via junction table
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              w.sprint_start_date as workspace_sprint_start_date,
              proj.id as project_id, proj.title as project_name,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       LEFT JOIN documents proj ON proj.id = $1
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY (d.properties->>'sprint_number')::int DESC`,
      [id, workspaceId, userId, isAdmin]
    );

    res.json(result.rows.map(extractSprintFromRow));
  } catch (err) {
    sendInternalError(res, err, 'Get project sprints error:');
  }
});

// POST /api/projects/:id/sprints - Create a sprint associated with a project
router.post('/:id/sprints', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = createProjectSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists, user can access it, and get workspace info
    const projectCheck = await pool.query(
      `SELECT d.id, prog_da.related_id as program_id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const project = projectCheck.rows[0];
    const { title, owner_id, plan, success_criteria, confidence } = parsed.data;
    let { sprint_number } = parsed.data;

    // If sprint_number not provided, auto-increment based on project's existing sprints
    if (!sprint_number) {
      const maxSprintResult = await pool.query(
        `SELECT MAX((d.properties->>'sprint_number')::int) as max_sprint
         FROM documents d
         JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
         WHERE d.document_type = 'sprint'`,
        [id]
      );
      sprint_number = (maxSprintResult.rows[0]?.max_sprint || 0) + 1;
    }

    // Check if sprint number already exists for this project
    const existingCheck = await pool.query(
      `SELECT d.id FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
       WHERE d.document_type = 'sprint' AND (d.properties->>'sprint_number')::int = $2`,
      [id, sprint_number]
    );

    if (existingCheck.rows.length > 0) {
      res.status(400).json({ error: `Week ${sprint_number} already exists for this project` });
      return;
    }

    // Verify owner exists in workspace (if provided)
    let ownerData = null;
    if (owner_id) {
      const ownerCheck = await pool.query(
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

    // Build properties JSONB
    const properties: Record<string, unknown> = { sprint_number };
    if (owner_id) properties.owner_id = owner_id;
    if (plan) {
      properties.plan = plan;
      properties.plan_history = [{
        plan,
        timestamp: new Date().toISOString(),
        author_id: userId,
      }];
    }
    if (success_criteria) properties.success_criteria = success_criteria;
    if (confidence !== undefined) properties.confidence = confidence;

    // Default TipTap content for new sprints with Hypothesis and Success Criteria headings
    const defaultContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Hypothesis' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'What do we believe will happen? What are we trying to learn or prove?' }]
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Success Criteria' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'How will we know if the plan is validated? What metrics or outcomes will we measure?' }]
        }
      ]
    };

    // Create the sprint document
    // program_id is set via document_associations below (not directly on documents table)
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, content)
       VALUES ($1, 'sprint', $2, $3, $4, $5)
       RETURNING id, title, properties`,
      [workspaceId, title, JSON.stringify(properties), userId, JSON.stringify(defaultContent)]
    );

    const sprint = result.rows[0];

    // Create association in junction table for project
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
       VALUES ($1, $2, 'project', $3)
       ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
      [sprint.id, id, JSON.stringify({ created_via: 'POST /api/projects/:id/sprints' })]
    );

    // Create association in junction table for program (if project has one)
    if (project.program_id) {
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')
         ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
        [sprint.id, project.program_id]
      );
    }

    res.status(201).json({
      id: sprint.id,
      name: sprint.title,
      sprint_number,
      owner: ownerData ? {
        id: ownerData.id,
        name: ownerData.name,
        email: ownerData.email,
      } : null,
      project_id: id,
      program_id: project.program_id,
      workspace_sprint_start_date: project.sprint_start_date,
      issue_count: 0,
      completed_count: 0,
      started_count: 0,
      plan: properties.plan || null,
      success_criteria: properties.success_criteria || null,
      confidence: properties.confidence ?? null,
    });
  } catch (err) {
    sendInternalError(res, err, 'Create project sprint error:');
  }
});

// PATCH /api/projects/:id/retro - Updates existing project retro
router.patch('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = projectRetroSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties, content FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const currentProps = existing.rows[0].properties || {};
    const currentContent = existing.rows[0].content;
    const { plan_validated, monetary_impact_actual, success_criteria, next_steps, content } = parsed.data;

    // Update properties with retro data (only update fields that are provided)
    const newProps = { ...currentProps };
    if (plan_validated !== undefined) {
      newProps.plan_validated = plan_validated;
    }
    if (monetary_impact_actual !== undefined) {
      newProps.monetary_impact_actual = monetary_impact_actual;
    }
    if (success_criteria !== undefined) {
      newProps.success_criteria = success_criteria;
    }
    if (next_steps !== undefined) {
      newProps.next_steps = next_steps;
    }

    // If any retro fields changed and was previously approved, transition to 'changed_since_approved'
    const retroFieldsChanged = plan_validated !== undefined ||
      monetary_impact_actual !== undefined ||
      success_criteria !== undefined ||
      next_steps !== undefined ||
      content !== undefined;

    Object.assign(
      newProps,
      applyChangedSinceApprovedOnEdit(
        newProps,
        'retro_approval',
        asApprovalRecord(currentProps.retro_approval),
        retroFieldsChanged,
      ),
    );

    // Update project with retro properties and optional content
    const updates: string[] = ['properties = $1', 'updated_at = now()'];
    const values: unknown[] = [JSON.stringify(newProps)];

    if (content !== undefined) {
      updates.push('content = $2');
      values.push(JSON.stringify(content));
    }

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${values.length + 1} AND workspace_id = $${values.length + 2} AND document_type = 'project'`,
      [...values, id, workspaceId]
    );

    // Log retro content changes to document_history for approval workflow tracking
    if (content !== undefined) {
      const oldContent = currentContent ? JSON.stringify(currentContent) : null;
      const newContent = JSON.stringify(content);
      if (oldContent !== newContent) {
        await logDocumentChange(
          id as string,
          'retro_content',
          oldContent,
          newContent,
          userId
        );
      }
    }

    // Re-query to get updated data
    const result = await pool.query(
      `SELECT id, title, content, properties FROM documents WHERE id = $1`,
      [id]
    );

    const updatedProps = result.rows[0].properties || {};
    res.json({
      is_draft: false,
      plan_validated: updatedProps.plan_validated,
      monetary_impact_expected: updatedProps.monetary_impact_expected || null,
      monetary_impact_actual: updatedProps.monetary_impact_actual || null,
      success_criteria: updatedProps.success_criteria || [],
      next_steps: updatedProps.next_steps || null,
      content: result.rows[0].content || {},
    });
  } catch (err) {
    sendInternalError(res, err, 'Update project retro error:');
  }
});

// POST /api/projects/:id/approve-plan - Approve project plan
router.post('/:id/approve-plan', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for admin check
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and get its properties
    const projectResult = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const project = projectResult.rows[0];
    const currentProps = project.properties || {};
    const auth = checkProjectAccountableAuth(currentProps.accountable_id, userId, isAdmin, 'plans');
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const versionId = await resolveApprovedVersionId(id as string, 'plan');
    const planApproval = buildApprovedApprovalRecord(userId, versionId);
    const newProps = {
      ...currentProps,
      plan_approval: planApproval,
    };

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND document_type = 'project'`,
      [JSON.stringify(newProps), id]
    );

    res.json({
      success: true,
      approval: newProps.plan_approval,
    });
  } catch (err) {
    sendInternalError(res, err, 'Approve project plan error:');
  }
});

// POST /api/projects/:id/approve-retro - Approve project retro
router.post('/:id/approve-retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for admin check
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and get its properties
    const projectResult = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const project = projectResult.rows[0];
    const currentProps = project.properties || {};
    const auth = checkProjectAccountableAuth(currentProps.accountable_id, userId, isAdmin, 'retros');
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const versionId = await resolveApprovedVersionId(id as string, 'retro_content');
    const retroApproval = buildApprovedApprovalRecord(userId, versionId);
    const newProps = {
      ...currentProps,
      retro_approval: retroApproval,
    };

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND document_type = 'project'`,
      [JSON.stringify(newProps), id]
    );

    res.json({
      success: true,
      approval: newProps.retro_approval,
    });
  } catch (err) {
    sendInternalError(res, err, 'Approve project retro error:');
  }
});

export default router;
