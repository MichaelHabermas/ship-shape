// Public developer API contracts shared by OAuth, SDK, OpenAPI, web, and tests.
import { z } from 'zod';
import {
  BELONGS_TO_TYPE_VALUES,
  DOCUMENT_TYPE_VALUES,
  DOCUMENT_VISIBILITY_VALUES,
  ISSUE_PRIORITY_VALUES,
  ISSUE_SOURCE_VALUES,
  ISSUE_STATE_VALUES,
} from './enums/document-enums.js';

export const PUBLIC_API_SCOPES = [
  'documents:read',
  'documents:write',
  'issues:read',
  'issues:write',
  'sprints:read',
  'sprints:write',
  'webhooks:manage',
] as const;

export const PUBLIC_API_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  'server_error',
] as const;

export const OAUTH_ERROR_CODES = [
  'access_denied',
  'authorization_pending',
  'expired_token',
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'invalid_scope',
  'slow_down',
  'unsupported_grant_type',
] as const;

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

export const WEBHOOK_DELIVERY_STATUS_VALUES = [
  'pending',
  'sending',
  'succeeded',
  'retrying',
  'failed',
  'dlq',
] as const;

export const PublicApiScopeSchema = z.enum(PUBLIC_API_SCOPES);
export const PublicApiErrorSchema = z.object({
  code: z.enum(PUBLIC_API_ERROR_CODES),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  request_id: z.string(),
});

export const PublicIncompleteChildSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  ticket_number: z.number().int().nullable(),
  state: z.enum(ISSUE_STATE_VALUES).nullable(),
});

export const PublicIssueIncompleteChildrenDetailsSchema = z.object({
  reason: z.literal('incomplete_children'),
  incomplete_children: z.array(PublicIncompleteChildSchema),
  confirm_action: z.string(),
});

export const PublicIssueUpdateConflictErrorSchema = PublicApiErrorSchema.extend({
  details: PublicIssueIncompleteChildrenDetailsSchema,
});

export const PublicMeResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  }),
  app: z.object({
    client_id: z.string(),
  }),
  workspace_id: z.string().uuid(),
  granted_scopes: z.array(PublicApiScopeSchema),
});

export const PublicDocumentCreateSchema = z.object({
  title: z.string().min(1).max(255).optional().default('Untitled'),
  document_type: z.enum(DOCUMENT_TYPE_VALUES).optional().default('wiki'),
  parent_id: z.string().uuid().optional().nullable(),
  properties: z.record(z.unknown()).optional(),
  visibility: z.enum(DOCUMENT_VISIBILITY_VALUES).optional(),
  content: z.unknown().optional(),
});

export const PublicDocumentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  type: z.enum(DOCUMENT_TYPE_VALUES).optional(),
});

export const PublicDocumentParamsSchema = z.object({
  id: z.string().uuid(),
});

export const PublicDocumentSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  document_type: z.enum(DOCUMENT_TYPE_VALUES),
  title: z.string(),
  parent_id: z.string().uuid().nullable(),
  ticket_number: z.number().int().nullable(),
  properties: z.record(z.unknown()),
  content: z.unknown().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().uuid(),
  visibility: z.enum(DOCUMENT_VISIBILITY_VALUES),
});

export const PublicDocumentsListResponseSchema = z.object({
  data: z.array(PublicDocumentSchema),
  next_cursor: z.string().nullable(),
});

export const PublicBelongsToSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(BELONGS_TO_TYPE_VALUES),
  title: z.string().optional(),
  color: z.string().optional(),
});

export const PublicIssueCreateSchema = z.object({
  title: z.string().min(1).max(500),
  state: z.enum(ISSUE_STATE_VALUES).optional().default('backlog'),
  priority: z.enum(ISSUE_PRIORITY_VALUES).optional().default('medium'),
  assignee_id: z.string().uuid().optional().nullable(),
  belongs_to: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(BELONGS_TO_TYPE_VALUES),
  })).optional().default([]),
  source: z.enum(ISSUE_SOURCE_VALUES).optional().default('external'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const PublicIssueUpdateBaseSchema = z.object({
  confirm_orphan_children: z.boolean().optional(),
});

export const PublicIssueUpdateSchema = z.union([
  PublicIssueUpdateBaseSchema.extend({
    state: z.enum(ISSUE_STATE_VALUES),
    assignee_id: z.string().uuid().optional().nullable(),
  }),
  PublicIssueUpdateBaseSchema.extend({
    state: z.enum(ISSUE_STATE_VALUES).optional(),
    assignee_id: z.string().uuid().nullable(),
  }),
]);

export const PublicIssueListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  state: z.string().optional(),
  priority: z.enum(ISSUE_PRIORITY_VALUES).optional(),
  assignee_id: z.string().optional(),
  program_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  sprint_id: z.string().uuid().optional(),
  source: z.enum(ISSUE_SOURCE_VALUES).optional(),
  parent_filter: z.enum(['top_level', 'has_children', 'is_sub_issue']).optional(),
});

