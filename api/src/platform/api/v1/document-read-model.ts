// Public document read model maps unified documents into the v1 wire contract.
import type { DocumentType, DocumentVisibility, PublicDocument } from '@ship/shared';
import { pool } from '../../../db/client.js';
import type { DocumentAccessRow } from '../../../services/document-mutations/types.js';
import { getDocumentAccessContext, visibilityPredicate } from '../../../services/document-access.js';
import {
  decodePublicCursor,
  encodePublicCursor,
  publicListLimitFromQuery,
  type PublicCursorPayload,
  type PublicListResponse,
} from './pagination.js';
import { accountabilityReadPredicate } from './public-sql-helpers.js';

export type PublicDocumentRow = {
  id: string;
  workspace_id: string;
  document_type: DocumentType;
  title: string;
  parent_id: string | null;
  ticket_number: number | null;
  properties: Record<string, unknown> | null;
  content?: unknown;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: DocumentVisibility;
};

export type PublicDocumentListInput = {
  userId: string;
  workspaceId: string;
  limit: number | undefined;
  cursor: PublicCursorPayload | null;
  type?: DocumentType;
};

export async function listPublicDocumentsPage(
  input: PublicDocumentListInput
): Promise<PublicListResponse<PublicDocument>> {
  const actor = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    isSuperAdmin: false,
  };
  const { isAdmin } = await getDocumentAccessContext(actor);
  const limit = publicListLimitFromQuery(input.limit);
  const params: Array<string | boolean | number> = [
    actor.workspaceId,
    actor.userId,
    isAdmin,
    limit + 1,
  ];
  let typeFilter = '';
  if (input.type) {
    params.push(input.type);
    typeFilter = `AND d.document_type = $${params.length}`;
  }
  let cursorFilter = '';
  if (input.cursor) {
    params.push(input.cursor.timestamp, input.cursor.id);
    const timestampParam = params.length - 1;
    const idParam = params.length;
    cursorFilter = `AND (d.created_at < $${timestampParam}::timestamptz OR (d.created_at = $${timestampParam}::timestamptz AND d.id::text < $${idParam}))`;
  }

  const result = await pool.query<PublicDocumentRow>(
    `${publicDocumentSelectSql()}
     WHERE d.workspace_id = $1
       AND d.archived_at IS NULL
       AND d.deleted_at IS NULL
       AND ${visibilityPredicate('d', '$2', '$3')}
       AND ${accountabilityReadPredicate('d', '$2', '$3')}
       ${typeFilter}
       ${cursorFilter}
     ORDER BY d.created_at DESC, d.id::text DESC
     LIMIT $4`,
    params
  );

  const rows = result.rows.slice(0, limit);
  const nextRow = result.rows.length > limit ? rows[rows.length - 1] : null;
  return {
    data: rows.map(publicDocumentFromRow),
    next_cursor: nextRow
      ? encodePublicCursor({ id: nextRow.id, timestamp: nextRow.created_at.toISOString() })
      : null,
  };
}

export async function findPublicDocument(
  id: string,
  userId: string,
  workspaceId: string
): Promise<PublicDocument | null> {
  const actor = { userId, workspaceId, isSuperAdmin: false };
  const { isAdmin } = await getDocumentAccessContext(actor);
  const result = await pool.query<PublicDocumentRow>(
    `${publicDocumentSelectSql(true)}
     WHERE d.id = $1
       AND d.workspace_id = $2
       AND d.archived_at IS NULL
       AND d.deleted_at IS NULL
       AND ${visibilityPredicate('d', '$3', '$4')}
       AND ${accountabilityReadPredicate('d', '$3', '$4')}`,
    [id, workspaceId, userId, isAdmin]
  );
  const row = result.rows[0];
  return row ? publicDocumentFromRow(row) : null;
}

export function parsePublicDocumentCursor(cursor: string | undefined): PublicCursorPayload | null {
  if (!cursor) return null;
  return decodePublicCursor(cursor);
}

export function publicDocumentFromMutationRow(row: DocumentAccessRow): PublicDocument {
  return publicDocumentFromRow({
    id: row.id,
    workspace_id: row.workspace_id,
    document_type: row.document_type,
    title: row.title,
    parent_id: row.parent_id,
    ticket_number: row.ticket_number,
    properties: row.properties,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    visibility: row.visibility,
  });
}

export function publicDocumentFromRow(row: PublicDocumentRow): PublicDocument {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    document_type: row.document_type,
    title: row.title,
    parent_id: row.parent_id,
    ticket_number: row.ticket_number,
    properties: row.properties ?? {},
    ...(row.content !== undefined ? { content: row.content } : {}),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    created_by: row.created_by,
    visibility: row.visibility,
  };
}

function publicDocumentSelectSql(includeContent = false): string {
  const contentColumn = includeContent ? ', d.content' : '';
  return `SELECT d.id, d.workspace_id, d.document_type, d.title, d.parent_id,
                 d.ticket_number, d.properties, d.created_at, d.updated_at,
                 d.created_by, d.visibility${contentColumn}
            FROM documents d`;
}
