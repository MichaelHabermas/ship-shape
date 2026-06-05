/**
 * Platform OAuth app schemas for internal workspace routes.
 */

import { PUBLIC_API_SCOPES, WEBHOOK_DELIVERY_STATUS_VALUES, WEBHOOK_EVENT_TYPES } from '@ship/shared';
import { z, registry } from '../registry.js';
import { ApiErrorResponseSchema, DateTimeSchema, UuidSchema } from './common.js';
import { jsonResponse, successEnvelope } from './route-helpers.js';

const PublicApiScopeSchema = z.enum(PUBLIC_API_SCOPES).openapi('PublicApiScope');
registry.register('PublicApiScope', PublicApiScopeSchema);
const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES).openapi('PlatformWebhookEventType');
registry.register('PlatformWebhookEventType', WebhookEventTypeSchema);
const WebhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUS_VALUES).openapi('PlatformWebhookDeliveryStatus');
registry.register('PlatformWebhookDeliveryStatus', WebhookDeliveryStatusSchema);

const PlatformAppParamsSchema = z.object({ appId: UuidSchema });
const PlatformAppSecretParamsSchema = z.object({ appId: UuidSchema, secretId: UuidSchema });
const PlatformAppDeliveryParamsSchema = z.object({ appId: UuidSchema, deliveryId: UuidSchema });
const CursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
const OAuthRedirectUriSchema = z.string().url().regex(
  /^https:\/\/[^#]+$|^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?][^#]*)?$/,
  'OAuth redirect URI must be HTTPS, or HTTP localhost for local development, and must not include a fragment'
);
const PlatformWebhookTargetUrlSchema = z.string().url().regex(
  /^https?:\/\/(?![^/?#]*@)[^#]+$/,
  'Webhook target URL must use http(s), must not include credentials, and must not include a fragment'
);

const CreateOAuthAppRequestSchema = z.object({
  name: z.string().min(1).max(100),
  redirect_uris: z.array(OAuthRedirectUriSchema).min(1),
  requested_scopes: z.array(PublicApiScopeSchema).min(1),
}).openapi('CreateOAuthAppRequest');
registry.register('CreateOAuthAppRequest', CreateOAuthAppRequestSchema);

const OAuthAppCreatedSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  client_id: z.string(),
  client_secret_id: UuidSchema,
  client_secret: z.string().openapi({
    description: 'Raw client secret. Returned only once during app creation.',
  }),
  redirect_uris: z.array(z.string().url()),
  requested_scopes: z.array(PublicApiScopeSchema),
  is_active: z.boolean(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  warning: z.string(),
}).openapi('OAuthAppCreated');
registry.register('OAuthAppCreated', OAuthAppCreatedSchema);

const OAuthAppSecretSchema = z.object({
  id: UuidSchema,
  status: z.enum(['active', 'grace', 'revoked']),
  expires_at: DateTimeSchema.nullable(),
  revoked_at: DateTimeSchema.nullable(),
  created_at: DateTimeSchema,
}).openapi('OAuthAppSecret');
registry.register('OAuthAppSecret', OAuthAppSecretSchema);

const OAuthAppSummarySchema = OAuthAppCreatedSchema.omit({
  client_secret: true,
  client_secret_id: true,
  warning: true,
}).extend({
  secrets: z.array(OAuthAppSecretSchema),
}).openapi('OAuthAppSummary');
registry.register('OAuthAppSummary', OAuthAppSummarySchema);

const OAuthAppCreatedResponseSchema = successEnvelope(
  OAuthAppCreatedSchema,
  'OAuthAppCreatedResponse'
);
registry.register('OAuthAppCreatedResponse', OAuthAppCreatedResponseSchema);

const OAuthAppsListResponseSchema = successEnvelope(
  z.object({ apps: z.array(OAuthAppSummarySchema) }),
  'OAuthAppsListResponse'
);
registry.register('OAuthAppsListResponse', OAuthAppsListResponseSchema);

const RotateOAuthAppSecretRequestSchema = z.object({
  revoke_previous_immediately: z.boolean().optional(),
}).openapi('RotateOAuthAppSecretRequest');
registry.register('RotateOAuthAppSecretRequest', RotateOAuthAppSecretRequestSchema);

const OAuthSecretRotationSchema = z.object({
  app_id: UuidSchema,
  client_secret_id: UuidSchema,
  client_secret: z.string(),
  previous_secret_expires_at: DateTimeSchema.nullable(),
  warning: z.string(),
}).openapi('OAuthSecretRotation');
registry.register('OAuthSecretRotation', OAuthSecretRotationSchema);

const OAuthSecretRotationResponseSchema = successEnvelope(
  OAuthSecretRotationSchema,
  'OAuthSecretRotationResponse'
);
registry.register('OAuthSecretRotationResponse', OAuthSecretRotationResponseSchema);

const OAuthSecretSummaryResponseSchema = successEnvelope(
  OAuthAppSecretSchema,
  'OAuthSecretSummaryResponse'
);
registry.register('OAuthSecretSummaryResponse', OAuthSecretSummaryResponseSchema);

const PlatformWebhookCreateRequestSchema = z.object({
  event: WebhookEventTypeSchema,
  target_url: PlatformWebhookTargetUrlSchema,
}).openapi('PlatformWebhookCreateRequest');
registry.register('PlatformWebhookCreateRequest', PlatformWebhookCreateRequestSchema);

const PlatformWebhookSubscriptionSchema = z.object({
  id: UuidSchema,
  event: WebhookEventTypeSchema,
  target_url: z.string(),
  active: z.boolean(),
  created_at: DateTimeSchema,
}).openapi('PlatformWebhookSubscription');
registry.register('PlatformWebhookSubscription', PlatformWebhookSubscriptionSchema);

const PlatformWebhookSubscriptionCreatedSchema = PlatformWebhookSubscriptionSchema.extend({
  signing_secret: z.string(),
}).openapi('PlatformWebhookSubscriptionCreated');
registry.register('PlatformWebhookSubscriptionCreated', PlatformWebhookSubscriptionCreatedSchema);

const PlatformWebhookDeliverySchema = z.object({
  id: UuidSchema,
  subscription_id: UuidSchema,
  event_id: UuidSchema,
  event_type: z.enum(WEBHOOK_EVENT_TYPES),
  attempt_number: z.number().int(),
  status: WebhookDeliveryStatusSchema,
  idempotency_key: z.string(),
  response_status: z.number().int().nullable(),
  response_excerpt: z.string().nullable(),
  latency_ms: z.number().int().nullable(),
  next_attempt_at: DateTimeSchema.nullable(),
  replay_of_delivery_id: UuidSchema.nullable(),
  created_at: DateTimeSchema,
}).openapi('PlatformWebhookDelivery');
registry.register('PlatformWebhookDelivery', PlatformWebhookDeliverySchema);

const PublicApiAuditRowSchema = z.object({
  id: UuidSchema,
  request_id: z.string(),
  client_id: z.string().nullable(),
  user_id: UuidSchema.nullable(),
  method: z.string(),
  route: z.string(),
  scope_used: z.string().nullable(),
  status: z.number().int(),
  latency_ms: z.number().int(),
  error_code: z.string().nullable(),
  rate_limited: z.boolean(),
  created_at: DateTimeSchema,
}).openapi('PlatformPublicApiAuditRow');
registry.register('PlatformPublicApiAuditRow', PublicApiAuditRowSchema);

function cursorPage<T extends z.ZodTypeAny>(itemSchema: T, name: string) {
  return successEnvelope(z.object({
    data: z.array(itemSchema),
    next_cursor: z.string().nullable(),
  }), name);
}

const PlatformWebhookSubscriptionsPageResponseSchema = cursorPage(
  PlatformWebhookSubscriptionSchema,
  'PlatformWebhookSubscriptionsPageResponse'
);
registry.register('PlatformWebhookSubscriptionsPageResponse', PlatformWebhookSubscriptionsPageResponseSchema);
const PlatformWebhookDeliveriesPageResponseSchema = cursorPage(
  PlatformWebhookDeliverySchema,
  'PlatformWebhookDeliveriesPageResponse'
);
registry.register('PlatformWebhookDeliveriesPageResponse', PlatformWebhookDeliveriesPageResponseSchema);
const PlatformPublicApiAuditPageResponseSchema = cursorPage(
  PublicApiAuditRowSchema,
  'PlatformPublicApiAuditPageResponse'
);
registry.register('PlatformPublicApiAuditPageResponse', PlatformPublicApiAuditPageResponseSchema);
const PlatformWebhookCreatedResponseSchema = successEnvelope(
  PlatformWebhookSubscriptionCreatedSchema,
  'PlatformWebhookCreatedResponse'
);
registry.register('PlatformWebhookCreatedResponse', PlatformWebhookCreatedResponseSchema);
const PlatformWebhookReplayResponseSchema = successEnvelope(
  PlatformWebhookDeliverySchema,
  'PlatformWebhookReplayResponse'
);
registry.register('PlatformWebhookReplayResponse', PlatformWebhookReplayResponseSchema);

const platformErrorResponses = {
  400: jsonResponse(ApiErrorResponseSchema, 'Validation error'),
  401: jsonResponse(ApiErrorResponseSchema, 'Not authenticated'),
  403: jsonResponse(ApiErrorResponseSchema, 'Workspace admin session required'),
  404: jsonResponse(ApiErrorResponseSchema, 'Not found'),
  500: jsonResponse(ApiErrorResponseSchema, 'Internal server error'),
} as const;

registry.registerPath({
  method: 'get',
  path: '/platform/apps',
  tags: ['Platform'],
  summary: 'List OAuth apps',
  security: [{ cookieAuth: [] }],
  responses: {
    200: jsonResponse(OAuthAppsListResponseSchema, 'OAuth apps'),
    ...platformErrorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/platform/apps',
  tags: ['Platform'],
  summary: 'Create OAuth app',
  description: 'Create a PlugForge OAuth app for the current workspace. The client secret is returned once.',
  security: [{ cookieAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: CreateOAuthAppRequestSchema },
      },
    },
  },
  responses: {
    201: jsonResponse(OAuthAppCreatedResponseSchema, 'OAuth app created'),
    ...platformErrorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/platform/apps/{appId}/secrets/rotate',
  tags: ['Platform'],
  summary: 'Rotate OAuth app secret',
  security: [{ cookieAuth: [] }],
  request: {
    params: PlatformAppParamsSchema,
    body: {
      content: {
        'application/json': { schema: RotateOAuthAppSecretRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(OAuthSecretRotationResponseSchema, 'OAuth app secret rotated'),
    ...platformErrorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/platform/apps/{appId}/secrets/{secretId}/revoke',
  tags: ['Platform'],
  summary: 'Revoke OAuth app secret',
  security: [{ cookieAuth: [] }],
  request: {
    params: PlatformAppSecretParamsSchema,
  },
  responses: {
    200: jsonResponse(OAuthSecretSummaryResponseSchema, 'OAuth app secret revoked'),
    ...platformErrorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/platform/apps/{appId}/webhooks',
  tags: ['Platform'],
  summary: 'List app webhook subscriptions',
  security: [{ cookieAuth: [] }],
  request: {
    params: PlatformAppParamsSchema,
    query: CursorQuerySchema,
  },
  responses: {
    200: jsonResponse(PlatformWebhookSubscriptionsPageResponseSchema, 'Webhook subscriptions'),
    ...platformErrorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/platform/apps/{appId}/webhooks',
  tags: ['Platform'],
  summary: 'Create app webhook subscription',
  security: [{ cookieAuth: [] }],
  request: {
    params: PlatformAppParamsSchema,
    body: {
      content: {
        'application/json': { schema: PlatformWebhookCreateRequestSchema },
      },
    },
  },
  responses: {
    201: jsonResponse(PlatformWebhookCreatedResponseSchema, 'Webhook subscription created'),
    ...platformErrorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/platform/apps/{appId}/webhooks/deliveries',
  tags: ['Platform'],
  summary: 'List app webhook deliveries',
  security: [{ cookieAuth: [] }],
  request: {
    params: PlatformAppParamsSchema,
    query: CursorQuerySchema,
  },
  responses: {
    200: jsonResponse(PlatformWebhookDeliveriesPageResponseSchema, 'Webhook deliveries'),
    ...platformErrorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/platform/apps/{appId}/webhooks/deliveries/{deliveryId}/replay',
  tags: ['Platform'],
  summary: 'Replay app webhook delivery',
  security: [{ cookieAuth: [] }],
  request: {
    params: PlatformAppDeliveryParamsSchema,
  },
  responses: {
    202: jsonResponse(PlatformWebhookReplayResponseSchema, 'Webhook delivery replayed'),
    ...platformErrorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/platform/apps/{appId}/audit',
  tags: ['Platform'],
  summary: 'List public API audit rows for app',
  security: [{ cookieAuth: [] }],
  request: {
    params: PlatformAppParamsSchema,
    query: CursorQuerySchema,
  },
  responses: {
    200: jsonResponse(PlatformPublicApiAuditPageResponseSchema, 'Public API audit rows'),
    ...platformErrorResponses,
  },
});
