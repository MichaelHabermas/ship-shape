// Capability authorization maps principals and scopes to workspace/document decisions.
import type { Pool, PoolClient } from 'pg';
import type { BelongsToType, DocumentType } from '@ship/shared';
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

export type DocumentCapabilityAction = 'read' | 'write' | 'governance' | 'collaborate';

export type DocumentCapabilityEnforce = 'creator_or_admin' | 'workspace_admin';

export type Capability =
  | { resource: 'workspace'; action: 'read' | 'admin' }
  | { resource: 'setup'; action: 'initialize' }
  | { resource: 'api_token'; action: 'create' | 'revoke' | 'use' }
  | {
      resource: 'document';
      action: DocumentCapabilityAction;
      documentId?: string;
      expectedType?: DocumentType;
      enforce?: DocumentCapabilityEnforce;
      includeArchived?: boolean;
      includeDeleted?: boolean;
    }
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
  | 'not_creator_or_admin'
  | 'reference_not_visible'
  | 'setup_token_required';

export type CapabilityDecision = {
  allowed: boolean;
  reason: CapabilityDenyReason | 'allowed';
  principal: Principal;
  document?: AccessibleDocument;
};

export type DocumentMutationCapability = {
  action: DocumentCapabilityAction;
  documentId?: string;
  enforce?: DocumentCapabilityEnforce;
  includeArchived?: boolean;
  includeDeleted?: boolean;
};

export function capabilityDenialStatus(reason: CapabilityDenyReason | 'allowed'): number {
  return reason === 'document_not_found' ? 404 : 403;
}

export type DocumentCommandType =
  | 'set_governance'
  | 'set_raci'
  | 'set_workflow_status'
  | 'set_visibility'
  | 'set_parent'
  | 'set_associations'
  | 'edit_content'
  | 'convert'
  | 'delete';

export function documentCommandCapability(command: { type: DocumentCommandType }): {
  action: DocumentCapabilityAction;
  enforce?: DocumentCapabilityEnforce;
} {
  switch (command.type) {
    case 'set_governance':
    case 'set_raci':
      return { action: 'governance', enforce: 'workspace_admin' };
    case 'set_workflow_status':
    case 'set_visibility':
    case 'set_parent':
    case 'set_associations':
    case 'edit_content':
      return { action: 'write' };
    case 'convert':
    case 'delete':
      return { action: 'write', enforce: 'creator_or_admin' };
  }
}

function actorFromPrincipal(principal: Principal): DocumentActor | null {
  if (principal.kind === 'setup' || principal.kind === 'fleetgraph_system') return null;
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

  if (capability.resource === 'workspace') {
    return capability.action === 'read' || scopes.includes('admin:workspace');
  }
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
    if (capability.action === 'read' || capability.action === 'collaborate') {
      return scopes.includes('documents:read');
    }
    if (capability.action === 'governance') {
      return scopes.includes('documents:governance');
    }
    return scopes.includes('documents:write') || scopes.includes('documents:content');
  }

  return false;
}

