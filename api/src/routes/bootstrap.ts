import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { checkMissingAccountability } from '../services/accountability.js';
import { computeICEScore, DEFAULT_PROJECT_PROPERTIES, type IssueProperties, type ProjectProperties } from '@ship/shared';
import { getBelongsToAssociationsBatch } from '../utils/document-crud.js';

const router = Router();

type DocumentListRow = {
  id: string;
  workspace_id: string;
  document_type: string;
  title: string;
  parent_id: string | null;
  position: number | null;
  ticket_number: number | null;
  properties: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: 'private' | 'workspace';
};

type ProgramRow = {
  id: string;
  title: string;
  properties: {
    color?: string;
    emoji?: string | null;
    owner_id?: string | null;
    accountable_id?: string | null;
    consulted_ids?: string[];
    informed_ids?: string[];
  } | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  issue_count?: string | number | null;
  sprint_count?: string | number | null;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
};

type ProjectRow = {
  id: string;
  title: string;
  properties: (Partial<ProjectProperties> & {
    is_complete?: boolean | null;
    missing_fields?: string[];
    plan?: string | null;
    has_retro?: boolean;
    target_date?: string | null;
  }) | null;
  program_id?: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  sprint_count?: string | number | null;
  issue_count?: string | number | null;
  inferred_status?: 'active' | 'planned' | 'completed' | 'backlog' | 'archived' | null;
  converted_from_id?: string | null;
};

type IssueRow = {
  id: string;
  title: string;
  properties: IssueProperties | null;
  ticket_number: number | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  started_at?: Date | null;
  completed_at?: Date | null;
  cancelled_at?: Date | null;
  reopened_at?: Date | null;
  converted_from_id?: string | null;
  assignee_name?: string | null;
  assignee_archived?: boolean | null;
};

function mapProgram(row: ProgramRow) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    color: props.color || '#6366f1',
    emoji: props.emoji || null,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    issue_count: row.issue_count,
    sprint_count: row.sprint_count,
    owner: row.owner_name ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    owner_id: props.owner_id || null,
    accountable_id: props.accountable_id || null,
    consulted_ids: props.consulted_ids || [],
    informed_ids: props.informed_ids || [],
  };
}

function mapProject(row: ProjectRow) {
  const props = row.properties || {};
  const impact = props.impact !== undefined ? props.impact : null;
  const confidence = props.confidence !== undefined ? props.confidence : null;
  const ease = props.ease !== undefined ? props.ease : null;

  return {
    id: row.id,
    title: row.title,
    impact,
    confidence,
    ease,
    ice_score: computeICEScore(impact, confidence, ease),
    color: props.color || DEFAULT_PROJECT_PROPERTIES.color,
    emoji: props.emoji || null,
    program_id: row.program_id || null,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    owner: row.owner_name ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    sprint_count: parseInt(String(row.sprint_count || 0), 10) || 0,
    issue_count: parseInt(String(row.issue_count || 0), 10) || 0,
    is_complete: props.is_complete ?? null,
    missing_fields: props.missing_fields ?? [],
    inferred_status: row.inferred_status || 'backlog',
    converted_from_id: row.converted_from_id || null,
    owner_id: props.owner_id || null,
    accountable_id: props.accountable_id || null,
    consulted_ids: props.consulted_ids || [],
    informed_ids: props.informed_ids || [],
    plan: props.plan || null,
    plan_approval: props.plan_approval || null,
    retro_approval: props.retro_approval || null,
    has_retro: props.has_retro ?? false,
    target_date: props.target_date || null,
    has_design_review: props.has_design_review ?? null,
    design_review_notes: props.design_review_notes || null,
  };
}

function mapIssue(row: IssueRow) {
  const props: Partial<IssueProperties> = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    source: props.source || 'internal',
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(props.estimate !== undefined && props.estimate !== null ? { estimate: props.estimate } : {}),
    ...(row.assignee_name ? { assignee_name: row.assignee_name } : {}),
    ...(props.assignee_id ? { assignee_id: props.assignee_id } : {}),
    ...(row.ticket_number !== null ? { ticket_number: row.ticket_number, display_id: `#${row.ticket_number}` } : {}),
    ...(row.assignee_archived ? { assignee_archived: true } : {}),
    ...(props.rejection_reason ? { rejection_reason: props.rejection_reason } : {}),
    ...(props.due_date ? { due_date: props.due_date } : {}),
    ...(props.is_system_generated ? { is_system_generated: true } : {}),
    ...(props.accountability_target_id ? { accountability_target_id: props.accountability_target_id } : {}),
    ...(props.accountability_type ? { accountability_type: props.accountability_type } : {}),
    ...(row.started_at ? { started_at: row.started_at } : {}),
    ...(row.completed_at ? { completed_at: row.completed_at } : {}),
    ...(row.cancelled_at ? { cancelled_at: row.cancelled_at } : {}),
    ...(row.reopened_at ? { reopened_at: row.reopened_at } : {}),
    ...(row.converted_from_id ? { converted_from_id: row.converted_from_id } : {}),
  };
}

