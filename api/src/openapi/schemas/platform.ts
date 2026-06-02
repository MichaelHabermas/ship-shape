/**
 * Platform and PlugForge public API schemas for mounted OAuth foundation routes.
 */

import { PUBLIC_API_SCOPES } from '../../platform/scopes/registry.js';
import { z, registry } from '../registry.js';
import { DateTimeSchema, UuidSchema } from './common.js';
import { jsonResponse, successEnvelope } from './route-helpers.js';

const PublicApiScopeSchema = z.enum(PUBLIC_API_SCOPES).openapi('PublicApiScope');
registry.register('PublicApiScope', PublicApiScopeSchema);

const CreateOAuthAppRequestSchema = z.object({
  name: z.string().min(1).max(100),
  redirect_uris: z.array(z.string().url()).min(1),
  requested_scopes: z.array(PublicApiScopeSchema).min(1),
}).openapi('CreateOAuthAppRequest');
registry.register('CreateOAuthAppRequest', CreateOAuthAppRequestSchema);

const OAuthAppCreatedSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  client_id: z.string(),
  client_secret: z.string().openapi({
    description: 'Raw client secret. Returned only once during app creation.',
  }),
  redirect_uris: z.array(z.string().url()),
  requested_scopes: z.array(PublicApiScopeSchema),
  created_at: DateTimeSchema,
  warning: z.string(),
}).openapi('OAuthAppCreated');
registry.register('OAuthAppCreated', OAuthAppCreatedSchema);

const OAuthAppCreatedResponseSchema = successEnvelope(
  OAuthAppCreatedSchema,
  'OAuthAppCreatedResponse'
);
registry.register('OAuthAppCreatedResponse', OAuthAppCreatedResponseSchema);

const PublicApiErrorSchema = z.object({
  code: z.enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'validation_failed',
    'rate_limited',
    'server_error',
  ]),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  request_id: z.string(),
}).openapi('PublicApiError');
registry.register('PublicApiError', PublicApiErrorSchema);

const PublicMeResponseSchema = z.object({
  user: z.object({
    id: UuidSchema,
    email: z.string().email(),
    name: z.string(),
  }),
  app: z.object({
    client_id: z.string(),
  }),
  workspace_id: UuidSchema,
  granted_scopes: z.array(PublicApiScopeSchema),
}).openapi('PublicMeResponse');
registry.register('PublicMeResponse', PublicMeResponseSchema);

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
    400: { description: 'Validation error' },
    403: { description: 'Workspace admin session required' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/me',
  tags: ['Public API'],
  summary: 'Get OAuth bearer context',
  description: 'Return the user, app, workspace, and granted scopes for the current OAuth access token.',
  security: [{ oauthBearerAuth: [] }],
  responses: {
    200: jsonResponse(PublicMeResponseSchema, 'OAuth bearer context'),
    401: jsonResponse(PublicApiErrorSchema, 'Missing, invalid, revoked, or expired bearer token'),
    403: jsonResponse(PublicApiErrorSchema, 'Insufficient OAuth scope'),
    404: jsonResponse(PublicApiErrorSchema, 'User or route not found'),
    429: jsonResponse(PublicApiErrorSchema, 'Rate limited'),
    500: jsonResponse(PublicApiErrorSchema, 'Server error'),
  },
});
