// Shared capability guards for service-layer document writes (token scope + enforce rules).
import type { Pool, PoolClient } from 'pg';
import type { DocumentType } from '@ship/shared';
import {
  authorize,
  authorizeDocumentMutationsBatch,
  capabilityDenialStatus,
  type DocumentMutationCapability,
} from '../security/capabilities.js';
import { legacyMutationErrorMessage } from '../security/legacy-mutation-error.js';
import type { Principal } from '../security/principal.js';
import type { AccessibleDocument } from './document-access.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type MutationGuardDenial = {
  ok: false;
  status: number;
  body: { error: string };
};

export type MutationGuardAllow = {
  ok: true;
  document?: AccessibleDocument;
};

export type MutationGuardResult = MutationGuardAllow | MutationGuardDenial;

export type BulkMutationGuardResult =
  | { id: string; ok: true; document: AccessibleDocument }
  | { id: string; ok: false; status: number; body: { error: string } };

export function mutationGuardDenial(
  denial: MutationGuardDenial
): { ok: false; status: number; body: { error: string } } {
  return { ok: false, status: denial.status, body: denial.body };
}

export async function guardDocumentMutation(
  db: QueryRunner,
  principal: Principal,
  spec: DocumentMutationCapability & { expectedType?: DocumentType },
  options: { notFoundMessage?: string } = {}
): Promise<MutationGuardResult> {
  const notFoundMessage = options.notFoundMessage ?? 'Not found';
  const decision = await authorize(db, principal, {
    resource: 'document',
    action: spec.action,
    documentId: spec.documentId,
    enforce: spec.enforce,
    includeArchived: spec.includeArchived,
    includeDeleted: spec.includeDeleted,
    expectedType: spec.expectedType,
  });
  if (decision.allowed) {
    return { ok: true, document: decision.document };
  }
  const status = capabilityDenialStatus(decision.reason);
  return {
    ok: false,
    status,
    body: { error: legacyMutationErrorMessage(decision.reason, notFoundMessage) },
  };
}

/** Batch document write guards (one membership lookup + one document query). */
export async function guardDocumentMutationsBatch(
  db: QueryRunner,
  principal: Principal,
  documentIds: string[],
  spec: DocumentMutationCapability & { expectedType?: DocumentType },
  options: { notFoundMessage?: string } = {}
): Promise<BulkMutationGuardResult[]> {
  const notFoundMessage = options.notFoundMessage ?? 'Not found';
  const decisions = await authorizeDocumentMutationsBatch(db, principal, documentIds, spec);
  return decisions.map((decision) => {
    if (decision.allowed) {
      return { id: decision.id, ok: true as const, document: decision.document };
    }
    const status = capabilityDenialStatus(decision.reason);
    return {
      id: decision.id,
      ok: false as const,
      status,
      body: { error: legacyMutationErrorMessage(decision.reason, notFoundMessage) },
    };
  });
}

export async function guardDocumentCreate(
  db: QueryRunner,
  principal: Principal
): Promise<MutationGuardResult> {
  const decision = await authorize(db, principal, { resource: 'document', action: 'write' });
  if (decision.allowed) return { ok: true };
  const status = capabilityDenialStatus(decision.reason);
  return {
    ok: false,
    status,
    body: { error: legacyMutationErrorMessage(decision.reason) },
  };
}
