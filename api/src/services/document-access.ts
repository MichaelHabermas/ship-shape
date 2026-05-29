// Document visibility reads and reference checks for routes and capability authorization.
import type { Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { BelongsToType, DocumentType } from '@ship/shared';
import { pool } from '../db/client.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
export type { DocumentActor } from '../security/document-actor.js';
import type { DocumentActor } from '../security/document-actor.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export interface AccessibleDocument {
  id: string;
  title: string;
  document_type: DocumentType;
  workspace_id: string;
  created_by: string | null;
  visibility: 'private' | 'workspace';
  properties: Record<string, unknown>;
  archived_at: Date | null;
  deleted_at: Date | null;
}

export interface DocumentAccessContext {
  actor: DocumentActor;
  isAdmin: boolean;
}

export function getActor(req: Request): DocumentActor {
  const context = getAuthenticatedRouteContext(req);
  return {
    userId: context.userId,
    workspaceId: context.workspaceId,
    isSuperAdmin: context.isSuperAdmin,
  };
}

export async function getDocumentAccessContext(
  actor: DocumentActor,
  db: QueryRunner = pool
): Promise<DocumentAccessContext> {
  if (actor.isSuperAdmin) {
    return { actor, isAdmin: true };
  }

  const result = await db.query<{ role: string }>(
    'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
    [actor.workspaceId, actor.userId]
  );

  return { actor, isAdmin: result.rows[0]?.role === 'admin' };
}

export function visibilityPredicate(
  tableAlias: string,
  userIdParam: string,
  isAdminParam: string
): string {
  return VISIBILITY_FILTER_SQL(tableAlias, userIdParam, isAdminParam);
}

export async function requireWorkspaceMembership(
  actor: DocumentActor,
  db: QueryRunner = pool
): Promise<boolean> {
  if (actor.isSuperAdmin) return true;

  const result = await db.query(
    'SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
    [actor.workspaceId, actor.userId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getReadableDocument(
  db: QueryRunner,
  actor: DocumentActor,
  docId: string,
  expectedType?: DocumentType,
  options: { includeArchived?: boolean; includeDeleted?: boolean } = {}
): Promise<AccessibleDocument | null> {
  const { isAdmin } = await getDocumentAccessContext(actor, db);
  const typeFilter = expectedType ? 'AND d.document_type = $5' : '';
  const archiveFilter = options.includeArchived ? '' : 'AND d.archived_at IS NULL';
  const deletedFilter = options.includeDeleted ? '' : 'AND d.deleted_at IS NULL';
  const params = expectedType
    ? [docId, actor.workspaceId, actor.userId, isAdmin, expectedType]
    : [docId, actor.workspaceId, actor.userId, isAdmin];

  const result = await db.query<AccessibleDocument>(
    `SELECT d.id, d.title, d.document_type, d.workspace_id, d.created_by,
            d.visibility, d.properties, d.archived_at, d.deleted_at
      FROM documents d
     WHERE d.id = $1
       AND d.workspace_id = $2
        ${deletedFilter}
        ${archiveFilter}
        ${typeFilter}
        AND ${visibilityPredicate('d', '$3', '$4')}`,
    params
  );

  return result.rows[0] ?? null;
}

export async function getReadableDocumentsBatch(
  db: QueryRunner,
  actor: DocumentActor,
  docIds: string[],
  expectedType?: DocumentType,
  options: { includeArchived?: boolean; includeDeleted?: boolean } = {}
): Promise<AccessibleDocument[]> {
  if (docIds.length === 0) return [];

  const { isAdmin } = await getDocumentAccessContext(actor, db);
  const typeFilter = expectedType ? 'AND d.document_type = $5' : '';
  const archiveFilter = options.includeArchived ? '' : 'AND d.archived_at IS NULL';
  const deletedFilter = options.includeDeleted ? '' : 'AND d.deleted_at IS NULL';
  const params = expectedType
    ? [docIds, actor.workspaceId, actor.userId, isAdmin, expectedType]
    : [docIds, actor.workspaceId, actor.userId, isAdmin];

  const result = await db.query<AccessibleDocument>(
    `SELECT d.id, d.title, d.document_type, d.workspace_id, d.created_by,
            d.visibility, d.properties, d.archived_at, d.deleted_at
      FROM documents d
     WHERE d.id = ANY($1::uuid[])
       AND d.workspace_id = $2
        ${deletedFilter}
        ${archiveFilter}
        ${typeFilter}
        AND ${visibilityPredicate('d', '$3', '$4')}`,
    params
  );

  return result.rows;
}

export async function canReadDocument(
  db: QueryRunner,
  actor: DocumentActor,
  docId: string,
  expectedType?: DocumentType,
  options: { includeArchived?: boolean } = {}
): Promise<boolean> {
  return (await getReadableDocument(db, actor, docId, expectedType, options)) !== null;
}

export async function requireReadableDocument(
  db: QueryRunner,
  actor: DocumentActor,
  docId: string,
  expectedType?: DocumentType,
  options: { includeArchived?: boolean } = {}
): Promise<AccessibleDocument> {
  const document = await getReadableDocument(db, actor, docId, expectedType, options);
  if (!document) {
    throw new Error('DOCUMENT_NOT_READABLE');
  }
  return document;
}

export async function requireReferenceableDocument(
  db: QueryRunner,
  actor: DocumentActor,
  docId: string,
  expectedType?: DocumentType
): Promise<AccessibleDocument> {
  return requireReadableDocument(db, actor, docId, expectedType);
}

export function expectedTypeForRelationship(
  relationshipType: BelongsToType
): DocumentType | undefined {
  if (relationshipType === 'program') return 'program';
  if (relationshipType === 'project') return 'project';
  if (relationshipType === 'sprint') return 'sprint';
  return undefined;
}

export async function requireAssociationAccess(
  db: QueryRunner,
  actor: DocumentActor,
  sourceId: string,
  relatedId: string,
  relationshipType: BelongsToType
): Promise<{ source: AccessibleDocument; related: AccessibleDocument }> {
  const source = await requireReadableDocument(db, actor, sourceId);
  const related = await requireReferenceableDocument(
    db,
    actor,
    relatedId,
    expectedTypeForRelationship(relationshipType)
  );

  return { source, related };
}

export async function requireSelfOrAdminPerson(
  db: QueryRunner,
  actor: DocumentActor,
  personId: string
): Promise<AccessibleDocument> {
  const person = await requireReadableDocument(db, actor, personId, 'person');
  const { isAdmin } = await getDocumentAccessContext(actor, db);
  const ownerUserId = person.properties?.user_id;

  if (isAdmin || ownerUserId === actor.userId) {
    return person;
  }

  throw new Error('PERSON_NOT_SELF_OR_ADMIN');
}

/** Weekly accountability docs are scoped to the linked person, not workspace visibility alone. */
export async function canReadAccountabilityDocument(
  db: QueryRunner,
  actor: DocumentActor,
  doc: Pick<AccessibleDocument, 'document_type' | 'properties'>
): Promise<boolean> {
  if (doc.document_type !== 'weekly_plan' && doc.document_type !== 'weekly_retro') {
    return true;
  }

  const personId = doc.properties?.person_id;
  if (typeof personId !== 'string') {
    return false;
  }

  try {
    await requireSelfOrAdminPerson(db, actor, personId);
    return true;
  } catch {
    return false;
  }
}
