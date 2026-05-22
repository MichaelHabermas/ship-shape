import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/client.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import {
  checkSprintSupervisorAuth,
  type ApprovalAuthResult,
} from '../utils/approval-workflow.js';
import {
  type DocumentAccessContext,
  getDocumentAccessContext,
  type DocumentActor,
  requireReadableDocument,
} from './document-access.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type GovernanceAuthResult = ApprovalAuthResult;

async function getSprintOwnerReportsTo(
  db: QueryRunner,
  sprintId: string,
  workspaceId: string
): Promise<string | null> {
  const result = await db.query(
    `SELECT owner_person.properties->>'reports_to' as reports_to
     FROM documents d
     LEFT JOIN documents owner_person
       ON d.properties->>'owner_id' IS NOT NULL
       AND owner_person.id = (d.properties->>'owner_id')::uuid
       AND owner_person.document_type = 'person'
       AND owner_person.workspace_id = $2
     WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'`,
    [sprintId, workspaceId]
  );
  return result.rows[0]?.reports_to ?? null;
}

export async function requireTeamAllocationAuthority(
  actor: DocumentActor,
  db: QueryRunner = pool
): Promise<GovernanceAuthResult> {
  const { isAdmin } = await getDocumentAccessContext(actor, db);
  if (isAdmin || actor.isSuperAdmin) {
    return { authorized: true };
  }
  return {
    authorized: false,
    error: 'Workspace admin access required to change team allocations',
  };
}

export async function requireWeekLifecycleAuthority(
  db: QueryRunner,
  actor: DocumentActor,
  sprintId: string,
  action: 'start_week' | 'carryover'
): Promise<GovernanceAuthResult> {
  const { isAdmin } = await getDocumentAccessContext(actor, db);

  const sprintResult = await db.query(
    `SELECT d.id, d.properties,
            prog.properties->>'accountable_id' as program_accountable_id
     FROM documents d
     LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
     LEFT JOIN documents prog ON prog_da.related_id = prog.id
     WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
    [sprintId, actor.workspaceId, actor.userId, isAdmin]
  );

  if (sprintResult.rows.length === 0) {
    return { authorized: false, error: 'Week not found' };
  }

  const sprint = sprintResult.rows[0];
  const ownerReportsTo = await getSprintOwnerReportsTo(db, sprintId, actor.workspaceId);
  const auth = checkSprintSupervisorAuth(
    sprint.program_accountable_id,
    ownerReportsTo,
    actor.userId,
    isAdmin,
    action === 'start_week' ? 'approve_plans' : 'request_changes'
  );

  if (auth.authorized) {
    return auth;
  }

  const sprintOwnerId = sprint.properties?.owner_id;
  if (typeof sprintOwnerId === 'string') {
    const ownerUserResult = await db.query<{ user_id: string | null }>(
      `SELECT properties->>'user_id' as user_id
       FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
      [sprintOwnerId, actor.workspaceId]
    );
    if (ownerUserResult.rows[0]?.user_id === actor.userId) {
      return { authorized: true };
    }
  }

  return {
    authorized: false,
    error:
      action === 'start_week'
        ? 'Only the sprint owner, supervisor, program accountable person, or admin can start this week'
        : 'Only the sprint owner, supervisor, program accountable person, or admin can carry over issues',
  };
}

export async function requireClaudeContextDocument(
  db: QueryRunner,
  actor: DocumentActor,
  documentId: string,
  expectedType: 'sprint' | 'project'
): Promise<void> {
  await requireReadableDocument(db, actor, documentId, expectedType);
}

export async function getGovernanceContext(
  actor: DocumentActor,
  db: QueryRunner = pool
): Promise<DocumentAccessContext> {
  return getDocumentAccessContext(actor, db);
}
