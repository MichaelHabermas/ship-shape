/**
 * Narrow document repository slice — SQL for documents/issues list projections.
 * Routes remain thin HTTP handlers; persistence lives here.
 */
import type { IssueProperties } from '@ship/shared';
import { pool } from './client.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';

export type DocumentRow = {
  id: string;
  workspace_id: string;
  document_type: string;
  title: string;
  content: unknown;
  yjs_state: Buffer | null;
  properties: Record<string, unknown>;
  ticket_number: number | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
};

export async function getDocumentById(
  id: string,
  workspaceId: string
): Promise<DocumentRow | null> {
  const result = await pool.query<DocumentRow>(
    `SELECT id, workspace_id, document_type, title, content, yjs_state, properties,
            ticket_number, archived_at, deleted_at, created_at, updated_at, created_by
     FROM documents
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [id, workspaceId]
  );
  return result.rows[0] ?? null;
}

export async function getDocumentTypeById(
  id: string,
  workspaceId: string
): Promise<string | null> {
  const result = await pool.query<{ document_type: string }>(
    `SELECT document_type FROM documents
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [id, workspaceId]
  );
  return result.rows[0]?.document_type ?? null;
}

export async function updateDocumentContent(
  id: string,
  workspaceId: string,
  content: unknown,
  yjsState: Buffer | null,
  properties: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `UPDATE documents
     SET content = $1, yjs_state = $2, properties = $3, updated_at = now()
     WHERE id = $4 AND workspace_id = $5`,
    [JSON.stringify(content), yjsState, JSON.stringify(properties), id, workspaceId]
  );
}

export type IssueMetadataRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  ticket_number: number | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  reopened_at: Date | null;
  converted_from_id: string | null;
  assignee_name: string | null;
  assignee_archived: boolean | null;
};

export type ListIssuesMetadataFilters = {
  state?: string;
  priority?: string;
  assignee_id?: string;
  program_id?: string;
  project_id?: string;
  sprint_id?: string;
  source?: string;
  parent_filter?: 'top_level' | 'has_children' | 'is_sub_issue';
};

export type QueryParam = string | boolean | null | string[];

/**
 * Issues list projection (D015) — same SQL as GET /api/issues list handler.
 */
export async function listIssuesMetadata(
  workspaceId: string,
  userId: string,
  isAdmin: boolean,
  filters: ListIssuesMetadataFilters = {}
): Promise<IssueMetadataRow[]> {
  const { state, priority, assignee_id, program_id, project_id, sprint_id, source, parent_filter } =
    filters;

  let query = `
    SELECT d.id, d.title, d.properties, d.ticket_number,
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
  `;
  const params: QueryParam[] = [workspaceId, userId, isAdmin];

  query += ` AND d.archived_at IS NULL AND d.deleted_at IS NULL`;

  if (source) {
    query += ` AND d.properties->>'source' = $${params.length + 1}`;
    params.push(source);
  }

  if (state) {
    const states = state.split(',');
    query += ` AND d.properties->>'state' = ANY($${params.length + 1})`;
    params.push(states);
  }

  if (priority) {
    query += ` AND d.properties->>'priority' = $${params.length + 1}`;
    params.push(priority);
  }

  if (assignee_id) {
    if (assignee_id === 'null' || assignee_id === 'unassigned') {
      query += ` AND (d.properties->>'assignee_id' IS NULL OR d.properties->>'assignee_id' = '')`;
    } else {
      query += ` AND d.properties->>'assignee_id' = $${params.length + 1}`;
      params.push(assignee_id);
    }
  }

  if (program_id) {
    query += ` AND EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id AND da.related_id = $${params.length + 1} AND da.relationship_type = 'program'
    )`;
    params.push(program_id);
  }

  if (project_id) {
    query += ` AND EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id AND da.related_id = $${params.length + 1} AND da.relationship_type = 'project'
    )`;
    params.push(project_id);
  }

  if (sprint_id) {
    query += ` AND EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id AND da.related_id = $${params.length + 1} AND da.relationship_type = 'sprint'
    )`;
    params.push(sprint_id);
  }

  if (parent_filter === 'top_level') {
    query += ` AND NOT EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id AND da.relationship_type = 'parent'
    )`;
  } else if (parent_filter === 'has_children') {
    query += ` AND EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.related_id = d.id AND da.relationship_type = 'parent'
    )`;
  } else if (parent_filter === 'is_sub_issue') {
    query += ` AND EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id AND da.relationship_type = 'parent'
    )`;
  }

  query += ` ORDER BY
    CASE d.properties->>'priority'
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
      ELSE 5
    END,
    d.updated_at DESC`;

  const result = await pool.query<IssueMetadataRow>(query, params);
  return result.rows;
}

