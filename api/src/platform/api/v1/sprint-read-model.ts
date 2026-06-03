// Public sprint read model maps document-backed sprints into the v1 wire contract.
import {
  PublicSprintSchema,
  type PublicSprint,
} from '@ship/shared';
import { pool } from '../../../db/client.js';
import { getDocumentAccessContext, visibilityPredicate } from '../../../services/document-access.js';
import { visibleAssociatedIssueCountSql } from '../../../services/document-graph-visibility.js';
import { formatWireDate } from '../../../utils/format-wire-date.js';
import {
  decodePublicCursor,
  encodePublicCursor,
  publicListLimitFromQuery,
  type PublicCursorPayload,
  type PublicListResponse,
} from './pagination.js';
import { accountabilityReadPredicate } from './public-sql-helpers.js';

export type PublicSprintRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  updated_at: Date;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  program_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  program_accountable_id: string | null;
  workspace_sprint_start_date: Date | string | null;
  issue_count: string | number | null;
  completed_count: string | number | null;
  started_count: string | number | null;
  has_plan: boolean | 't' | 'f' | null;
  has_retro: boolean | 't' | 'f' | null;
  retro_outcome: string | null;
  retro_id: string | null;
};

export async function listPublicSprintsPage(input: {
  userId: string;
  workspaceId: string;
  limit: number | undefined;
  cursor: PublicCursorPayload | null;
}): Promise<PublicListResponse<PublicSprint>> {
  const actor = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    isSuperAdmin: false,
  };
  const { isAdmin } = await getDocumentAccessContext(actor);
  const limit = publicListLimitFromQuery(input.limit);
  const params: Array<string | boolean | number> = [input.workspaceId, input.userId, isAdmin];
  const cursorFilter = input.cursor ? buildCursorFilter(params, input.cursor) : '';
  params.push(limit + 1);

  const result = await pool.query<PublicSprintRow>(
    `${publicSprintSelectSql('$2', '$3')}
     WHERE d.workspace_id = $1
       AND d.document_type = 'sprint'
       AND d.archived_at IS NULL
       AND d.deleted_at IS NULL
       AND ${visibilityPredicate('d', '$2', '$3')}
       ${cursorFilter}
     ORDER BY d.updated_at DESC, d.id::text DESC
     LIMIT $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const nextRow = result.rows.length > limit ? rows[rows.length - 1] : null;

  return {
    data: rows.map(publicSprintFromRow),
    next_cursor: nextRow
      ? encodePublicCursor({ id: nextRow.id, timestamp: nextRow.updated_at.toISOString() })
      : null,
  };
}

export async function findPublicSprint(
  id: string,
  userId: string,
  workspaceId: string
): Promise<PublicSprint | null> {
  const actor = { userId, workspaceId, isSuperAdmin: false };
  const { isAdmin } = await getDocumentAccessContext(actor);
  const result = await pool.query<PublicSprintRow>(
    `${publicSprintSelectSql('$3', '$4')}
     WHERE d.id = $1
       AND d.workspace_id = $2
       AND d.document_type = 'sprint'
       AND d.archived_at IS NULL
       AND d.deleted_at IS NULL
       AND ${visibilityPredicate('d', '$3', '$4')}`,
    [id, workspaceId, userId, isAdmin]
  );
  const row = result.rows[0];
  return row ? publicSprintFromRow(row) : null;
}

export function parsePublicSprintCursor(cursor: string | undefined): PublicCursorPayload | null {
  if (!cursor) return null;
  return decodePublicCursor(cursor);
}

function publicSprintSelectSql(userIdParam: string, isAdminParam: string): string {
  return `SELECT d.id, d.title, d.properties, d.updated_at,
                 p.id AS program_id,
                 p.title AS program_name,
                 p.properties->>'prefix' AS program_prefix,
                 p.properties->>'accountable_id' AS program_accountable_id,
                 w.sprint_start_date AS workspace_sprint_start_date,
                 u.id AS owner_id,
                 u.name AS owner_name,
                 u.email AS owner_email,
                 (${visibleAssociatedIssueCountSql('i', 'sprint', 'd', userIdParam, isAdminParam)}) AS issue_count,
                 (${visibleAssociatedIssueCountSql('i', 'sprint', 'd', userIdParam, isAdminParam, "i.properties->>'state' = 'done'")}) AS completed_count,
                 (${visibleAssociatedIssueCountSql('i', 'sprint', 'd', userIdParam, isAdminParam, "i.properties->>'state' IN ('in_progress', 'in_review')")}) AS started_count,
                 (SELECT COUNT(*) > 0 FROM documents pl
                   WHERE pl.parent_id = d.id
                     AND pl.workspace_id = d.workspace_id
                     AND pl.document_type = 'weekly_plan'
                     AND pl.archived_at IS NULL
                     AND pl.deleted_at IS NULL
                     AND ${visibilityPredicate('pl', userIdParam, isAdminParam)}
                     AND ${accountabilityReadPredicate('pl', userIdParam, isAdminParam)}) AS has_plan,
                 (SELECT COUNT(*) > 0 FROM documents rt
                    JOIN document_associations rda ON rda.document_id = rt.id
                     AND rda.related_id = d.id
                     AND rda.relationship_type = 'sprint'
                   WHERE rt.workspace_id = d.workspace_id
                     AND rt.document_type = 'weekly_retro'
                     AND rt.archived_at IS NULL
                     AND rt.deleted_at IS NULL
                     AND rt.properties->>'outcome' IS NOT NULL
                     AND ${visibilityPredicate('rt', userIdParam, isAdminParam)}
                     AND ${accountabilityReadPredicate('rt', userIdParam, isAdminParam)}) AS has_retro,
                 (SELECT rt.properties->>'outcome' FROM documents rt
                    JOIN document_associations rda ON rda.document_id = rt.id
                     AND rda.related_id = d.id
                     AND rda.relationship_type = 'sprint'
                   WHERE rt.workspace_id = d.workspace_id
                     AND rt.document_type = 'weekly_retro'
                     AND rt.archived_at IS NULL
                     AND rt.deleted_at IS NULL
                     AND rt.properties->>'outcome' IS NOT NULL
                     AND ${visibilityPredicate('rt', userIdParam, isAdminParam)}
                     AND ${accountabilityReadPredicate('rt', userIdParam, isAdminParam)}
                   LIMIT 1) AS retro_outcome,
                 (SELECT rt.id FROM documents rt
                    JOIN document_associations rda ON rda.document_id = rt.id
                     AND rda.related_id = d.id
                     AND rda.relationship_type = 'sprint'
                   WHERE rt.workspace_id = d.workspace_id
                     AND rt.document_type = 'weekly_retro'
                     AND rt.archived_at IS NULL
                     AND rt.deleted_at IS NULL
                     AND rt.properties->>'outcome' IS NOT NULL
                     AND ${visibilityPredicate('rt', userIdParam, isAdminParam)}
                     AND ${accountabilityReadPredicate('rt', userIdParam, isAdminParam)}
                   LIMIT 1) AS retro_id
            FROM documents d
            LEFT JOIN document_associations prog_da
              ON prog_da.document_id = d.id
             AND prog_da.relationship_type = 'program'
            LEFT JOIN documents p ON prog_da.related_id = p.id
             AND p.workspace_id = d.workspace_id
             AND p.archived_at IS NULL
             AND p.deleted_at IS NULL
             AND ${visibilityPredicate('p', userIdParam, isAdminParam)}
            JOIN workspaces w ON d.workspace_id = w.id
            LEFT JOIN users u ON d.properties->'assignee_ids'->>0 = u.id::text`;
}

export function publicSprintFromRow(row: PublicSprintRow): PublicSprint {
  const props = row.properties ?? {};
  const sprint = {
    id: row.id,
    name: row.title,
    sprint_number: numberProp(props.sprint_number, 1),
    status: sprintStatus(props.status),
    owner: row.owner_id ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    program_id: row.program_id,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    program_accountable_id: row.program_accountable_id,
    workspace_sprint_start_date: formatWireDate(row.workspace_sprint_start_date),
    issue_count: countValue(row.issue_count),
    completed_count: countValue(row.completed_count),
    started_count: countValue(row.started_count),
    has_plan: booleanValue(row.has_plan),
    has_retro: booleanValue(row.has_retro),
    retro_outcome: row.retro_outcome,
    retro_id: row.retro_id,
    plan: typeof props.plan === 'string' ? props.plan : null,
    success_criteria: stringArrayOrNull(props.success_criteria),
    confidence: typeof props.confidence === 'number' ? props.confidence : null,
    plan_history: props.plan_history ?? null,
    is_complete: typeof props.is_complete === 'boolean' ? props.is_complete : null,
    missing_fields: stringArrayOrNull(props.missing_fields) ?? [],
    planned_issue_ids: stringArrayOrNull(props.planned_issue_ids),
    snapshot_taken_at: typeof props.snapshot_taken_at === 'string' ? props.snapshot_taken_at : null,
    plan_approval: props.plan_approval ?? null,
    review_approval: props.review_approval ?? null,
    accountable_id: typeof props.accountable_id === 'string' ? props.accountable_id : null,
  };
  return PublicSprintSchema.parse(sprint);
}

function buildCursorFilter(
  params: Array<string | boolean | number>,
  cursor: PublicCursorPayload
): string {
  params.push(cursor.timestamp, cursor.id);
  const timestampParam = params.length - 1;
  const idParam = params.length;
  return `AND (d.updated_at < $${timestampParam}::timestamptz OR (d.updated_at = $${timestampParam}::timestamptz AND d.id::text < $${idParam}))`;
}

function sprintStatus(value: unknown): PublicSprint['status'] {
  if (value === 'active' || value === 'completed') return value;
  return 'planning';
}

function numberProp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function countValue(value: string | number | null): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanValue(value: boolean | 't' | 'f' | null): boolean {
  return value === true || value === 't';
}

function stringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === 'string');
}
