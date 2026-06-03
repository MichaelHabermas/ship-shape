// Public issue read model maps document-backed issues into the v1 wire contract.
import { z } from 'zod';
import {
  PublicIssueListQuerySchema,
  PublicIssueSchema,
  type PublicIssue,
} from '@ship/shared';
import { pool } from '../../../db/client.js';
import {
  issueCoreFromDocumentRow,
} from '../../../services/issue-mutations/issue-core.js';
import { getDocumentAccessContext, visibilityPredicate } from '../../../services/document-access.js';
import {
  decodePublicCursor,
  encodePublicCursor,
  publicListLimitFromQuery,
  type PublicCursorPayload,
  type PublicListResponse,
} from './pagination.js';

export type PublicIssueRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  ticket_number: number | null;
  content?: unknown;
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

type PublicIssueBelongsToRow = {
  document_id: string;
  id: string;
  type: PublicIssue['belongs_to'][number]['type'];
  title: string | null;
  color: string | null;
};

export type PublicIssueListFilters = z.infer<typeof PublicIssueListQuerySchema>;

export type PublicIssueListInput = {
  userId: string;
  workspaceId: string;
  limit: number | undefined;
  cursor: PublicCursorPayload | null;
  filters: PublicIssueListFilters;
};

export async function listPublicIssuesPage(
  input: PublicIssueListInput
): Promise<PublicListResponse<Omit<PublicIssue, 'content'>>> {
  const actor = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    isSuperAdmin: false,
  };
  const { isAdmin } = await getDocumentAccessContext(actor);
  const limit = publicListLimitFromQuery(input.limit);
  const { query, params } = buildIssueListQuery({
    workspaceId: input.workspaceId,
    userId: input.userId,
    isAdmin,
    limit: limit + 1,
    cursor: input.cursor,
    filters: input.filters,
  });

  const result = await pool.query<PublicIssueRow>(query, params);
  const rows = result.rows.slice(0, limit);
  const nextRow = result.rows.length > limit ? rows[rows.length - 1] : null;
  const associations = await getPublicBelongsToAssociationsBatch({
    documentIds: rows.map((row) => row.id),
    workspaceId: input.workspaceId,
    userId: input.userId,
    isAdmin,
  });

  return {
    data: rows.map((row) =>
      publicIssueFromRow(row, {
        includeContent: false,
        belongsTo: associations.get(row.id) ?? [],
      })
    ),
    next_cursor: nextRow
      ? encodePublicCursor({ id: nextRow.id, timestamp: nextRow.updated_at.toISOString() })
      : null,
  };
}

export async function findPublicIssue(
  id: string,
  userId: string,
  workspaceId: string
): Promise<PublicIssue | null> {
  const row = await findPublicIssueRow(id, userId, workspaceId);
  if (!row) return null;
  const { isAdmin } = await getDocumentAccessContext({ userId, workspaceId, isSuperAdmin: false });
  return publicIssueFromRow(row, {
    includeContent: true,
    belongsTo: await getPublicBelongsToAssociations({
      documentId: row.id,
      workspaceId,
      userId,
      isAdmin,
    }),
  });
}

export function parsePublicIssueCursor(cursor: string | undefined): PublicCursorPayload | null {
  if (!cursor) return null;
  return decodePublicCursor(cursor);
}

async function findPublicIssueRow(
  id: string,
  userId: string,
  workspaceId: string
): Promise<PublicIssueRow | null> {
  const actor = { userId, workspaceId, isSuperAdmin: false };
  const { isAdmin } = await getDocumentAccessContext(actor);
  const result = await pool.query<PublicIssueRow>(
    `${publicIssueSelectSql()}
     WHERE d.id = $1
       AND d.workspace_id = $2
       AND d.document_type = 'issue'
       AND d.archived_at IS NULL
       AND d.deleted_at IS NULL
       AND ${visibilityPredicate('d', '$3', '$4')}`,
    [id, workspaceId, userId, isAdmin]
  );
  return result.rows[0] ?? null;
}

