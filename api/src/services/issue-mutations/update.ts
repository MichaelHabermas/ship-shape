// Issue update mutation owns document-backed issue patches, audit changes, and side effects.
import type { BelongsTo, IssueProperties, IssueState, WebhookEvent } from '@ship/shared';
import { pool } from '../../db/client.js';
import { extractIssueFromRow, type IssueDocumentRow } from '../../db/documents-repository.js';
import { guardIssueMutation } from '../issue-mutation-guards.js';
import {
  logDocumentChange,
  getTimestampUpdates,
  getBelongsToAssociations,
  syncBelongsToAssociations,
} from '../../utils/document-crud.js';
import { broadcastToUser } from '../../collaboration/index.js';
import {
  expectedTypeForRelationship,
  getDocumentAccessContext,
  requireReferenceableDocument,
} from '../document-access.js';
import { VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import { enqueueFleetGraphIssueAttentionEvents } from '../../fleetgraph/events.js';
import {
  commitDomainWebhooks,
  publishDomainWebhookInTransaction,
} from '../../platform/webhooks/mutation-publisher.js';
import {
  type CountRow,
  type IncompleteChildRow,
  type IssueMutationResult,
  type IssueTitlePropertiesRow,
  type OldSprintRow,
  type UpdateIssueInput,
  toCount,
} from './types.js';
import {
  buildIssueAssignedWebhookEvent,
  buildIssueStatusChangedWebhookEvent,
} from './webhook-events.js';

export async function updateIssueMutation(
  input: UpdateIssueInput
): Promise<IssueMutationResult<Record<string, unknown>>> {
  const { client, actor, principal, userId, workspaceId, issueId: id, data } = input;

  const denied = await guardIssueMutation(client, principal, {
    action: 'write',
    documentId: id,
    expectedType: 'issue',
  });
  if (denied) return denied;

  const { isAdmin } = await getDocumentAccessContext(actor, client);

  const existing = await client.query<IssueTitlePropertiesRow>(
    `SELECT id, title, properties
     FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
    [id, workspaceId]
  );

  if (existing.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Issue not found' } };
  }

  const existingIssue = requireFirstRow(existing.rows);
  const currentProps = (existingIssue.properties ?? {}) as Partial<IssueProperties>;
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.belongs_to) {
    const hasSprintAssociation = data.belongs_to.some((bt) => bt.type === 'sprint');
    if (hasSprintAssociation) {
      const effectiveEstimate = data.estimate !== undefined ? data.estimate : currentProps.estimate;
      if (!effectiveEstimate) {
        return { ok: false, status: 400, body: { error: 'Estimate is required before assigning to a week' } };
      }
    }
  }

  const isClosingIssue = data.state && (data.state === 'done' || data.state === 'cancelled');
  const wasNotClosed = currentProps.state !== 'done' && currentProps.state !== 'cancelled';

  if (isClosingIssue && wasNotClosed) {
    const childrenResult = await client.query<IncompleteChildRow>(
      `SELECT d.id, d.title, d.ticket_number, d.properties->>'state' as state
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id
       WHERE da.related_id = $1
         AND da.relationship_type = 'parent'
         AND d.workspace_id = $2
         AND d.document_type = 'issue'
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    const incompleteChildren = childrenResult.rows.filter(
      (child) => child.state !== 'done' && child.state !== 'cancelled'
    );

    if (incompleteChildren.length > 0 && !data.confirm_orphan_children) {
      return {
        ok: false,
        status: 409,
        body: {
          error: 'incomplete_children',
          message: `This issue has ${incompleteChildren.length} incomplete sub-issue(s). Closing it will remove their parent association.`,
          incomplete_children: incompleteChildren.map((child) => ({
            id: child.id,
            title: child.title,
            ticket_number: child.ticket_number,
            state: child.state,
          })),
          confirm_action: 'Set confirm_orphan_children: true to proceed',
        },
      };
    }

    if (incompleteChildren.length > 0 && data.confirm_orphan_children) {
      await client.query(
        `DELETE FROM document_associations
         WHERE related_id = $1
           AND relationship_type = 'parent'`,
        [id]
      );
    }
  }

  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
  let assignedWebhookAssigneeId: string | null = null;
  let statusChangedWebhook: { previousStatus: IssueState | null; status: IssueState } | null = null;

  if (data.title !== undefined && data.title !== existingIssue.title) {
    updates.push(`title = $${paramIndex++}`);
    values.push(data.title);
    changes.push({ field: 'title', oldValue: existingIssue.title, newValue: data.title });
  }

  const newProps = { ...currentProps };
  let propsChanged = false;

  if (data.state !== undefined && data.state !== currentProps.state) {
    changes.push({ field: 'state', oldValue: currentProps.state || null, newValue: data.state });
    newProps.state = data.state;
    propsChanged = true;
    statusChangedWebhook = {
      previousStatus: issueStateOrNull(currentProps.state),
      status: data.state,
    };
    const timestampUpdates = getTimestampUpdates(currentProps.state || null, data.state);
    for (const [col, expr] of Object.entries(timestampUpdates)) {
      updates.push(`${col} = ${expr}`);
    }
  }
  if (data.priority !== undefined && data.priority !== currentProps.priority) {
    changes.push({ field: 'priority', oldValue: currentProps.priority || null, newValue: data.priority });
    newProps.priority = data.priority;
    propsChanged = true;
  }
  if (data.assignee_id !== undefined && data.assignee_id !== currentProps.assignee_id) {
    changes.push({ field: 'assignee_id', oldValue: currentProps.assignee_id || null, newValue: data.assignee_id });
    newProps.assignee_id = data.assignee_id;
    propsChanged = true;
    assignedWebhookAssigneeId = data.assignee_id ?? null;
  }
  if (data.estimate !== undefined && data.estimate !== currentProps.estimate) {
    changes.push({
      field: 'estimate',
      oldValue: currentProps.estimate?.toString() || null,
      newValue: data.estimate?.toString() || null,
    });
    newProps.estimate = data.estimate;
    propsChanged = true;
  }

  if (data.claude_metadata) {
    newProps.claude_metadata = {
      ...data.claude_metadata,
      updated_at: new Date().toISOString(),
    };
    propsChanged = true;
  }

  let propsValueIndex = -1;
  if (propsChanged) {
    updates.push(`properties = $${paramIndex++}`);
    propsValueIndex = values.length;
    values.push(JSON.stringify(newProps));
  }

  let belongsToChanged = false;
  let oldBelongsTo: BelongsTo[] = [];
  let newBelongsTo: BelongsTo[] = [];

  if (data.belongs_to !== undefined) {
    oldBelongsTo = await getBelongsToAssociations(id);
    newBelongsTo = data.belongs_to;

    const oldIds = oldBelongsTo.map((bt) => `${bt.type}:${bt.id}`).sort().join(',');
    const newIds = newBelongsTo.map((bt) => `${bt.type}:${bt.id}`).sort().join(',');

    if (oldIds !== newIds) {
      belongsToChanged = true;

      const oldSprintAssoc = oldBelongsTo.find((bt) => bt.type === 'sprint');
      const newSprintAssoc = newBelongsTo.find((bt) => bt.type === 'sprint');

      if (oldSprintAssoc && newSprintAssoc && oldSprintAssoc.id !== newSprintAssoc.id && currentProps.state !== 'done') {
        const oldSprintResult = await client.query<OldSprintRow>(
          `SELECT properties->>'sprint_number' as sprint_number, w.sprint_start_date
           FROM documents d
           JOIN workspaces w ON d.workspace_id = w.id
           WHERE d.id = $1 AND d.document_type = 'sprint'`,
          [oldSprintAssoc.id]
        );

        if (oldSprintResult.rows.length > 0) {
          const oldSprint = requireFirstRow(oldSprintResult.rows);
          const sprintNumber = parseInt(oldSprint.sprint_number ?? '', 10);
          const rawStartDate = oldSprint.sprint_start_date;
          const sprintDuration = 7;

          let startDate: Date;
          if (rawStartDate instanceof Date) {
            startDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
          } else if (typeof rawStartDate === 'string') {
            startDate = new Date(rawStartDate + 'T00:00:00Z');
          } else {
            startDate = new Date();
          }

          const sprintEndDate = new Date(startDate);
          sprintEndDate.setUTCDate(sprintEndDate.getUTCDate() + sprintNumber * sprintDuration - 1);

          if (new Date() > sprintEndDate) {
            newProps.carryover_from_sprint_id = oldSprintAssoc.id;
            propsChanged = true;
          }
        }
      } else if (oldSprintAssoc && !newSprintAssoc) {
        delete newProps.carryover_from_sprint_id;
        propsChanged = true;
      }

      changes.push({
        field: 'belongs_to',
        oldValue: JSON.stringify(oldBelongsTo.map((bt) => ({ id: bt.id, type: bt.type }))),
        newValue: JSON.stringify(newBelongsTo.map((bt) => ({ id: bt.id, type: bt.type }))),
      });
    }
  }

  if (propsChanged && propsValueIndex === -1) {
    updates.push(`properties = $${paramIndex++}`);
    propsValueIndex = values.length;
    values.push(JSON.stringify(newProps));
  } else if (propsChanged && propsValueIndex >= 0) {
    values[propsValueIndex] = JSON.stringify(newProps);
  }

  if (updates.length === 0 && !belongsToChanged) {
    return { ok: false, status: 400, body: { error: 'No fields to update' } };
  }

  await client.query('BEGIN');

  const automatedBy = data.claude_metadata?.updated_by;
  for (const change of changes) {
    await logDocumentChange(id, change.field, change.oldValue, change.newValue, userId, automatedBy, client);
  }

  if (updates.length > 0) {
    updates.push(`updated_at = now()`);
    await client.query(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1}`,
      [...values, id, workspaceId]
    );
  }

  if (belongsToChanged) {
    for (const assoc of newBelongsTo) {
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
      id,
      newBelongsTo.map((assoc) => ({ id: assoc.id, type: assoc.type })),
      client
    );
  }

  const result = await client.query<IssueDocumentRow>(
    `SELECT * FROM documents WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  const row = requireFirstRow(result.rows);

  const webhookEvents: WebhookEvent[] = [];
  if (assignedWebhookAssigneeId) {
    webhookEvents.push(buildIssueAssignedWebhookEvent({
      workspaceId,
      actorUserId: userId,
      row,
      assigneeId: assignedWebhookAssigneeId,
    }));
  }
  if (statusChangedWebhook) {
    webhookEvents.push(buildIssueStatusChangedWebhookEvent({
      workspaceId,
      actorUserId: userId,
      row,
      previousStatus: statusChangedWebhook.previousStatus,
      status: statusChangedWebhook.status,
    }));
  }

  const webhookDeliveryIds: string[] = [];
  for (const webhookEvent of webhookEvents) {
    const webhook = await publishDomainWebhookInTransaction(webhookEvent, client);
    webhookDeliveryIds.push(...webhook.deliveryIds);
  }

  await client.query('COMMIT');
  commitDomainWebhooks(webhookDeliveryIds);

  await enqueueFleetGraphIssueAttentionEvents({
    workspaceId,
    issueIds: [id],
    eventType: belongsToChanged ? 'issue_week_changed' : 'issue_changed',
    reason: belongsToChanged ? 'issue_belongs_to_changed' : 'issue_updated',
  });

  if (belongsToChanged) {
    const oldSprintIds = oldBelongsTo.filter((bt) => bt.type === 'sprint').map((bt) => bt.id);
    const newSprintIds = newBelongsTo.filter((bt) => bt.type === 'sprint').map((bt) => bt.id);
    const addedSprintIds = newSprintIds.filter((sprintId) => !oldSprintIds.includes(sprintId));

    for (const sprintId of addedSprintIds) {
      const issueCountResult = await pool.query<CountRow>(
        `SELECT COUNT(*) as count FROM document_associations
         WHERE related_id = $1 AND relationship_type = 'sprint'`,
        [sprintId]
      );
      const issueCount = toCount(requireFirstRow(issueCountResult.rows).count);
      if (issueCount === 1) {
        broadcastToUser(userId, 'accountability:updated', { type: 'week_issues', targetId: sprintId });
      }
    }
  }

  const issue = extractIssueFromRow(row);
  const belongsTo = await getBelongsToAssociations(id);

  if (isClosingIssue && wasNotClosed) {
    const props = (row.properties ?? {}) as Partial<IssueProperties>;
    if (props.source === 'action_items') {
      const assigneeId = props.assignee_id || userId;
      broadcastToUser(assigneeId, 'accountability:updated', { issueId: id, state: data.state });
    }
  }

  return {
    ok: true,
    status: 200,
    body: { ...issue, display_id: `#${row.ticket_number}`, belongs_to: belongsTo },
  };
}

function issueStateOrNull(value: unknown): IssueState | null {
  if (
    value === 'backlog' ||
    value === 'triage' ||
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'in_review' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'cancelled'
  ) {
    return value;
  }
  return null;
}