function toAccountabilityResponse(missingItems: Awaited<ReturnType<typeof checkMissingAccountability>>) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const items = missingItems.map((item) => {
    let daysOverdue = -999;

    if (item.dueDate) {
      const dueDate = new Date(`${item.dueDate}T00:00:00Z`);
      daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    } else if (item.type === 'changes_requested_plan' || item.type === 'changes_requested_retro') {
      daysOverdue = 0;
    }

    return {
      id: `${item.type}-${item.targetId}`,
      title: item.message,
      state: 'todo',
      priority: 'high',
      ticket_number: 0,
      display_id: '',
      is_system_generated: true,
      accountability_type: item.type,
      accountability_target_id: item.targetId,
      target_title: item.targetTitle,
      due_date: item.dueDate,
      days_overdue: daysOverdue,
      person_id: item.personId || null,
      project_id: item.projectId || null,
      week_number: item.weekNumber || null,
    };
  });

  items.sort((a, b) => {
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    if (a.due_date && b.due_date) return b.days_overdue - a.days_overdue;
    return 0;
  });

  return {
    items,
    total: items.length,
    has_overdue: items.some(item => item.days_overdue > 0),
    has_due_today: items.some(item => item.days_overdue === 0),
  };
}

router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    const inferredProjectStatusSubquery = `
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
                  THEN 3
                  WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                  THEN 2
                  ELSE 1
                END
              )
              WHEN 3 THEN 'active'
              WHEN 2 THEN 'planned'
              ELSE NULL
              END
            FROM documents sprint
            JOIN workspaces w ON w.id = sprint.workspace_id
            JOIN document_associations project_da ON project_da.document_id = sprint.id
              AND project_da.relationship_type = 'project'
              AND project_da.related_id = d.id
            WHERE sprint.document_type = 'sprint'
              AND sprint.workspace_id = d.workspace_id
              AND jsonb_array_length(COALESCE(sprint.properties->'assignee_ids', '[]'::jsonb)) > 0
          ),
          'backlog'
        )
      END
    `;

    const [
      userResult,
      workspacesResult,
      currentWorkspaceResult,
      documentsResult,
      programsResult,
      projectsResult,
      issuesResult,
      workspaceResult,
      accountabilityItems,
    ] = await Promise.all([
      pool.query('SELECT id, email, name, is_super_admin FROM users WHERE id = $1', [userId]),
      pool.query(
        `SELECT w.id, w.name, wm.role
         FROM workspaces w
         JOIN workspace_memberships wm ON w.id = wm.workspace_id
         WHERE wm.user_id = $1 AND w.archived_at IS NULL
         ORDER BY w.name`,
        [userId]
      ),
      pool.query(
        `SELECT w.id, w.name, wm.role
         FROM workspaces w
         LEFT JOIN workspace_memberships wm ON w.id = wm.workspace_id AND wm.user_id = $2
         WHERE w.id = $1`,
        [workspaceId, userId]
      ),
      pool.query<DocumentListRow>(
        `SELECT id, workspace_id, document_type, title, parent_id, position,
                ticket_number, properties, created_at, updated_at, created_by, visibility
         FROM documents
         WHERE workspace_id = $1
           AND document_type = 'wiki'
           AND archived_at IS NULL
           AND deleted_at IS NULL
           AND (visibility = 'workspace' OR created_by = $2 OR $3 = TRUE)
         ORDER BY position ASC, created_at ASC`,
        [workspaceId, userId, isAdmin]
      ),
      pool.query<ProgramRow>(
        `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
                COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
                u.name as owner_name, u.email as owner_email,
                (SELECT COUNT(*) FROM documents i
                 JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'program'
                 WHERE i.document_type = 'issue') as issue_count,
                (SELECT COUNT(*) FROM documents s
                 JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'program'
                 WHERE s.document_type = 'sprint') as sprint_count
         FROM documents d
         LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
         WHERE d.workspace_id = $1 AND d.document_type = 'program'
           AND d.archived_at IS NULL
           AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
         ORDER BY d.created_at DESC`,
        [workspaceId, userId, isAdmin]
      ),
      pool.query<ProjectRow>(
        `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
                d.archived_at, d.created_at, d.updated_at, d.converted_from_id,
                (d.properties->>'owner_id')::uuid as owner_id,
                u.name as owner_name, u.email as owner_email,
                (SELECT COUNT(*) FROM documents s
                 JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'project'
                 WHERE s.document_type = 'sprint') as sprint_count,
                (SELECT COUNT(*) FROM documents i
                 JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'project'
                 WHERE i.document_type = 'issue') as issue_count,
                (${inferredProjectStatusSubquery}) as inferred_status
         FROM documents d
         LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
         LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
         WHERE d.workspace_id = $1 AND d.document_type = 'project'
           AND d.archived_at IS NULL
           AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
         ORDER BY ((COALESCE((d.properties->>'impact')::int, 3) * COALESCE((d.properties->>'confidence')::int, 3) * COALESCE((d.properties->>'ease')::int, 3))) DESC`,
        [workspaceId, userId, isAdmin]
      ),
      pool.query<IssueRow>(
        `SELECT d.id, d.title, d.properties, d.ticket_number,
                d.created_at, d.updated_at, d.created_by,
                d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
                d.converted_from_id,
                u.name as assignee_name,
                CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived
         FROM documents d
         LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
         LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
           AND person_doc.document_type = 'person'
           AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
         WHERE d.workspace_id = $1 AND d.document_type = 'issue'
           AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
           AND d.archived_at IS NULL
           AND d.deleted_at IS NULL
         ORDER BY
           CASE d.properties->>'priority'
             WHEN 'urgent' THEN 1
             WHEN 'high' THEN 2
             WHEN 'medium' THEN 3
             WHEN 'low' THEN 4
             ELSE 5
           END,
           d.updated_at DESC`,
        [workspaceId, userId, isAdmin]
      ),
      pool.query('SELECT sprint_start_date FROM workspaces WHERE id = $1', [workspaceId]),
      checkMissingAccountability(userId, workspaceId),
    ]);

    const user = userResult.rows[0];
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }

    const currentWorkspaceRow = currentWorkspaceResult.rows[0];
    const currentWorkspace = currentWorkspaceRow ? {
      id: currentWorkspaceRow.id,
      name: currentWorkspaceRow.name,
      role: currentWorkspaceRow.role || 'admin',
    } : null;

    const issueIds = issuesResult.rows.map(row => row.id);
    const associationsMap = await getBelongsToAssociationsBatch(issueIds);
    const issues = issuesResult.rows.map(row => ({
      ...mapIssue(row),
      belongs_to: associationsMap.get(row.id) || [],
    }));

    const rawStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const workspaceStartDate = rawStartDate instanceof Date
      ? new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()))
      : typeof rawStartDate === 'string'
        ? new Date(`${rawStartDate}T00:00:00Z`)
        : new Date();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const currentSprintNumber = Math.floor(
      Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24)) / 7
    ) + 1;

    const activeSprintsResult = await pool.query(
      `SELECT DISTINCT s.id as sprint_id
       FROM documents i
       JOIN document_associations da ON da.document_id = i.id AND da.relationship_type = 'sprint'
       JOIN documents s ON s.id = da.related_id AND s.document_type = 'sprint'
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.archived_at IS NULL
         AND i.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('i', '$4', '$5')}
         AND (i.properties->>'assignee_id')::uuid = $2
         AND (s.properties->>'sprint_number')::int = $3`,
      [workspaceId, userId, currentSprintNumber, userId, isAdmin]
    );

    let standupStatus = { due: false, lastPosted: null as Date | null };
    if (activeSprintsResult.rows.length > 0) {
      const activeSprints = activeSprintsResult.rows.map(row => row.sprint_id);
      const todayStr = today.toISOString().split('T')[0];
      const standupResult = await pool.query(
        `SELECT MAX(created_at) as last_posted
         FROM documents
         WHERE workspace_id = $1
           AND document_type = 'standup'
           AND (properties->>'author_id')::uuid = $2
           AND deleted_at IS NULL
           AND (
             (properties->>'date') = $3
             OR (parent_id = ANY($4) AND created_at >= $5)
           )`,
        [workspaceId, userId, todayStr, activeSprints, today.toISOString()]
      );
      const lastPosted = standupResult.rows[0]?.last_posted || null;
      standupStatus = { due: !lastPosted, lastPosted };
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.is_super_admin,
        },
        currentWorkspace,
        workspaces: workspacesResult.rows.map(w => ({
          id: w.id,
          name: w.name,
          role: w.role,
        })),
        pendingAccountabilityItems: [],
        documents: documentsResult.rows,
        programs: programsResult.rows.map(mapProgram),
        projects: projectsResult.rows.map(mapProject),
        issues,
        standupStatus,
        actionItems: toAccountabilityResponse(accountabilityItems),
      },
    });
  } catch (error) {
    console.error('Bootstrap error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load bootstrap data' } });
  }
});

export default router;
