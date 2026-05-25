import type { Pool, PoolClient } from 'pg';
import type { BelongsToType, DocumentType } from '@ship/shared';
import { pool } from '../db/client.js';
import {
  canReadAccountabilityDocument,
  expectedTypeForRelationship,
  getDocumentAccessContext,
  getReadableDocument,
  type AccessibleDocument,
  type DocumentActor,
} from '../services/document-access.js';
import type { ApiTokenScope, Principal } from './principal.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type DocumentCapabilityAction =
  | 'read'
  | 'read_content'
  | 'edit_content'
  | 'rename'
  | 'set_visibility'
  | 'set_parent'
  | 'set_associations'
  | 'set_workflow_state'
  | 'set_governance'
  | 'set_raci'
  | 'convert'
  | 'delete'
  | 'review_accountability'
  | 'collaborate';

export type Capability =
  | { resource: 'workspace'; action: 'read' | 'admin' }
  | { resource: 'setup'; action: 'initialize' }
  | { resource: 'api_token'; action: 'create' | 'revoke' | 'use' }
  | { resource: 'document'; action: DocumentCapabilityAction; documentId: string; expectedType?: DocumentType }
  | {
      resource: 'document_reference';
      action: 'link' | 'reveal';
      sourceId?: string;
      targetId: string;
      relationship: BelongsToType | 'parent';
    }
  | { resource: 'file'; action: 'create_upload' | 'complete_upload' | 'read' | 'serve' | 'delete'; fileId?: string; documentId?: string | null }
  | { resource: 'collaboration'; action: 'join' | 'sync' | 'persist'; documentId: string };

export type CapabilityDenyReason =
  | 'anonymous'
  | 'token_scope_denied'
  | 'document_not_found'
  | 'accountability_scope_denied'
  | 'not_workspace_admin'
  | 'reference_not_visible'
  | 'file_not_bound'
  | 'file_not_owned_or_admin'
  | 'setup_token_required';

export type CapabilityDecision = {
  allowed: boolean;
  reason: CapabilityDenyReason | 'allowed';
  principal: Principal;
  document?: AccessibleDocument;
};

function actorFromPrincipal(principal: Principal): DocumentActor | null {
  if (principal.kind === 'setup') return null;
  return {
    userId: principal.userId,
    workspaceId: principal.workspaceId,
    isSuperAdmin: principal.isSuperAdmin,
  };
}

function decision(
  principal: Principal,
  allowed: boolean,
  reason: CapabilityDecision['reason'],
  document?: AccessibleDocument
): CapabilityDecision {
  return { principal, allowed, reason, ...(document ? { document } : {}) };
}

function scopeAllows(scopes: ApiTokenScope[], capability: Capability): boolean {
  if (scopes.includes('legacy:full')) return true;

  if (capability.resource === 'workspace') return capability.action === 'read';
  if (capability.resource === 'api_token') return false;
  if (capability.resource === 'setup') return false;

  if (capability.resource === 'document_reference') {
    return scopes.includes('documents:write');
  }

  if (capability.resource === 'collaboration') {
    if (capability.action === 'persist') {
      return scopes.includes('documents:content') || scopes.includes('documents:write');
    }
    return scopes.includes('collaboration:join');
  }

  if (capability.resource === 'file') {
    return capability.action === 'read' || capability.action === 'serve'
      ? scopes.includes('files:read')
      : scopes.includes('files:write');
  }

  if (capability.resource === 'document') {
    if (capability.action === 'read' || capability.action === 'read_content') {
      return scopes.includes('documents:read');
    }
    if (capability.action === 'edit_content') {
      return scopes.includes('documents:content') || scopes.includes('documents:write');
    }
    if (capability.action === 'set_governance' || capability.action === 'set_raci') {
      return scopes.includes('documents:governance');
    }
    return scopes.includes('documents:write');
  }

  return false;
}

async function ensureTokenScope(
  principal: Principal,
  capability: Capability
): Promise<CapabilityDecision | null> {
  if (principal.kind !== 'api_token') return null;
  if (scopeAllows(principal.scopes, capability)) return null;
  return decision(principal, false, 'token_scope_denied');
}

async function workspaceAdminDecision(
  db: QueryRunner,
  principal: Principal,
  actor: DocumentActor
): Promise<CapabilityDecision> {
  const { isAdmin } = await getDocumentAccessContext(actor, db);
  return decision(principal, isAdmin, isAdmin ? 'allowed' : 'not_workspace_admin');
}

export async function authorize(
  db: QueryRunner,
  principal: Principal,
  capability: Capability
): Promise<CapabilityDecision> {
  if (capability.resource === 'setup') {
    return decision(
      principal,
      principal.kind === 'setup',
      principal.kind === 'setup' ? 'allowed' : 'setup_token_required',
    );
  }

  const tokenDenied = await ensureTokenScope(principal, capability);
  if (tokenDenied) return tokenDenied;

  const actor = actorFromPrincipal(principal);
  if (!actor) return decision(principal, false, 'anonymous');

  if (capability.resource === 'workspace') {
    if (capability.action === 'read') return decision(principal, true, 'allowed');
    return workspaceAdminDecision(db, principal, actor);
  }

  if (capability.resource === 'api_token') {
    return workspaceAdminDecision(db, principal, actor);
  }

  if (capability.resource === 'document' || capability.resource === 'collaboration') {
    const { documentId } = capability;
    const expectedType = capability.resource === 'document' ? capability.expectedType : undefined;
    const document = await getReadableDocument(db, actor, documentId, expectedType);
    if (!document) return decision(principal, false, 'document_not_found');
    if (!(await canReadAccountabilityDocument(db, actor, document))) {
      return decision(principal, false, 'accountability_scope_denied');
    }
    return decision(principal, true, 'allowed', document);
  }

  if (capability.resource === 'document_reference') {
    const expectedType = capability.relationship === 'parent'
      ? undefined
      : expectedTypeForRelationship(capability.relationship);
    const target = await getReadableDocument(db, actor, capability.targetId, expectedType);
    if (!target) return decision(principal, false, 'reference_not_visible');
    return decision(principal, true, 'allowed', target);
  }

  if (capability.resource === 'file') {
    if (!capability.documentId) {
      return decision(principal, true, 'allowed');
    }
    const document = await getReadableDocument(db, actor, capability.documentId);
    if (!document) return decision(principal, false, 'document_not_found');
    if (!(await canReadAccountabilityDocument(db, actor, document))) {
      return decision(principal, false, 'accountability_scope_denied');
    }
    return decision(principal, true, 'allowed', document);
  }

  return decision(principal, false, 'anonymous');
}

export async function requireCapability(
  db: QueryRunner,
  principal: Principal,
  capability: Capability
): Promise<CapabilityDecision & { allowed: true }> {
  const result = await authorize(db, principal, capability);
  if (!result.allowed) {
    throw new Error(result.reason);
  }
  return result as CapabilityDecision & { allowed: true };
}

export { pool as defaultCapabilityDb };