function publicIssueFromRow(
  row: PublicIssueRow,
  options: { includeContent: boolean; belongsTo: PublicIssue['belongs_to'] }
): PublicIssue {
  const props = row.properties ?? {};
  const core = issueCoreFromDocumentRow(row);
  const issue = {
    id: core.id,
    title: core.title,
    display_id: core.display_id,
    ticket_number: core.ticket_number,
    state: schemaValueOr(PublicIssueSchema.shape.state, props.state, 'backlog'),
    priority: schemaValueOr(PublicIssueSchema.shape.priority, props.priority, 'medium'),
    assignee_id: uuidOrNull(props.assignee_id),
    ...(row.assignee_name !== null ? { assignee_name: row.assignee_name } : {}),
    ...(row.assignee_archived ? { assignee_archived: true } : {}),
    ...(typeof props.estimate === 'number' ? { estimate: props.estimate } : core.estimate !== undefined ? { estimate: core.estimate } : {}),
    source: schemaValueOr(PublicIssueSchema.shape.source, props.source, 'internal'),
    ...(typeof props.due_date === 'string' ? { due_date: props.due_date } : {}),
    ...(typeof props.is_system_generated === 'boolean' ? { is_system_generated: props.is_system_generated } : {}),
    ...(uuidOrNull(props.accountability_target_id) ? { accountability_target_id: uuidOrNull(props.accountability_target_id) } : {}),
    ...(typeof props.accountability_type === 'string' ? { accountability_type: props.accountability_type } : {}),
    ...(typeof props.rejection_reason === 'string' ? { rejection_reason: props.rejection_reason } : {}),
    ...(options.includeContent ? { content: row.content ?? null } : {}),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    created_by: row.created_by,
    ...(row.started_at ? { started_at: row.started_at.toISOString() } : {}),
    ...(row.completed_at ? { completed_at: row.completed_at.toISOString() } : {}),
    ...(row.cancelled_at ? { cancelled_at: row.cancelled_at.toISOString() } : {}),
    ...(row.reopened_at ? { reopened_at: row.reopened_at.toISOString() } : {}),
    ...(row.converted_from_id ? { converted_from_id: row.converted_from_id } : {}),
    belongs_to: options.belongsTo,
  };
  return PublicIssueSchema.parse(issue);
}

function publicIssueSelectSql(): string {
  return `SELECT d.id, d.title, d.properties, d.ticket_number,
                 d.content, d.created_at, d.updated_at, d.created_by,
                 d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
                 d.converted_from_id,
                 u.name AS assignee_name,
                 CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END AS assignee_archived
            FROM documents d
            LEFT JOIN users u ON d.properties->>'assignee_id' = u.id::text
            LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
              AND person_doc.document_type = 'person'
              AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'`;
}