export type IssueExtractRow = {
  id: string;
  title: string;
  properties: IssueProperties | Record<string, unknown> | null;
  ticket_number: number | null;
  content?: unknown;
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
  created_by_name?: string | null;
};

export type IssueDocumentRow = IssueExtractRow & {
  archived_at?: Date | null;
  deleted_at?: Date | null;
};

export type IssueDetailRow = IssueExtractRow & {
  content: unknown;
  converted_to_id: string | null;
};

function issuePropertiesFromRow(
  properties: IssueProperties | Record<string, unknown> | null | undefined
): Partial<IssueProperties> {
  return (properties ?? {}) as Partial<IssueProperties>;
}

/** Map issue SQL projection to API issue shape (without belongs_to). */
export function extractIssueFromRow(
  row: IssueExtractRow,
  options: { includeContent?: boolean } = {}
) {
  const props = issuePropertiesFromRow(row.properties);
  const issue = {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    assignee_id: props.assignee_id || null,
    estimate: props.estimate ?? null,
    source: props.source || 'internal',
    rejection_reason: props.rejection_reason || null,
    due_date: props.due_date || null,
    is_system_generated: props.is_system_generated || false,
    accountability_target_id: props.accountability_target_id || null,
    accountability_type: props.accountability_type || null,
    ticket_number: row.ticket_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    cancelled_at: row.cancelled_at || null,
    reopened_at: row.reopened_at || null,
    converted_from_id: row.converted_from_id || null,
    assignee_name: row.assignee_name,
    assignee_archived: row.assignee_archived || false,
    created_by_name: row.created_by_name,
  };

  if (options.includeContent === false) {
    return issue;
  }

  return {
    ...issue,
    content: row.content ?? null,
  };
}

const ISSUE_DETAIL_SELECT = `
  SELECT d.id, d.title, d.properties, d.ticket_number,
         d.content,
         d.created_at, d.updated_at, d.created_by,
         d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
         d.converted_to_id, d.converted_from_id,
         u.name as assignee_name,
         CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived,
         creator.name as created_by_name
  FROM documents d
  LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
  LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
    AND person_doc.document_type = 'person'
    AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
  LEFT JOIN users creator ON d.created_by = creator.id
`;

/**
 * Issue detail projection — same SQL as GET /api/issues/:id.
 */
export async function getIssueDetailById(
  id: string,
  workspaceId: string,
  userId: string,
  isAdmin: boolean
): Promise<IssueDetailRow | null> {
  const result = await pool.query<IssueDetailRow>(
    `${ISSUE_DETAIL_SELECT}
     WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
    [id, workspaceId, userId, isAdmin]
  );
  return result.rows[0] ?? null;
}

/**
 * Issue detail by ticket number — same projection as GET /api/issues/by-ticket/:number.
 */
export async function getIssueDetailByTicketNumber(
  ticketNumber: number,
  workspaceId: string,
  userId: string,
  isAdmin: boolean
): Promise<IssueDetailRow | null> {
  const result = await pool.query<IssueDetailRow>(
    `${ISSUE_DETAIL_SELECT}
     WHERE d.ticket_number = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
    [ticketNumber, workspaceId, userId, isAdmin]
  );
  return result.rows[0] ?? null;
}
