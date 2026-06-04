// Webhook event registry names and validates public event payloads as data.
import { z } from 'zod';
import {
  DocumentCreatedWebhookPayloadSchema,
  DocumentDeletedWebhookPayloadSchema,
  DocumentUpdatedWebhookPayloadSchema,
  IssueAssignedWebhookPayloadSchema,
  IssueCreatedWebhookPayloadSchema,
  IssueStatusChangedWebhookPayloadSchema,
  SprintCompletedWebhookPayloadSchema,
  SprintStartedWebhookPayloadSchema,
  type DocumentType,
  type PublicApiScope,
  type WebhookEvent,
  type WebhookEventType,
  WebhookEventResourceSchema,
} from '@ship/shared';

export const WEBHOOK_EVENT_SCHEMAS = {
  'document.created': DocumentCreatedWebhookPayloadSchema,
  'document.updated': DocumentUpdatedWebhookPayloadSchema,
  'document.deleted': DocumentDeletedWebhookPayloadSchema,
  'issue.created': IssueCreatedWebhookPayloadSchema,
  'issue.assigned': IssueAssignedWebhookPayloadSchema,
  'issue.status_changed': IssueStatusChangedWebhookPayloadSchema,
  'sprint.started': SprintStartedWebhookPayloadSchema,
  'sprint.completed': SprintCompletedWebhookPayloadSchema,
} satisfies Record<WebhookEventType, z.ZodTypeAny>;

export function parseWebhookEvent(event: WebhookEvent): WebhookEvent {
  WEBHOOK_EVENT_SCHEMAS[event.type].parse(event.payload);
  WebhookEventResourceSchema.parse(event.resource);
  return event;
}

export function readScopeForWebhookEvent(eventType: WebhookEventType): PublicApiScope {
  if (eventType.startsWith('issue.')) return 'issues:read';
  if (eventType.startsWith('sprint.')) return 'sprints:read';
  return 'documents:read';
}

export function expectedDocumentTypeForWebhookEvent(
  eventType: WebhookEventType,
  resourceDocumentType: DocumentType
): DocumentType {
  if (eventType.startsWith('issue.')) return 'issue';
  if (eventType.startsWith('sprint.')) return 'sprint';
  return resourceDocumentType;
}