function buildIssueListQuery(input: {
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
  limit: number;
  cursor: PublicCursorPayload | null;
  filters: PublicIssueListFilters;
}): { query: string; params: Array<string | boolean | number | string[]> } {
  const params: Array<string | boolean | number | string[]> = [
    input.workspaceId,
    input.userId,
    input.isAdmin,
  ];
  const filters: string[] = [];

  if (input.filters.source) {
    params.push(input.filters.source);
    filters.push(`d.properties->>'source' = $${params.length}`);
  }
  if (input.filters.state) {
    params.push(input.filters.state.split(','));
    filters.push(`d.properties->>'state' = ANY($${params.length})`);
  }
  if (input.filters.priority) {
    params.push(input.filters.priority);
    filters.push(`d.properties->>'priority' = $${params.length}`);
  }
  if (input.filters.assignee_id) {
    if (input.filters.assignee_id === 'null' || input.filters.assignee_id === 'unassigned') {
      filters.push(`(d.properties->>'assignee_id' IS NULL OR d.properties->>'assignee_id' = '')`);
    } else {
      params.push(input.filters.assignee_id);
      filters.push(`d.properties->>'assignee_id' = $${params.length}`);
    }
  }
  for (const [key, relationship] of [
    ['program_id', 'program'],
    ['project_id', 'project'],
    ['sprint_id', 'sprint'],
  ] as const) {
    const value = input.filters[key];
    if (value) {
      params.push(value);
      filters.push(`EXISTS (
        SELECT 1 FROM document_associations da
        JOIN documents related ON related.id = da.related_id
         WHERE da.document_id = d.id
           AND da.related_id = $${params.length}
           AND da.relationship_type = '${relationship}'
           AND related.workspace_id = d.workspace_id
           AND related.archived_at IS NULL
           AND related.deleted_at IS NULL
           AND ${visibilityPredicate('related', '$2', '$3')}
      )`);
    }
  }
  if (input.filters.parent_filter === 'top_level') {
    filters.push(`NOT EXISTS (
      SELECT 1 FROM document_associations da
       WHERE da.document_id = d.id AND da.relationship_type = 'parent'
    )`);
  } else if (input.filters.parent_filter === 'has_children') {
    filters.push(`EXISTS (
      SELECT 1 FROM document_associations da
       WHERE da.related_id = d.id AND da.relationship_type = 'parent'
    )`);
  } else if (input.filters.parent_filter === 'is_sub_issue') {
    filters.push(`EXISTS (
      SELECT 1 FROM document_associations da
       WHERE da.document_id = d.id AND da.relationship_type = 'parent'
    )`);
  }
  if (input.cursor) {
    params.push(input.cursor.timestamp, input.cursor.id);
    const timestampParam = params.length - 1;
    const idParam = params.length;
    filters.push(`(d.updated_at < $${timestampParam}::timestamptz OR (d.updated_at = $${timestampParam}::timestamptz AND d.id::text < $${idParam}))`);
  }

  params.push(input.limit);
  const whereFilters = filters.length > 0 ? `AND ${filters.join('\nAND ')}` : '';
  return {
    query: `${publicIssueSelectSql()}
       WHERE d.workspace_id = $1
         AND d.document_type = 'issue'
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND ${visibilityPredicate('d', '$2', '$3')}
         ${whereFilters}
       ORDER BY d.updated_at DESC, d.id::text DESC
       LIMIT $${params.length}`,
    params,
  };
}

async function getPublicBelongsToAssociations(input: {
  documentId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<PublicIssue['belongs_to']> {
  const associations = await getPublicBelongsToAssociationsBatch({
    documentIds: [input.documentId],
    workspaceId: input.workspaceId,
    userId: input.userId,
    isAdmin: input.isAdmin,
  });
  return associations.get(input.documentId) ?? [];
}

async function getPublicBelongsToAssociationsBatch(input: {
  documentIds: string[];
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<Map<string, PublicIssue['belongs_to']>> {
  if (input.documentIds.length === 0) return new Map();
  const result = await pool.query<PublicIssueBelongsToRow>(
    `SELECT da.document_id, related.id, da.relationship_type as type,
            related.title, related.properties->>'color' as color
       FROM document_associations da
       JOIN documents related ON related.id = da.related_id
      WHERE da.document_id = ANY($1::uuid[])
        AND related.workspace_id = $2
        AND related.archived_at IS NULL
        AND related.deleted_at IS NULL
        AND ${visibilityPredicate('related', '$3', '$4')}
      ORDER BY da.document_id, da.relationship_type, da.created_at`,
    [input.documentIds, input.workspaceId, input.userId, input.isAdmin]
  );

  const associations = new Map<string, PublicIssue['belongs_to']>();
  for (const row of result.rows) {
    const parsedType = PublicIssueSchema.shape.belongs_to.element.shape.type.safeParse(row.type);
    if (!parsedType.success) continue;
    const current = associations.get(row.document_id) ?? [];
    current.push({
      id: row.id,
      type: parsedType.data,
      ...(row.title ? { title: row.title } : {}),
      ...(row.color ? { color: row.color } : {}),
    });
    associations.set(row.document_id, current);
  }
  return associations;
}

function uuidOrNull(value: unknown): string | null {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function schemaValueOr<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}
