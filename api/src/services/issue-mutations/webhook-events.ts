// Issue webhook helpers build public event payloads from issue rows.
import type { IssueState, WebhookEvent, WebhookEventResource } from '@ship/shared';
import type { IssueDocumentRow } from '../../db/documents-repository.js';
import { issueCoreFromDocumentRow, webhookIssueResourceFromCore } from './issue-core.js';

type IssueWebhookInput = {
  workspaceId: string;
  actorUserId: string;
  row: IssueDocumentRow;
};

export function buildIssueCreatedWebhookEvent(input: IssueWebhookInput): WebhookEvent {
  return {
    type: 'issue.created',
    workspace_id: input.workspaceId,
    idempotency_key: `issue.created:${input.row.id}`,
    resource: issueWebhookResourceMetadata(input.row),
    payload: {
      issue: issueWebhookResource(input.row),
      actor: { id: input.actorUserId },
    },
  };
}

export function buildIssueAssignedWebhookEvent(
  input: IssueWebhookInput & { assigneeId: string }
): WebhookEvent {
  return {
    type: 'issue.assigned',
    workspace_id: input.workspaceId,
    idempotency_key: `issue.assigned:${input.row.id}:${input.row.updated_at.toISOString()}`,
    resource: issueWebhookResourceMetadata(input.row),
    payload: {
      issue: issueWebhookResource(input.row),
      assignee: { id: input.assigneeId },
      actor: { id: input.actorUserId },
    },
  };
}

export function buildIssueStatusChangedWebhookEvent(
  input: IssueWebhookInput & { previousStatus: IssueState | null; status: IssueState }
): WebhookEvent {
  return {
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
  };
}

function issueWebhookResource(row: IssueDocumentRow) {
  return webhookIssueResourceFromCore(issueCoreFromDocumentRow(row));
}

function issueWebhookResourceMetadata(row: IssueDocumentRow): WebhookEventResource {
  return {
    kind: 'document',
    id: row.id,
    document_type: 'issue',
  };
}
