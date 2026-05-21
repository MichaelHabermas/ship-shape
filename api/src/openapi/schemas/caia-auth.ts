/**
 * CAIA / PIV OAuth schemas - external identity provider flows
 */

import { z, registry } from '../registry.js';
import { ApiErrorResponseSchema } from './common.js';
import { jsonResponse, successEnvelope } from './route-helpers.js';

const AuthProviderStatusDataSchema = z.object({
  available: z.boolean(),
}).openapi('AuthProviderStatusData');

const AuthProviderStatusResponseSchema = successEnvelope(
  AuthProviderStatusDataSchema,
  'AuthProviderStatusResponse'
);
registry.register('AuthProviderStatusResponse', AuthProviderStatusResponseSchema);

const AuthProviderLoginDataSchema = z.object({
  authorizationUrl: z.string().url(),
}).openapi('AuthProviderLoginData');

const AuthProviderLoginResponseSchema = successEnvelope(
  AuthProviderLoginDataSchema,
  'AuthProviderLoginResponse'
);
registry.register('AuthProviderLoginResponse', AuthProviderLoginResponseSchema);

function registerProviderPaths(prefix: 'caia' | 'piv') {
  const tag = prefix === 'caia' ? 'CAIA Auth' : 'PIV Auth';

  registry.registerPath({
    method: 'get',
    path: `/auth/${prefix}/status`,
    tags: [tag],
    summary: `Get ${prefix.toUpperCase()} auth configuration status`,
    security: [],
    responses: {
      200: jsonResponse(AuthProviderStatusResponseSchema, 'Provider status'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: `/auth/${prefix}/login`,
    tags: [tag],
    summary: `Start ${prefix.toUpperCase()} OAuth login`,
    security: [],
    responses: {
      200: jsonResponse(AuthProviderLoginResponseSchema, 'Authorization URL'),
      503: jsonResponse(ApiErrorResponseSchema, 'Provider not configured'),
      500: jsonResponse(ApiErrorResponseSchema, 'Failed to initiate login'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: `/auth/${prefix}/callback`,
    tags: [tag],
    summary: `Handle ${prefix.toUpperCase()} OAuth callback`,
    security: [],
    responses: {
      302: { description: 'Redirect after authentication' },
      400: { description: 'Invalid OAuth callback' },
      500: { description: 'Authentication failed' },
    },
  });
}

registerProviderPaths('caia');
registerProviderPaths('piv');
