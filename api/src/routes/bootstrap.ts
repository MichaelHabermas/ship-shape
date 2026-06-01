/** Bootstrap payload: user, workspace, programs, projects, issues, and wiki documents. */
import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import {
  computeICEScore,
  DEFAULT_PROJECT_PROPERTIES,
  type InferredProjectStatus,
  type ProjectRouteProperties,
} from '@ship/shared';
import { getBelongsToAssociationsBatch } from '../utils/document-crud.js';
import { mapIssueListItem } from '../utils/issue-response.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError } from '../utils/route-http.js';
import { INFERRED_PROJECT_STATUS_SUBQUERY } from '../sql/bootstrap-queries.js';
import { pickBootstrapDocumentProperties } from '../constants/bootstrap-document.js';
import { readProgramListFields, readProjectBootstrapFields } from '../utils/document-properties.js';
import { listIssuesMetadata } from '../db/documents-repository.js';
import { visibleAssociatedDocumentCountSql } from '../services/document-graph-visibility.js';

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
  converted_from_id?: string | null;
};

type BootstrapUserRow = {
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
};

type BootstrapWorkspaceRow = {
  id: string;
  name: string;
  role: string | null;
};

function mapProgram(row: ProgramRow) {
  const programFields = readProgramListFields(row.properties);
  return {
    id: row.id,
    name: row.title,
    color: programFields.color,
    emoji: programFields.emoji,
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
    owner_id: programFields.owner_id,
    accountable_id: programFields.accountable_id,
    consulted_ids: programFields.consulted_ids,
    informed_ids: programFields.informed_ids,
  };
}

function mapProject(row: ProjectRow) {
  const props = readProjectBootstrapFields(row.properties);
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
    emoji: props.emoji ?? null,
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
    owner_id: props.owner_id ?? null,
    accountable_id: props.accountable_id ?? null,
    consulted_ids: props.consulted_ids ?? [],
    informed_ids: props.informed_ids ?? [],
    has_retro: props.has_retro ?? false,
    target_date: props.target_date ?? null,
    has_design_review: props.has_design_review ?? null,
  };
}

function mapBootstrapDocument(row: DocumentListRow) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    document_type: row.document_type,
    title: row.title,
    parent_id: row.parent_id,
    position: row.position,
    ticket_number: row.ticket_number,
    properties: pickBootstrapDocumentProperties(row.properties),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    visibility: row.visibility,
  };
}

const EMPTY_ACTION_ITEMS_RESPONSE = {
  items: [],
  total: 0,
  has_overdue: false,
  has_due_today: false,
};

const STALE_STANDUP_STATUS = {
  due: false,
  lastPosted: null,
};

router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const [
      userResult,
      workspacesResult,
      currentWorkspaceResult,
      documentsResult,
      programsResult,
      projectsResult,
      issuesResult,
    ] = await Promise.all([
      pool.query<BootstrapUserRow>('SELECT id, email, name, is_super_admin FROM users WHERE id = $1', [userId]),
      pool.query<BootstrapWorkspaceRow>(
        `SELECT w.id, w.name, wm.role
         FROM workspaces w
         JOIN workspace_memberships wm ON w.id = wm.workspace_id
         WHERE wm.user_id = $1 AND w.archived_at IS NULL
         ORDER BY w.name`,
        [userId]
      ),
      pool.query<BootstrapWorkspaceRow>(
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
           AND ${VISIBILITY_FILTER_SQL('documents', '$2', '$3')}
         ORDER BY position ASC, created_at ASC`,
        [workspaceId, userId, isAdmin]
      ),
      pool.query<ProgramRow>(
        `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
                COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
                u.name as owner_name, u.email as owner_email,
                (${visibleAssociatedDocumentCountSql('i', 'program', 'issue', 'd', '$2', '$3')}) as issue_count,
                (${visibleAssociatedDocumentCountSql('s', 'program', 'sprint', 'd', '$2', '$3')}) as sprint_count
         FROM documents d
         LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
         WHERE d.workspace_id = $1 AND d.document_type = 'program'
           AND d.archived_at IS NULL
           AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
         ORDER BY d.created_at DESC`,
        [workspaceId, userId, isAdmin]
      ),
      pool.query<ProjectRow>(
        `SELECT d.id, d.title, d.properties, prog.id as program_id,
                d.archived_at, d.created_at, d.updated_at, d.converted_from_id,
                (d.properties->>'owner_id')::uuid as owner_id,
                u.name as owner_name, u.email as owner_email,
                (${visibleAssociatedDocumentCountSql('s', 'project', 'sprint', 'd', '$2', '$3')}) as sprint_count,
                (${visibleAssociatedDocumentCountSql('i', 'project', 'issue', 'd', '$2', '$3')}) as issue_count,
                (${INFERRED_PROJECT_STATUS_SUBQUERY}) as inferred_status
         FROM documents d
         LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
         LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
         LEFT JOIN documents prog ON prog.id = prog_da.related_id
          AND prog.workspace_id = d.workspace_id
          AND prog.document_type = 'program'
          AND prog.archived_at IS NULL
          AND prog.deleted_at IS NULL
          AND ${VISIBILITY_FILTER_SQL('prog', '$2', '$3')}
         WHERE d.workspace_id = $1 AND d.document_type = 'project'
           AND d.archived_at IS NULL
           AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
         ORDER BY ((COALESCE((d.properties->>'impact')::int, 3) * COALESCE((d.properties->>'confidence')::int, 3) * COALESCE((d.properties->>'ease')::int, 3))) DESC`,
        [workspaceId, userId, isAdmin]
      ),
      listIssuesMetadata(workspaceId, userId, isAdmin),
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

    const issueIds = issuesResult.map(row => row.id);
    const associationsMap = await getBelongsToAssociationsBatch(issueIds);
    const issues = issuesResult.map(row => mapIssueListItem(row, associationsMap.get(row.id) || []));

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
        documents: documentsResult.rows.map(mapBootstrapDocument),
        programs: programsResult.rows.map(mapProgram),
        projects: projectsResult.rows.map(mapProject),
        issues,
        standupStatus: STALE_STANDUP_STATUS,
        actionItems: EMPTY_ACTION_ITEMS_RESPONSE,
      },
    });
  } catch (error) {
    sendInternalError(res, error, 'Bootstrap error', {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to load bootstrap data' },
    });
  }
});

export default router;
