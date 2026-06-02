// Public developer API contracts shared by OAuth, SDK, OpenAPI, web, and tests.
import { z } from 'zod';
import {
  DOCUMENT_TYPE_VALUES,
  DOCUMENT_VISIBILITY_VALUES,
  type DocumentType,
  type DocumentVisibility,
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

export type PublicApiScope = z.infer<typeof PublicApiScopeSchema>;
export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];
export type PublicApiError = z.infer<typeof PublicApiErrorSchema>;
export type PublicMe = z.infer<typeof PublicMeResponseSchema>;
export type PublicDocument = z.infer<typeof PublicDocumentSchema>;
export type PublicDocumentCreateInput = z.input<typeof PublicDocumentCreateSchema>;
export type PublicDocumentListParams = {
  limit?: number;
  cursor?: string;
  type?: DocumentType;
};
export type PublicDocumentVisibility = DocumentVisibility;
export type CursorPage<T> = {
  data: T[];
  next_cursor: string | null;
};
export type PublicWebhookCreateInput = z.input<typeof PublicWebhookCreateSchema>;
export type PublicWebhookListParams = {
  limit?: number;
  cursor?: string;
};
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
export type WebhookEvent = {
  type: WebhookEventType;
  workspace_id: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
};