export const PublicIssueParamsSchema = z.object({
  id: z.string().uuid(),
});

export const PublicIssueExternalLinkInputSchema = z.object({
  provider: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/),
  external_id: z.string().min(1).max(256),
  kind: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/),
  url: z.string().url(),
  title: z.string().min(1).max(500),
  status: z.string().min(1).max(128).optional(),
});

export const PublicIssueExternalLinkSchema = PublicIssueExternalLinkInputSchema.extend({
  created_at: z.string(),
  updated_at: z.string(),
});

export const PublicIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  display_id: z.string(),
  ticket_number: z.number().int().nullable(),
  state: z.enum(ISSUE_STATE_VALUES),
  priority: z.enum(ISSUE_PRIORITY_VALUES),
  assignee_id: z.string().uuid().nullable(),
  assignee_name: z.string().nullable().optional(),
  assignee_archived: z.boolean().optional(),
  estimate: z.number().positive().nullable().optional(),
  source: z.enum(ISSUE_SOURCE_VALUES),
  due_date: z.string().nullable().optional(),
  is_system_generated: z.boolean().optional(),
  accountability_target_id: z.string().uuid().nullable().optional(),
  accountability_type: z.string().nullable().optional(),
  rejection_reason: z.string().nullable().optional(),
  content: z.unknown().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().uuid(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  cancelled_at: z.string().nullable().optional(),
  reopened_at: z.string().nullable().optional(),
  converted_from_id: z.string().uuid().nullable().optional(),
  belongs_to: z.array(PublicBelongsToSchema),
  external_links: z.array(PublicIssueExternalLinkSchema).optional(),
});

export const PublicIssuesListResponseSchema = z.object({
  data: z.array(PublicIssueSchema.omit({ content: true })),
  next_cursor: z.string().nullable(),
});

export const PublicFleetGraphAttentionContextListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).optional(),
  source_issue_id: z.string().uuid().optional(),
  source_sprint_id: z.string().uuid().optional(),
});

export const PublicFleetGraphAttentionContextSchema = z.object({
  workspace_id: z.string().uuid(),
  issue_id: z.string().uuid(),
  issue_title: z.string(),
  issue_ticket_number: z.number().int().nullable(),
  issue_state: z.enum(ISSUE_STATE_VALUES).nullable(),
  issue_priority: z.enum(ISSUE_PRIORITY_VALUES),
  issue_assignee_id: z.string().uuid().nullable(),
  issue_assignee_name: z.string().nullable(),
  issue_visibility: z.enum(DOCUMENT_VISIBILITY_VALUES),
  issue_created_at: z.string(),
  issue_updated_at: z.string(),
  sprint_id: z.string().uuid(),
  sprint_title: z.string(),
  sprint_number: z.number().int().nullable(),
  sprint_owner_id: z.string().uuid().nullable(),
  sprint_owner_name: z.string().nullable(),
  project_id: z.string().uuid().nullable(),
  project_title: z.string().nullable(),
  project_owner_id: z.string().uuid().nullable(),
  project_owner_name: z.string().nullable(),
  program_id: z.string().uuid().nullable(),
  program_title: z.string().nullable(),
  program_owner_id: z.string().uuid().nullable(),
  program_owner_name: z.string().nullable(),
  blocker_text: z.string(),
  blocker_iteration_id: z.string().uuid().nullable(),
  blocker_iteration_created_at: z.string().nullable(),
  latest_iteration_id: z.string().uuid().nullable(),
  latest_iteration_created_at: z.string().nullable(),
  meaningful_updated_at: z.string(),
});

export const PublicFleetGraphAttentionContextsListResponseSchema = z.object({
  data: z.array(PublicFleetGraphAttentionContextSchema),
});

export const PublicSprintListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const PublicSprintIssueListQuerySchema = PublicIssueListQuerySchema.omit({
  sprint_id: true,
});

export const PublicSprintParamsSchema = z.object({
  id: z.string().uuid(),
});

