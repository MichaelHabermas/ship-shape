/**
 * Platform OAuth app schemas for internal workspace routes.
 */

import { PUBLIC_API_SCOPES } from '@ship/shared';
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
