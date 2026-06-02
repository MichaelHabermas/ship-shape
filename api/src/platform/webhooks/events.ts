// Canonical initial webhook event names. Payload schemas and domain publication
// points are intentionally not defined in this anchor.
export const WEBHOOK_EVENT_TYPES = [
  'document.created',
  'document.updated',
  'document.deleted',
  'issue.created',
  'issue.assigned',
  'issue.status_changed',
  'sprint.started',
  'sprint.completed',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