export const PublicSprintSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sprint_number: z.number().int().positive(),
  status: z.enum(['planning', 'active', 'completed']),
  owner: z.object({
    id: z.string().uuid(),
    name: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
  }).nullable(),
  program_id: z.string().uuid().nullable().optional(),
  program_name: z.string().nullable().optional(),
  program_prefix: z.string().nullable().optional(),
  program_accountable_id: z.string().uuid().nullable().optional(),
  workspace_sprint_start_date: z.string().nullable(),
  issue_count: z.number().int(),
  completed_count: z.number().int(),
  started_count: z.number().int(),
  has_plan: z.boolean(),
  has_retro: z.boolean(),
  retro_outcome: z.string().nullable(),
  retro_id: z.string().uuid().nullable(),
  plan: z.string().nullable(),
  success_criteria: z.array(z.string()).nullable(),
  confidence: z.number().int().min(0).max(100).nullable(),
  plan_history: z.unknown().nullable(),
  is_complete: z.boolean().nullable(),
  missing_fields: z.array(z.string()),
  planned_issue_ids: z.array(z.string().uuid()).nullable(),
  snapshot_taken_at: z.string().nullable(),
  plan_approval: z.unknown().nullable(),
  review_approval: z.unknown().nullable(),
  accountable_id: z.string().uuid().nullable(),
});

export const PublicSprintsListResponseSchema = z.object({
  data: z.array(PublicSprintSchema),
  next_cursor: z.string().nullable(),
});

export const PublicWebhookCreateSchema = z.object({
  event: z.enum(WEBHOOK_EVENT_TYPES),
  target_url: z.string().url().regex(/^https?:\/\/[^#]+$/, {
    message: 'Webhook target URL must use http(s) and must not include a fragment',
  }),
});

export const PublicWebhookListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const PublicWebhookSubscriptionSchema = z.object({
  id: z.string().uuid(),
  event: z.enum(WEBHOOK_EVENT_TYPES),
  target_url: z.string(),
  active: z.boolean(),
  created_at: z.string(),
});

export const PublicWebhookSubscriptionCreatedSchema = PublicWebhookSubscriptionSchema.extend({
  signing_secret: z.string(),
});

export const PublicWebhookDeliverySchema = z.object({
  id: z.string().uuid(),
  subscription_id: z.string().uuid(),
  event_id: z.string().uuid(),
  attempt_number: z.number().int(),
  status: z.enum(WEBHOOK_DELIVERY_STATUS_VALUES),
  idempotency_key: z.string(),
  response_status: z.number().int().nullable(),
  response_excerpt: z.string().nullable(),
  latency_ms: z.number().int().nullable(),
  next_attempt_at: z.string().nullable(),
  replay_of_delivery_id: z.string().uuid().nullable(),
  created_at: z.string(),
});

export const PublicWebhookSubscriptionsListResponseSchema = z.object({
  data: z.array(PublicWebhookSubscriptionSchema),
  next_cursor: z.string().nullable(),
});

export const PublicWebhookDeliveriesListResponseSchema = z.object({
  data: z.array(PublicWebhookDeliverySchema),
  next_cursor: z.string().nullable(),
});

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  refresh_token: z.string(),
  scope: z.string(),
});

export const OAuthErrorResponseSchema = z.object({
  error: z.enum(OAUTH_ERROR_CODES),
  error_description: z.string().optional(),
});

export const OAuthDeviceAuthorizationCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
});

export const OAuthDeviceAuthorizationResponseSchema = OAuthDeviceAuthorizationCodeSchema.extend({
  verification_uri: z.string(),
  verification_uri_complete: z.string(),
});

export const OAuthConsentRequestSchema = z.object({
  request_id: z.string().uuid(),
  app: z.object({
    name: z.string(),
    client_id: z.string(),
  }),
  redirect_uri: z.string(),
  requested_scopes: z.array(PublicApiScopeSchema),
  previously_granted_scopes: z.array(PublicApiScopeSchema),
  new_scopes: z.array(PublicApiScopeSchema),
});

export const OAuthConsentApprovalResponseSchema = z.object({
  redirect_url: z.string(),
});

export const OAuthDeviceVerificationRequestSchema = z.object({
  app: z.object({
    name: z.string(),
    client_id: z.string(),
  }),
  requested_scopes: z.array(PublicApiScopeSchema),
  previously_granted_scopes: z.array(PublicApiScopeSchema),
  new_scopes: z.array(PublicApiScopeSchema),
  expires_at: z.string(),
});

export const OAuthDeviceApprovalResponseSchema = z.object({
  approved: z.boolean(),
});

export const WebhookActorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional(),
  email: z.string().optional(),
});

