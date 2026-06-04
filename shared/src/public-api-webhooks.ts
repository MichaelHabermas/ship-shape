// Public webhook delivery contracts shared by API event publication, SDK verification, and tests.
import { z } from 'zod';
import {
  DOCUMENT_TYPE_VALUES,
  ISSUE_STATE_VALUES,
} from './enums/document-enums.js';
import {
  PublicApiScopeSchema,
  PublicSprintStatusSchema,
  WEBHOOK_EVENT_TYPES,
} from './public-api.js';

export const WebhookActorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional(),
  email: z.string().optional(),
});

export const DocumentWebhookResourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  document_type: z.enum(DOCUMENT_TYPE_VALUES),
  api_url: z.string(),
  ui_url: z.string(),
});

export const DocumentCreatedWebhookPayloadSchema = z.object({
  document: DocumentWebhookResourceSchema,
  actor: WebhookActorSchema.optional(),
});

export const DocumentUpdatedWebhookPayloadSchema = z.object({
  document: DocumentWebhookResourceSchema,
  actor: WebhookActorSchema.optional(),
  updated_at: z.string().optional(),
});

export const DocumentDeletedWebhookPayloadSchema = z.object({
  document: DocumentWebhookResourceSchema,
  actor: WebhookActorSchema.optional(),
  deleted_at: z.string().optional(),
});

export const IssueWebhookResourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  display_id: z.string(),
  ticket_number: z.number().int().nullable(),
  state: z.enum(ISSUE_STATE_VALUES),
  assignee_id: z.string().uuid().nullable(),
  api_url: z.string(),
  ui_url: z.string(),
});

export const IssueCreatedWebhookPayloadSchema = z.object({
  issue: IssueWebhookResourceSchema,
  actor: WebhookActorSchema.optional(),
});

export const IssueAssignedWebhookPayloadSchema = z.object({
  issue: IssueWebhookResourceSchema,
  assignee: WebhookActorSchema.nullable(),
  actor: WebhookActorSchema.optional(),
});

export const IssueStatusChangedWebhookPayloadSchema = z.object({
  issue: IssueWebhookResourceSchema,
  previous_status: z.enum(ISSUE_STATE_VALUES).nullable(),
  status: z.enum(ISSUE_STATE_VALUES),
  actor: WebhookActorSchema.optional(),
});

export const SprintWebhookResourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  sprint_number: z.number().int().positive(),
  status: PublicSprintStatusSchema,
  api_url: z.string(),
  ui_url: z.string(),
});

export const SprintStartedWebhookPayloadSchema = z.object({
  sprint: SprintWebhookResourceSchema,
  actor: WebhookActorSchema.optional(),
});

export const SprintCompletedWebhookPayloadSchema = z.object({
  sprint: SprintWebhookResourceSchema,
  actor: WebhookActorSchema.optional(),
});

export const WebhookEventResourceSchema = z.object({
  kind: z.literal('document'),
  id: z.string().uuid(),
  document_type: z.enum(DOCUMENT_TYPE_VALUES),
});

export type DocumentWebhookResource = z.infer<typeof DocumentWebhookResourceSchema>;
export type DocumentCreatedWebhookPayload = z.infer<typeof DocumentCreatedWebhookPayloadSchema>;
export type DocumentUpdatedWebhookPayload = z.infer<typeof DocumentUpdatedWebhookPayloadSchema>;
export type DocumentDeletedWebhookPayload = z.infer<typeof DocumentDeletedWebhookPayloadSchema>;
export type IssueCreatedWebhookPayload = z.infer<typeof IssueCreatedWebhookPayloadSchema>;
export type IssueAssignedWebhookPayload = z.infer<typeof IssueAssignedWebhookPayloadSchema>;
export type IssueStatusChangedWebhookPayload = z.infer<typeof IssueStatusChangedWebhookPayloadSchema>;
export type SprintWebhookResource = z.infer<typeof SprintWebhookResourceSchema>;
export type SprintStartedWebhookPayload = z.infer<typeof SprintStartedWebhookPayloadSchema>;
export type SprintCompletedWebhookPayload = z.infer<typeof SprintCompletedWebhookPayloadSchema>;
export type WebhookEventResource = z.infer<typeof WebhookEventResourceSchema>;

export const WebhookEventSchema = z.object({
  type: z.enum(WEBHOOK_EVENT_TYPES),
  workspace_id: z.string().uuid(),
  idempotency_key: z.string(),
  resource: WebhookEventResourceSchema,
  payload: z.record(z.unknown()),
  required_scopes: z.array(PublicApiScopeSchema).optional(),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
