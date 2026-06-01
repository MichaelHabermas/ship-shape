import type { IssueProperties } from '@ship/shared';
import { pool } from '../../db/client.js';
import { extractIssueFromRow, type IssueDocumentRow } from '../../db/documents-repository.js';
import type { Principal } from '../../security/principal.js';
import { guardIssueMutation } from '../issue-mutation-guards.js';
import { logDocumentChange } from '../../utils/document-crud.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import { enqueueFleetGraphIssueAttentionEvents } from '../../fleetgraph/events.js';
import { type IssueMutationResult, type IssuePropertiesRow } from './types.js';

export async function acceptIssueMutation(input: {
  issueId: string;
  principal: Principal;
  userId: string;
  workspaceId: string;
}): Promise<IssueMutationResult<Record<string, unknown>>> {
  const { issueId: id, principal, userId, workspaceId } = input;

  const denied = await guardIssueMutation(pool, principal, {
    action: 'write',
    documentId: id,
    expectedType: 'issue',
  });
  if (denied) return denied;

  const existing = await pool.query<IssuePropertiesRow>(
    `SELECT id, properties FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
    [id, workspaceId]
  );

  if (existing.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Issue not found' } };
  }

  const props = (requireFirstRow(existing.rows).properties ?? {}) as Partial<IssueProperties>;
  if (props.state !== 'triage') {
    return { ok: false, status: 400, body: { error: 'Issue must be in triage state to be accepted' } };
  }

  const newProps = { ...props, state: 'backlog' as const };
  const result = await pool.query<IssueDocumentRow>(
    `UPDATE documents
     SET properties = $3, updated_at = now()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *`,
    [id, workspaceId, JSON.stringify(newProps)]
  );

  await logDocumentChange(id, 'state', 'triage', 'backlog', userId);
  await enqueueFleetGraphIssueAttentionEvents({
    workspaceId,
    issueIds: [id],
    eventType: 'issue_changed',
    reason: 'issue_accepted',
  });
  const issue = extractIssueFromRow(requireFirstRow(result.rows));
  return { ok: true, status: 200, body: { ...issue, display_id: `#${issue.ticket_number}` } };
}

export async function rejectIssueMutation(input: {
  issueId: string;
  principal: Principal;
  userId: string;
  workspaceId: string;
  reason: string;
}): Promise<IssueMutationResult<Record<string, unknown>>> {
  const { issueId: id, principal, userId, workspaceId, reason } = input;

  const denied = await guardIssueMutation(pool, principal, {
    action: 'write',
    documentId: id,
    expectedType: 'issue',
  });
  if (denied) return denied;

  const existing = await pool.query<IssuePropertiesRow>(
    `SELECT id, properties FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
    [id, workspaceId]
  );

  if (existing.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Issue not found' } };
  }

  const props = (requireFirstRow(existing.rows).properties ?? {}) as Partial<IssueProperties>;
  if (props.state !== 'triage') {
    return { ok: false, status: 400, body: { error: 'Issue must be in triage state to be rejected' } };
  }

  const newProps = { ...props, state: 'cancelled' as const, rejection_reason: reason };
  const result = await pool.query<IssueDocumentRow>(
    `UPDATE documents
     SET properties = $3, cancelled_at = NOW(), updated_at = now()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *`,
    [id, workspaceId, JSON.stringify(newProps)]
  );

  await logDocumentChange(id, 'state', 'triage', 'cancelled', userId);
  await enqueueFleetGraphIssueAttentionEvents({
    workspaceId,
    issueIds: [id],
    eventType: 'issue_changed',
    reason: 'issue_rejected',
  });
  const issue = extractIssueFromRow(requireFirstRow(result.rows));
  return { ok: true, status: 200, body: { ...issue, display_id: `#${issue.ticket_number}` } };
}
