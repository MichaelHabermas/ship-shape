/**
 * Admin credentials schemas - CAIA OAuth secret management (super-admin)
 */

import { z, registry } from '../registry.js';
import { jsonResponse, JsonObjectSchema, successEnvelope } from './route-helpers.js';

const CredentialsPageSchema = z.string().openapi({ description: 'HTML admin credentials page' });
registry.register('CredentialsPageHtml', CredentialsPageSchema);

const CredentialsStatusSchema = z.object({
  configured: z.boolean(),
  redirectUri: z.string().optional(),
  secretPath: z.string().optional(),
}).passthrough().openapi('CredentialsStatus');

const CredentialsStatusResponseSchema = successEnvelope(CredentialsStatusSchema, 'CredentialsStatusResponse');
registry.register('CredentialsStatusResponse', CredentialsStatusResponseSchema);

const SaveCredentialsRequestSchema = z.object({
  issuerUrl: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
}).openapi('SaveCredentialsRequest');

registry.register('SaveCredentialsRequest', SaveCredentialsRequestSchema);

const CredentialsMutationResponseSchema = successEnvelope(JsonObjectSchema, 'CredentialsMutationResponse');
registry.register('CredentialsMutationResponse', CredentialsMutationResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/admin/credentials',
  tags: ['Admin', 'Credentials'],
  summary: 'Admin credentials configuration page',
  responses: {
    200: { description: 'HTML page', content: { 'text/html': { schema: CredentialsPageSchema } } },
    403: { description: 'Super admin required' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/credentials/status',
  tags: ['Admin', 'Credentials'],
  summary: 'Get CAIA credentials configuration status',
  responses: {
    200: jsonResponse(CredentialsStatusResponseSchema, 'Configuration status'),
    403: { description: 'Super admin required' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/credentials/save',
  tags: ['Admin', 'Credentials'],
  summary: 'Save CAIA OAuth credentials',
  request: {
    body: {
      content: {
        'application/json': { schema: SaveCredentialsRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(CredentialsMutationResponseSchema, 'Credentials saved'),
    400: { description: 'Validation error' },
    403: { description: 'Super admin required' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/credentials/test',
  tags: ['Admin', 'Credentials'],
  summary: 'Test CAIA issuer discovery',
  responses: {
    200: jsonResponse(CredentialsMutationResponseSchema, 'Discovery test result'),
    403: { description: 'Super admin required' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/credentials/test-api',
  tags: ['Admin', 'Credentials'],
  summary: 'Test CAIA API connectivity',
  responses: {
    200: jsonResponse(CredentialsMutationResponseSchema, 'API test result'),
    403: { description: 'Super admin required' },
  },
});
