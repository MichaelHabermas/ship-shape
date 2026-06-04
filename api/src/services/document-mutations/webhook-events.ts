// Document webhook helpers build public event payloads from document rows.
import crypto from 'node:crypto';
import type { WebhookEvent, WebhookEventResource } from '@ship/shared';
import type { DocumentAccessRow } from './types.js';
import {
  documentCoreFromRow,
  documentWebhookResourceFromCore,
} from './document-core.js';

type DocumentWebhookInput = {
  workspaceId: string;
  actorUserId: string;
  row: DocumentAccessRow;
};

export function buildDocumentCreatedWebhookEvent(input: DocumentWebhookInput): WebhookEvent {
  return {
    type: 'document.created',
    workspace_id: input.workspaceId,
    idempotency_key: `document.created:${input.row.id}`,
    resource: documentWebhookResourceMetadata(input.row),
    payload: {
      document: documentWebhookResource(input.row),
      actor: { id: input.actorUserId },
    },
  };
}

export function buildDocumentUpdatedWebhookEvent(input: DocumentWebhookInput): WebhookEvent {
  return {
    type: 'document.updated',
    workspace_id: input.workspaceId,
    idempotency_key: `document.updated:${input.row.id}:${input.row.updated_at.toISOString()}:${crypto.randomUUID()}`,
    resource: documentWebhookResourceMetadata(input.row),
    payload: {
      document: documentWebhookResource(input.row),
      actor: { id: input.actorUserId },
      updated_at: input.row.updated_at.toISOString(),
    },
  };
}

export function buildDocumentDeletedWebhookEvent(
  input: DocumentWebhookInput & { deletedAt: Date }
): WebhookEvent {
  return {
    type: 'document.deleted',
    workspace_id: input.workspaceId,
    idempotency_key: `document.deleted:${input.row.id}:${input.deletedAt.toISOString()}`,
    resource: documentWebhookResourceMetadata(input.row),
    payload: {
      document: documentWebhookResource(input.row),
      actor: { id: input.actorUserId },
      deleted_at: input.deletedAt.toISOString(),
    },
  };
}

export function buildSprintStartedWebhookEvent(input: DocumentWebhookInput): WebhookEvent {
  return buildSprintLifecycleWebhookEvent('sprint.started', input);
}

export function buildSprintCompletedWebhookEvent(input: DocumentWebhookInput): WebhookEvent {
  return buildSprintLifecycleWebhookEvent('sprint.completed', input);
}

function documentWebhookResource(row: DocumentAccessRow) {
  return documentWebhookResourceFromCore(documentCoreFromRow(row));
}

function documentWebhookResourceMetadata(row: DocumentAccessRow): WebhookEventResource {
  return {
    kind: 'document',
    id: row.id,
    document_type: row.document_type,
  };
}

function buildSprintLifecycleWebhookEvent(
  type: 'sprint.started' | 'sprint.completed',
  input: DocumentWebhookInput
): WebhookEvent {
  return {
    type,
    workspace_id: input.workspaceId,
    idempotency_key: `${type}:${input.row.id}:${input.row.updated_at.toISOString()}:${crypto.randomUUID()}`,
    resource: documentWebhookResourceMetadata(input.row),
    payload: {
      sprint: sprintWebhookResource(input.row),
      actor: { id: input.actorUserId },
    },
  };
}

function sprintWebhookResource(row: DocumentAccessRow) {
  const props = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    sprint_number: numberProp(props.sprint_number, 1),
    status: sprintStatus(props.status),
    api_url: `/api/v1/sprints/${row.id}`,
    ui_url: `/documents/${row.id}`,
  };
}

function numberProp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function sprintStatus(value: unknown): 'planning' | 'active' | 'completed' {
  return value === 'active' || value === 'completed' || value === 'planning'
    ? value
    : 'planning';
}
