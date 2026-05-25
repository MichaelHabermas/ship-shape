/**
 * Project/sprint row projections and response mappers for project routes.
 */
import type { InferredProjectStatus, ProjectProperties, WeekProperties } from '@ship/shared';
import { DEFAULT_PROJECT_PROPERTIES, computeICEScore } from '@ship/shared';
import { pool } from './client.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';

/** Allocation-based inferred status (shared by list/detail/update queries). */
export const PROJECT_INFERRED_STATUS_SQL = `
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
        WHERE sprint.document_type = 'sprint'
          AND sprint.workspace_id = d.workspace_id
          AND (sprint.properties->>'project_id')::uuid = d.id
          AND jsonb_array_length(COALESCE(sprint.properties->'assignee_ids', '[]'::jsonb)) > 0
      ),
      'backlog'
    )
  END
`;

export async function projectAccessible(
  projectId: string,
  workspaceId: string,
  userId: string,
  isAdmin: boolean
): Promise<boolean> {
  const result = await pool.query<ProjectExistsRow>(
    `SELECT id FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [projectId, workspaceId, userId, isAdmin]
  );
  return result.rows.length > 0;
}

export type ProjectRouteProperties = Partial<ProjectProperties> & {
  is_complete?: boolean | null;
  missing_fields?: string[];
  plan?: string | null;
  has_retro?: boolean;
  target_date?: string | null;
};

export type ProjectRow = {
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

export type ProjectSprintProperties = CanonicalWeekProperties & {
  status?: string;
  plan?: string | null;
  success_criteria?: string[] | null;
  confidence?: number | null;
};

export type ProjectSprintRow = {
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

export type ProjectIssueRow = {
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

export type ProjectRetroProjectRow = Pick<ProjectRow, 'id' | 'title' | 'content' | 'properties'>;

export type ProjectRetroSprintRow = {
  id: string;
  title: string;
  sprint_number: string | number | null;
};

export type ProjectRetroIssueRow = {
  id: string;
  title: string;
  state: string | null;
};

export type TipTapJsonContent = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: TipTapJsonContent[];
};

export type TipTapJsonDoc = TipTapJsonContent & {
  content: TipTapJsonContent[];
};

export type ProjectExistsRow = { id: string };

export type DocumentTypeRow = {
  id: string;
  document_type: string;
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
};

export type ProjectPropertiesRow = {
  id: string;
  properties: ProjectRouteProperties | null;
  content?: unknown;
};

export type ProjectWithProgramRow = {
  id: string;
  program_id: string | null;
  sprint_start_date: Date | string | null;
};

export type MaxSprintNumberRow = {
  max_sprint: number | string | null;
};

export type ProjectSprintCreateRow = {
  id: string;
  title: string;
  properties: ProjectSprintProperties | null;
};

export type IdRow = { id: string };

export type WorkspaceMemberUserRow = UserRow;

export function extractProjectFromRow(row: ProjectRow) {
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
    inferred_status: row.inferred_status as InferredProjectStatus || 'backlog',
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

export function extractSprintFromRow(row: ProjectSprintRow) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    sprint_number: props.sprint_number || 1,
    status: props.status || 'planning',
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

export function mapProjectIssueRow(row: ProjectIssueRow) {
  const props = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    assignee_id: props.assignee_id || null,
    assignee_name: row.assignee_name,
    ticket_number: row.ticket_number,
    display_id: row.ticket_number ? `#${row.ticket_number}` : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
  };
}
