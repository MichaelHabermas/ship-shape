import type { Pool, PoolClient } from 'pg';
import type { DocumentType } from '@ship/shared';
import { pool } from '../db/client.js';
import {
  canReadAccountabilityDocument,
  expectedTypeForRelationship,
  getDocumentAccessContext,
  getReadableDocument,
  type AccessibleDocument,
  type DocumentActor,
} from './document-access.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type DocumentPolicyAction =
  | 'read'
  | 'write'
  | 'reference'
  | 'content_update'
  | 'delete'
  | 'convert'
  | 'review_accountability'
  | 'collaborate';

export type DocumentPolicyReason =
  | 'allowed'
  | 'document_not_found'
  | 'accountability_scope_denied'
  | 'not_creator_or_admin'
  | 'not_workspace_admin'
  | 'restricted_document_type'
  | 'wrong_reference_type';

export type DocumentPolicyDecision = {
  action: DocumentPolicyAction;
  allowed: boolean;
  reason: DocumentPolicyReason;
  document?: AccessibleDocument;
};

export type DocumentPolicyCase = {
  id: string;
  action: DocumentPolicyAction;
  expectedReason: DocumentPolicyReason;
  description: string;
};

export const DOCUMENT_POLICY_CASES: DocumentPolicyCase[] = [
  {
    id: 'workspace-doc-readable',
    action: 'read',
    expectedReason: 'allowed',
    description: 'Workspace-visible documents are readable by workspace members.',
  },
  {
    id: 'private-doc-creator-or-admin',
    action: 'write',
    expectedReason: 'allowed',
    description: 'Private documents remain writable only through the normal readable-document gate.',
  },
  {
    id: 'weekly-doc-person-scope',
    action: 'content_update',
    expectedReason: 'accountability_scope_denied',
    description: 'Weekly plan/retro content updates require the linked person scope, not workspace visibility alone.',
  },
  {
    id: 'document-type-change-creator',
    action: 'convert',
    expectedReason: 'not_creator_or_admin',
    description: 'Document conversion/type changes require the creator.',
  },
  {
    id: 'association-reference-readable',
    action: 'reference',
    expectedReason: 'wrong_reference_type',
    description: 'Associations must reference a readable document of the expected relationship type.',
  },
];

function decision(
  action: DocumentPolicyAction,
  allowed: boolean,
  reason: DocumentPolicyReason,
  document?: AccessibleDocument
): DocumentPolicyDecision {
  return { action, allowed, reason, ...(document ? { document } : {}) };
}

export async function decideDocumentAccess(
  db: QueryRunner,
  actor: DocumentActor,
  action: DocumentPolicyAction,
  documentId: string,
  expectedType?: DocumentType,
  options: { includeArchived?: boolean } = {}
): Promise<DocumentPolicyDecision> {
  const document = await getReadableDocument(db, actor, documentId, expectedType, options);
  if (!document) {
    return decision(action, false, 'document_not_found');
  }

  if (!(await canReadAccountabilityDocument(db, actor, document))) {
    return decision(action, false, 'accountability_scope_denied');
  }

  return decision(action, true, 'allowed', document);
}

export async function decideReferenceAccess(
  db: QueryRunner,
  actor: DocumentActor,
  relatedId: string,
  relationshipType: 'program' | 'project' | 'sprint' | 'parent'
): Promise<DocumentPolicyDecision> {
  const expectedType = relationshipType === 'parent'
    ? undefined
    : expectedTypeForRelationship(relationshipType);
  const document = await getReadableDocument(db, actor, relatedId, expectedType);

  if (!document) {
    return decision('reference', false, expectedType ? 'wrong_reference_type' : 'document_not_found');
  }

  return decision('reference', true, 'allowed', document);
}

export async function decideCreatorOrAdmin(
  actor: DocumentActor,
  document: Pick<AccessibleDocument, 'created_by'>,
  action: DocumentPolicyAction,
  db: QueryRunner = pool
): Promise<DocumentPolicyDecision> {
  const { isAdmin } = await getDocumentAccessContext(actor, db);
  if (isAdmin || document.created_by === actor.userId) {
    return decision(action, true, 'allowed');
  }
  return decision(action, false, 'not_creator_or_admin');
}

export async function decideWorkspaceAdmin(
  actor: DocumentActor,
  action: DocumentPolicyAction,
  db: QueryRunner = pool
): Promise<DocumentPolicyDecision> {
  const { isAdmin } = await getDocumentAccessContext(actor, db);
  if (isAdmin) {
    return decision(action, true, 'allowed');
  }
  return decision(action, false, 'not_workspace_admin');
}