export const DocumentCreatedWebhookPayloadSchema = z.object({
  document: z.object({
    id: z.string().uuid(),
    title: z.string(),
    document_type: z.enum(DOCUMENT_TYPE_VALUES),
    api_url: z.string(),
    ui_url: z.string(),
  }),
  actor: WebhookActorSchema.optional(),
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

export const WebhookEventResourceSchema = z.object({
  kind: z.literal('document'),
  id: z.string().uuid(),
  document_type: z.enum(DOCUMENT_TYPE_VALUES),
});

export type PublicApiScope = z.infer<typeof PublicApiScopeSchema>;
export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];
export type PublicApiError = z.infer<typeof PublicApiErrorSchema>;
export type PublicIssueIncompleteChildrenDetails = z.infer<typeof PublicIssueIncompleteChildrenDetailsSchema>;
export type PublicIssueUpdateConflictError = z.infer<typeof PublicIssueUpdateConflictErrorSchema>;
export type PublicMe = z.infer<typeof PublicMeResponseSchema>;
export type PublicDocument = z.infer<typeof PublicDocumentSchema>;
export type PublicDocumentCreateInput = z.input<typeof PublicDocumentCreateSchema>;
export type PublicDocumentListParams = z.infer<typeof PublicDocumentListQuerySchema>;
export type PublicBelongsTo = z.infer<typeof PublicBelongsToSchema>;
export type PublicIssue = z.infer<typeof PublicIssueSchema>;
export type PublicIssueCreateInput = z.input<typeof PublicIssueCreateSchema>;
export type PublicIssueUpdateInput = z.input<typeof PublicIssueUpdateSchema>;
export type PublicIssueListParams = z.infer<typeof PublicIssueListQuerySchema>;
export type PublicIssueExternalLink = z.infer<typeof PublicIssueExternalLinkSchema>;
export type PublicIssueExternalLinkInput = z.input<typeof PublicIssueExternalLinkInputSchema>;
export type PublicFleetGraphAttentionContext = z.infer<typeof PublicFleetGraphAttentionContextSchema>;
export type PublicFleetGraphAttentionContextListParams = z.infer<typeof PublicFleetGraphAttentionContextListQuerySchema>;
export type PublicFleetGraphAttentionContextsListResponse = z.infer<
  typeof PublicFleetGraphAttentionContextsListResponseSchema
>;
export type PublicSprint = z.infer<typeof PublicSprintSchema>;
export type PublicSprintListParams = z.infer<typeof PublicSprintListQuerySchema>;
export type PublicSprintIssueListParams = z.infer<typeof PublicSprintIssueListQuerySchema>;
export type CursorPage<T> = {
  data: T[];
  next_cursor: string | null;
};
export type PublicWebhookCreateInput = z.input<typeof PublicWebhookCreateSchema>;
export type PublicWebhookListParams = z.infer<typeof PublicWebhookListQuerySchema>;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUS_VALUES)[number];
export type PublicWebhookSubscription = z.infer<typeof PublicWebhookSubscriptionSchema>;
export type PublicWebhookSubscriptionCreated = z.infer<typeof PublicWebhookSubscriptionCreatedSchema>;
export type PublicWebhookDelivery = z.infer<typeof PublicWebhookDeliverySchema>;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;
export type OAuthErrorResponse = z.infer<typeof OAuthErrorResponseSchema>;
export type OAuthDeviceAuthorizationCode = z.infer<typeof OAuthDeviceAuthorizationCodeSchema>;
export type OAuthDeviceAuthorizationResponse = z.infer<typeof OAuthDeviceAuthorizationResponseSchema>;
export type OAuthConsentRequest = z.infer<typeof OAuthConsentRequestSchema>;
export type OAuthConsentApprovalResponse = z.infer<typeof OAuthConsentApprovalResponseSchema>;
export type OAuthDeviceVerificationRequest = z.infer<typeof OAuthDeviceVerificationRequestSchema>;
export type OAuthDeviceApprovalResponse = z.infer<typeof OAuthDeviceApprovalResponseSchema>;
export type DocumentCreatedWebhookPayload = z.infer<typeof DocumentCreatedWebhookPayloadSchema>;
export type IssueCreatedWebhookPayload = z.infer<typeof IssueCreatedWebhookPayloadSchema>;
export type IssueAssignedWebhookPayload = z.infer<typeof IssueAssignedWebhookPayloadSchema>;
export type IssueStatusChangedWebhookPayload = z.infer<typeof IssueStatusChangedWebhookPayloadSchema>;
export type WebhookEventResource = z.infer<typeof WebhookEventResourceSchema>;
export type WebhookEvent = {
  type: WebhookEventType;
  workspace_id: string;
  idempotency_key: string;
  resource: WebhookEventResource;
  payload: Record<string, unknown>;
};
