/**
 * CAIA / PIV OAuth schemas - external identity provider flows
 */

import { z, registry } from '../registry.js';
import { jsonResponse, successEnvelope } from './route-helpers.js';

const AuthProviderStatusSchema = z.object({
  configured: z.boolean(),
  issuerUrl: z.string().optional(),
  loginAvailable: z.boolean().optional(),
}).passthrough().openapi('AuthProviderStatus');

const AuthProviderStatusResponseSchema = successEnvelope(AuthProviderStatusSchema, 'AuthProviderStatusResponse');
registry.register('AuthProviderStatusResponse', AuthProviderStatusResponseSchema);

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
      302: { description: 'Redirect to identity provider' },
      503: { description: 'Provider not configured' },
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
