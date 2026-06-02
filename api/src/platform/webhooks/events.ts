// Webhook event registry names and validates public event payloads as data.
import { z } from 'zod';
import {
  DocumentCreatedWebhookPayloadSchema,
  IssueAssignedWebhookPayloadSchema,
  IssueCreatedWebhookPayloadSchema,
  IssueStatusChangedWebhookPayloadSchema,
  type WebhookEvent,
  type WebhookEventType,
} from '@ship/shared';

const genericWebhookPayloadSchema = z.record(z.unknown());

export const WEBHOOK_EVENT_SCHEMAS = {
  'document.created': DocumentCreatedWebhookPayloadSchema,
  'document.updated': genericWebhookPayloadSchema,
  'document.deleted': genericWebhookPayloadSchema,
  'issue.created': IssueCreatedWebhookPayloadSchema,
  'issue.assigned': IssueAssignedWebhookPayloadSchema,
  'issue.status_changed': IssueStatusChangedWebhookPayloadSchema,
  'sprint.started': genericWebhookPayloadSchema,
  'sprint.completed': genericWebhookPayloadSchema,
} satisfies Record<WebhookEventType, z.ZodTypeAny>;

export function parseWebhookEvent(event: WebhookEvent): WebhookEvent {
  WEBHOOK_EVENT_SCHEMAS[event.type].parse(event.payload);
  return event;
}
