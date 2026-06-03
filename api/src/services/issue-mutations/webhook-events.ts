// Issue webhook helpers build public event payloads from committed issue rows.
import type { IssueState, WebhookEventResource } from '@ship/shared';
import type { PoolClient } from 'pg';
import type { IssueDocumentRow } from '../../db/documents-repository.js';
import { enqueueWebhookEvent } from '../../platform/webhooks/service.js';

type IssueWebhookInput = {
  client: PoolClient;
  workspaceId: string;
  actorUserId: string;
  row: IssueDocumentRow;
};

export async function enqueueIssueCreatedWebhook(input: IssueWebhookInput): Promise<string[]> {
  const enqueued = await enqueueWebhookEvent({
    type: 'issue.created',
    workspace_id: input.workspaceId,
    idempotency_key: `issue.created:${input.row.id}`,
    resource: issueWebhookResourceMetadata(input.row),
    payload: {
      issue: issueWebhookResource(input.row),
      actor: { id: input.actorUserId },
    },
  }, input.client);
  return enqueued.deliveryIds;
}

export async function enqueueIssueAssignedWebhook(
  input: IssueWebhookInput & { assigneeId: string }
): Promise<string[]> {
  const enqueued = await enqueueWebhookEvent({
    type: 'issue.assigned',
    workspace_id: input.workspaceId,
    idempotency_key: `issue.assigned:${input.row.id}:${input.row.updated_at.toISOString()}`,
    resource: issueWebhookResourceMetadata(input.row),
    payload: {
      issue: issueWebhookResource(input.row),
      assignee: { id: input.assigneeId },
      actor: { id: input.actorUserId },
    },
  }, input.client);
  return enqueued.deliveryIds;
}

export async function enqueueIssueStatusChangedWebhook(
  input: IssueWebhookInput & { previousStatus: IssueState | null; status: IssueState }
): Promise<string[]> {
  const enqueued = await enqueueWebhookEvent({
    type: 'issue.status_changed',
    workspace_id: input.workspaceId,
    idempotency_key: `issue.status_changed:${input.row.id}:${input.row.updated_at.toISOString()}`,
    resource: issueWebhookResourceMetadata(input.row),
    payload: {
      issue: issueWebhookResource(input.row),
      previous_status: input.previousStatus,
      status: input.status,
      actor: { id: input.actorUserId },
    },
  }, input.client);
  return enqueued.deliveryIds;
}

function issueWebhookResource(row: IssueDocumentRow) {
  const props = row.properties ?? {};
  const state = typeof props.state === 'string' ? props.state : 'backlog';
  const assigneeId = typeof props.assignee_id === 'string' ? props.assignee_id : null;
  return {
    id: row.id,
    title: row.title,
    display_id: row.ticket_number === null ? '' : `#${row.ticket_number}`,
    ticket_number: row.ticket_number,
    state,
    assignee_id: assigneeId,
    api_url: `/api/v1/issues/${row.id}`,
    ui_url: `/documents/${row.id}`,
  };
}

function issueWebhookResourceMetadata(row: IssueDocumentRow): WebhookEventResource {
  return {
    kind: 'document',
    id: row.id,
    document_type: 'issue',
  };
}
