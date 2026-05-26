// Document graph visibility helpers keep child rows and counts actor-filtered.
import type { Pool, PoolClient } from 'pg';
import type { DocumentType } from '@ship/shared';
import {
  getDocumentAccessContext,
  visibilityPredicate,
  type DocumentActor,
} from './document-access.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export interface GraphVisibilityContext {
  actor: DocumentActor;
  isAdmin: boolean;
}

export async function getGraphVisibilityContext(
  db: QueryRunner,
  actor: DocumentActor
): Promise<GraphVisibilityContext> {
  const { isAdmin } = await getDocumentAccessContext(actor, db);
  return { actor, isAdmin };
}

export function visibleDocumentPredicate(
  tableAlias: string,
  userIdParam: string,
  isAdminParam: string,
  options: { includeArchived?: boolean; includeDeleted?: boolean } = {}
): string {
  const filters = [
    visibilityPredicate(tableAlias, userIdParam, isAdminParam),
  ];
  if (!options.includeArchived) filters.push(`${tableAlias}.archived_at IS NULL`);
  if (!options.includeDeleted) filters.push(`${tableAlias}.deleted_at IS NULL`);
  return filters.map((filter) => `(${filter})`).join(' AND ');
}

export function visibleAssociatedDocumentCountSql(
  childAlias: string,
  relationshipType: 'program' | 'project' | 'sprint' | 'parent',
  childType: DocumentType,
  parentAlias: string,
  userIdParam: string,
  isAdminParam: string
): string {
  return `SELECT COUNT(*)::int
          FROM documents ${childAlias}
          JOIN document_associations da_${childAlias}
            ON da_${childAlias}.document_id = ${childAlias}.id
           AND da_${childAlias}.related_id = ${parentAlias}.id
           AND da_${childAlias}.relationship_type = '${relationshipType}'
         WHERE ${childAlias}.workspace_id = ${parentAlias}.workspace_id
           AND ${childAlias}.document_type = '${childType}'
           AND ${visibleDocumentPredicate(childAlias, userIdParam, isAdminParam)}`;
}

export function visibleAssociatedIssueCountSql(
  childAlias: string,
  relationshipType: 'program' | 'project' | 'sprint',
  parentAlias: string,
  userIdParam: string,
  isAdminParam: string,
  issueFilter = 'TRUE'
): string {
  return `SELECT COUNT(*)::int
          FROM documents ${childAlias}
          JOIN document_associations da_${childAlias}
            ON da_${childAlias}.document_id = ${childAlias}.id
           AND da_${childAlias}.related_id = ${parentAlias}.id
           AND da_${childAlias}.relationship_type = '${relationshipType}'
         WHERE ${childAlias}.workspace_id = ${parentAlias}.workspace_id
           AND ${childAlias}.document_type = 'issue'
           AND (${issueFilter})
           AND ${visibleDocumentPredicate(childAlias, userIdParam, isAdminParam)}`;
}

export function visibleAssociatedIssueEstimateSumSql(
  childAlias: string,
  relationshipType: 'program' | 'project' | 'sprint',
  parentAlias: string,
  userIdParam: string,
  isAdminParam: string
): string {
  return `SELECT COALESCE(SUM((${childAlias}.properties->>'estimate')::numeric), 0)
          FROM documents ${childAlias}
          JOIN document_associations da_${childAlias}
            ON da_${childAlias}.document_id = ${childAlias}.id
           AND da_${childAlias}.related_id = ${parentAlias}.id
           AND da_${childAlias}.relationship_type = '${relationshipType}'
         WHERE ${childAlias}.workspace_id = ${parentAlias}.workspace_id
           AND ${childAlias}.document_type = 'issue'
           AND ${visibleDocumentPredicate(childAlias, userIdParam, isAdminParam)}`;
}

export async function filterReadableDocumentIds(
  db: QueryRunner,
  actor: DocumentActor,
  ids: string[],
  expectedType?: DocumentType
): Promise<Set<string>> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (uniqueIds.length === 0) return new Set();

  const { isAdmin } = await getDocumentAccessContext(actor, db);
  const params: unknown[] = [uniqueIds, actor.workspaceId, actor.userId, isAdmin];
  const typeFilter = expectedType ? 'AND d.document_type = $5' : '';
  if (expectedType) params.push(expectedType);

  const result = await db.query<{ id: string }>(
    `SELECT d.id
       FROM documents d
      WHERE d.id = ANY($1::uuid[])
        AND d.workspace_id = $2
        ${typeFilter}
        AND ${visibleDocumentPredicate('d', '$3', '$4')}`,
    params
  );

  return new Set(result.rows.map((row) => row.id));
}
