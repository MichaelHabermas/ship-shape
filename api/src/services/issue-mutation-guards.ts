// Issue-specific wrappers over shared mutation capability guards.
import type { Pool, PoolClient } from 'pg';
import type { DocumentType } from '@ship/shared';
import type { DocumentMutationCapability } from '../security/capabilities.js';
import type { Principal } from '../security/principal.js';
import {
  guardDocumentCreate as sharedGuardDocumentCreate,
  guardDocumentMutation as sharedGuardDocumentMutation,
  type MutationGuardDenial,
} from './mutation-capability-guard.js';
type QueryRunner = Pick<Pool | PoolClient, 'query'>;

type IssueMutationDenial = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

function mapGuardDenial(denial: MutationGuardDenial): IssueMutationDenial {
  return {
    ok: false,
    status: denial.status,
    body: { error: denial.body.error },
  };
}

export async function guardIssueMutation(
  db: QueryRunner,
  principal: Principal,
  spec: DocumentMutationCapability & { expectedType?: DocumentType }
): Promise<IssueMutationDenial | null> {
  const result = await sharedGuardDocumentMutation(db, principal, spec, {
    notFoundMessage: 'Issue not found',
  });
  if (result.ok) return null;
  return mapGuardDenial(result);
}

export async function guardIssueCreate(
  db: QueryRunner,
  principal: Principal
): Promise<IssueMutationDenial | null> {
  const result = await sharedGuardDocumentCreate(db, principal);
  if (result.ok) return null;
  return mapGuardDenial(result);
}
