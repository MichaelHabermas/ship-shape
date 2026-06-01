import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/client.js';
import type { Principal } from '../../security/principal.js';
import { guardIssueMutation } from '../issue-mutation-guards.js';
import {
  mapListedIssueIterationRow,
  mapStoredIssueIterationRow,
  type IssueIterationAuthorRow,
  type IssueIterationListRow,
  type IssueStoredIterationRow,
} from '../../utils/issue-response.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import { enqueueFleetGraphIssueAttentionEvents } from '../../fleetgraph/events.js';
import type { IssueMutationResult } from './types.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export async function createIssueIterationMutation(input: {
  issueId: string;
  principal: Principal;
  userId: string;
  workspaceId: string;
  status: 'pass' | 'fail' | 'in_progress';
  what_attempted?: string;
  blockers_encountered?: string;
}): Promise<IssueMutationResult<ReturnType<typeof mapStoredIssueIterationRow>>> {
  const { issueId, principal, userId, workspaceId, status, what_attempted, blockers_encountered } = input;

  const denied = await guardIssueMutation(pool, principal, {
    action: 'write',
    documentId: issueId,
    expectedType: 'issue',
  });
  if (denied) return denied;

  const result = await pool.query<IssueStoredIterationRow>(
    `INSERT INTO issue_iterations
     (issue_id, workspace_id, status, what_attempted, blockers_encountered, author_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [issueId, workspaceId, status, what_attempted || null, blockers_encountered || null, userId]
  );

  const authorResult = await pool.query<IssueIterationAuthorRow>(
    'SELECT id, name, email FROM users WHERE id = $1',
    [userId]
  );

  const iteration = requireFirstRow(result.rows);
  const author = requireFirstRow(authorResult.rows);
  await enqueueFleetGraphIssueAttentionEvents({
    workspaceId,
    issueIds: [issueId],
    eventType: 'issue_iteration_added',
    reason: 'issue_iteration_added',
  });
  return { ok: true, status: 201, body: mapStoredIssueIterationRow(iteration, author) };
}

export async function listIssueIterations(
  db: QueryRunner,
  input: {
    issueId: string;
    principal: Principal;
    workspaceId: string;
    status?: 'pass' | 'fail' | 'in_progress';
  }
): Promise<IssueMutationResult<ReturnType<typeof mapListedIssueIterationRow>[]>> {
  const { issueId, principal, workspaceId, status } = input;

  const denied = await guardIssueMutation(db, principal, {
    action: 'read',
    documentId: issueId,
    expectedType: 'issue',
  });
  if (denied) return denied;

  let query = `
    SELECT i.*, u.name as author_name, u.email as author_email
    FROM issue_iterations i
    JOIN users u ON i.author_id = u.id
    WHERE i.issue_id = $1 AND i.workspace_id = $2
  `;
  const params: unknown[] = [issueId, workspaceId];
  let paramIndex = 3;

  if (status) {
    query += ` AND i.status = $${paramIndex++}`;
    params.push(status);
  }

  query += ' ORDER BY i.created_at DESC';

  const result = await db.query<IssueIterationListRow>(query, params);
  return { ok: true, status: 200, body: result.rows.map(mapListedIssueIterationRow) };
}