function ensureTokenScope(principal: Principal, capability: Capability): CapabilityDecision | null {
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

async function sessionIsCreatorOrAdmin(
  db: QueryRunner,
  actor: DocumentActor,
  document: Pick<AccessibleDocument, 'created_by'>
): Promise<boolean> {
  const { isAdmin } = await getDocumentAccessContext(actor, db);
  return isAdmin || document.created_by === actor.userId;
}

async function enforceDocumentSessionRule(
  db: QueryRunner,
  principal: Principal,
  actor: DocumentActor,
  capability: Extract<Capability, { resource: 'document' }>,
  document: AccessibleDocument
): Promise<CapabilityDecision> {
  if (capability.action === 'governance' || capability.enforce === 'workspace_admin') {
    const { isAdmin } = await getDocumentAccessContext(actor, db);
    if (!isAdmin) {
      return decision(principal, false, 'not_workspace_admin', document);
    }
    return decision(principal, true, 'allowed', document);
  }

  if (capability.enforce === 'creator_or_admin') {
    if (!(await sessionIsCreatorOrAdmin(db, actor, document))) {
      return decision(principal, false, 'not_creator_or_admin', document);
    }
  }

  return decision(principal, true, 'allowed', document);
}

async function readableDocumentDecision(
  db: QueryRunner,
  principal: Principal,
  actor: DocumentActor,
  documentId: string,
  options: { expectedType?: DocumentType; includeArchived?: boolean; includeDeleted?: boolean } = {}
): Promise<CapabilityDecision> {
  const document = await getReadableDocument(db, actor, documentId, options.expectedType, {
    includeArchived: options.includeArchived,
    includeDeleted: 'includeDeleted' in options ? options.includeDeleted === true : false,
  });
  if (!document) return decision(principal, false, 'document_not_found');
  if (!(await canReadAccountabilityDocument(db, actor, document))) {
    return decision(principal, false, 'accountability_scope_denied');
  }
  return decision(principal, true, 'allowed', document);
}

async function fleetGraphSystemDocumentDecision(
  db: QueryRunner,
  principal: Extract<Principal, { kind: 'fleetgraph_system' }>,
  capability: Extract<Capability, { resource: 'document' }>
): Promise<CapabilityDecision> {
  if (capability.action !== 'read') {
    return decision(principal, false, 'not_workspace_admin');
  }

  const result = await db.query<AccessibleDocument>(
    `SELECT d.id, d.title, d.document_type, d.workspace_id, d.created_by,
            d.visibility, d.properties, d.archived_at, d.deleted_at
       FROM documents d
      WHERE d.id = $1
        AND d.workspace_id = $2
        AND d.deleted_at IS NULL
        AND ($3::text IS NULL OR d.document_type::text = $3)
        AND ($4::boolean = TRUE OR d.archived_at IS NULL)`,
    [
      capability.documentId,
      principal.workspaceId,
      'expectedType' in capability ? capability.expectedType ?? null : null,
      'includeArchived' in capability ? capability.includeArchived === true : false,
    ]
  );
  const document = result.rows[0];
  if (!document) return decision(principal, false, 'document_not_found');

  return decision(principal, true, 'allowed', document);
}

export async function authorize(
  db: QueryRunner,
  principal: Principal,
  capability: Capability
): Promise<CapabilityDecision> {
  if (capability.resource === 'setup') {
    const allowed = principal.kind === 'setup';
    return decision(principal, allowed, allowed ? 'allowed' : 'setup_token_required');
  }

  const tokenDenied = ensureTokenScope(principal, capability);
  if (tokenDenied) return tokenDenied;

  if (principal.kind === 'fleetgraph_system') {
    if (capability.resource === 'workspace') {
      return decision(
        principal,
        capability.action === 'read',
        capability.action === 'read' ? 'allowed' : 'not_workspace_admin'
      );
    }
    if (capability.resource === 'document') {
      if (capability.action !== 'read') return decision(principal, false, 'not_workspace_admin');
      if (!capability.documentId) return decision(principal, true, 'allowed');
      return fleetGraphSystemDocumentDecision(db, principal, capability);
    }
    if (capability.resource === 'collaboration') {
      return decision(principal, false, 'not_workspace_admin');
    }
    return decision(principal, false, 'not_workspace_admin');
  }

  const actor = actorFromPrincipal(principal);
  if (!actor) return decision(principal, false, 'anonymous');

  if (capability.resource === 'workspace') {
    if (capability.action === 'read') return decision(principal, true, 'allowed');
    return workspaceAdminDecision(db, principal, actor);
  }

  if (capability.resource === 'api_token') {
    return workspaceAdminDecision(db, principal, actor);
  }

  if (capability.resource === 'document') {
    if (!capability.documentId) {
      return decision(principal, true, 'allowed');
    }
    const readDecision = await readableDocumentDecision(db, principal, actor, capability.documentId, {
      expectedType: capability.expectedType,
    includeArchived: capability.includeArchived,
    includeDeleted: capability.includeDeleted,
    });
    if (!readDecision.allowed || !readDecision.document) {
      return readDecision;
    }
    return enforceDocumentSessionRule(db, principal, actor, capability, readDecision.document);
  }

  if (capability.resource === 'collaboration') {
    return readableDocumentDecision(db, principal, actor, capability.documentId);
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
    return readableDocumentDecision(db, principal, actor, capability.documentId);
  }

  return decision(principal, false, 'anonymous');
}

export async function authorizeDocumentMutation(
  db: QueryRunner,
  principal: Principal,
  spec: DocumentMutationCapability
): Promise<CapabilityDecision> {
  return authorize(db, principal, {
    resource: 'document',
    action: spec.action,
    documentId: spec.documentId,
    enforce: spec.enforce,
    includeArchived: spec.includeArchived,
  });
}
