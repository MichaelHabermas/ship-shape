import { pool } from '../../db/client.js';
import { extractIssueFromRow, type IssueDocumentRow } from '../../db/documents-repository.js';
import { guardIssueCreate } from '../issue-mutation-guards.js';
import {
  getBelongsToAssociations,
  syncBelongsToAssociations,
} from '../../utils/document-crud.js';
import { broadcastToUser } from '../../collaboration/index.js';
import {
  expectedTypeForRelationship,
  requireReferenceableDocument,
} from '../document-access.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import { enqueueFleetGraphIssueAttentionEvents } from '../../fleetgraph/events.js';
import {
  type CreateIssueInput,
  type CountRow,
  type IssueMutationResult,
  type TicketNumberRow,
  toCount,
  workspaceAdvisoryLock,
} from './types.js';

export async function createIssueMutation(
  input: CreateIssueInput
): Promise<IssueMutationResult<Record<string, unknown>>> {
  const { client, actor, principal, userId, workspaceId, data } = input;

  const denied = await guardIssueCreate(client, principal);
  if (denied) return denied;
  const {
    title,
    state,
    priority,
    assignee_id,
    belongs_to,
    source,
    due_date,
    is_system_generated,
    accountability_target_id,
    accountability_type,
  } = data;

  await client.query('BEGIN');
  await workspaceAdvisoryLock(client, workspaceId);

  const ticketResult = await client.query<TicketNumberRow>(
    `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
     FROM documents
     WHERE workspace_id = $1 AND document_type = 'issue'`,
    [workspaceId]
  );
  const ticketNumber = requireFirstRow(ticketResult.rows).next_number;

  const properties = {
    state: state || 'backlog',
    priority: priority || 'medium',
    source: source || 'internal',
    assignee_id: assignee_id || null,
    rejection_reason: null,
    due_date: due_date || null,
    is_system_generated: is_system_generated || false,
    accountability_target_id: accountability_target_id || null,
    accountability_type: accountability_type || null,
  };

  const result = await client.query<IssueDocumentRow>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, created_by)
     VALUES ($1, 'issue', $2, $3, $4, $5)
     RETURNING *`,
    [workspaceId, title, JSON.stringify(properties), ticketNumber, userId]
  );

  const newIssueId = requireFirstRow(result.rows).id;

  for (const assoc of belongs_to) {
    try {
      await requireReferenceableDocument(
        client,
        actor,
        assoc.id,
        expectedTypeForRelationship(assoc.type)
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'DOCUMENT_NOT_READABLE') {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, body: { error: 'Referenced document not found' } };
      }
      throw error;
    }
  }

  await syncBelongsToAssociations(
    newIssueId,
    belongs_to.map((assoc) => ({ id: assoc.id, type: assoc.type })),
    client
  );

  const sprintAssociations = belongs_to.filter((bt) => bt.type === 'sprint');
  await client.query('COMMIT');

  await enqueueFleetGraphIssueAttentionEvents({
    workspaceId,
    issueIds: [newIssueId],
    eventType: sprintAssociations.length > 0 ? 'issue_week_changed' : 'issue_changed',
    reason: 'issue_created',
  });

  for (const sprintAssoc of sprintAssociations) {
    const issueCountResult = await pool.query<CountRow>(
      `SELECT COUNT(*) as count FROM document_associations
       WHERE related_id = $1 AND relationship_type = 'sprint'`,
      [sprintAssoc.id]
    );
    const issueCount = toCount(requireFirstRow(issueCountResult.rows).count);
    if (issueCount === 1) {
      broadcastToUser(userId, 'accountability:updated', { type: 'week_issues', targetId: sprintAssoc.id });
    }
  }

  const belongsToResult = await getBelongsToAssociations(newIssueId);
  const row = requireFirstRow(result.rows);
  const issue = extractIssueFromRow(row);
  return {
    ok: true,
    status: 201,
    body: {
      ...issue,
      display_id: `#${ticketNumber}`,
      belongs_to: belongsToResult,
    },
  };
}
