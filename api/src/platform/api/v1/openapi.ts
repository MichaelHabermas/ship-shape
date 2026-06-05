// Public OpenAPI 3.1 generation walks /api/v1 route metadata and Zod contracts.
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { PublicApiErrorSchema as publicApiErrorSchema } from '@ship/shared';
import {
  publicApiV1RouteRegistry,
  type PublicRouteMetadata,
} from './route-metadata.js';
import { publicOpenApiContractForOperation } from './route-openapi-contracts.js';
import { PUBLIC_API_V1_BASE_PATH } from './paths.js';

extendZodWithOpenApi(z);

type PublicOpenApiPathConfig = Parameters<OpenAPIRegistry['registerPath']>[0];
type PublicOpenApiResponses = PublicOpenApiPathConfig['responses'];

const standardErrorResponses: PublicOpenApiResponses = {
  '400': jsonResponse(publicApiErrorSchema, 'Validation error'),
  '401': jsonResponse(
    publicApiErrorSchema,
    'Missing, invalid, or revoked bearer token (code unauthorized); expired bearer token (code expired_token)'
  ),
  '403': jsonResponse(publicApiErrorSchema, 'Insufficient OAuth scope'),
  '404': jsonResponse(publicApiErrorSchema, 'Not found'),
  '429': jsonResponse(publicApiErrorSchema, 'Rate limited'),
  '500': jsonResponse(publicApiErrorSchema, 'Server error'),
};

export function generatePublicOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'oauthBearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'Ship OAuth access token for /api/v1.',
  });

  for (const route of publicApiV1RouteRegistry) {
    registerRoute(registry, route);
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Ship Public API',
      version: '1.0.0',
      description: 'Versioned public API for OAuth-authenticated Ship platform integrations.',
    },
    servers: [
      {
        url: PUBLIC_API_V1_BASE_PATH,
        description: 'Public API v1 base path',
      },
    ],
  });
}

function registerRoute(registry: OpenAPIRegistry, route: PublicRouteMetadata): void {
  const path = route.path
    .replace(PUBLIC_API_V1_BASE_PATH, '')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  registry.registerPath({
    method: route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete',
    path,
    tags: ['Public API'],
    summary: route.operationId,
    operationId: route.operationId,
    ...(route.auth === 'oauth' ? { security: [{ oauthBearerAuth: [] }] } : {}),
    request: requestForRoute(route),
    responses: responsesForRoute(route),
  });
}

function requestForRoute(route: PublicRouteMetadata) {
  const contract = publicOpenApiContractForOperation(route.operationId);
  if (!contract?.request) return undefined;

  const request: NonNullable<PublicOpenApiPathConfig['request']> = {};
  if (contract.request.query) {
    request.query = contract.request.query as NonNullable<PublicOpenApiPathConfig['request']>['query'];
  }
  if (contract.request.params) {
    request.params = contract.request.params as NonNullable<PublicOpenApiPathConfig['request']>['params'];
  }
  if (contract.request.body) {
    request.body = {
      content: {
        'application/json': { schema: contract.request.body },
      },
    };
  }
  return Object.keys(request).length > 0 ? request : undefined;
}

function responsesForRoute(route: PublicRouteMetadata): PublicOpenApiResponses {
  const contract = publicOpenApiContractForOperation(route.operationId);
  if (!contract) {
    return route.operationId === 'openapi.get'
      ? { '200': { description: 'Public OpenAPI 3.1 document' } }
      : standardErrorResponses;
  }

  const responses: PublicOpenApiResponses = {};
  for (const [status, response] of Object.entries(contract.responses)) {
    responses[status] = response.schema
      ? jsonResponse(response.schema, response.description)
      : { description: response.description };
  }

  if (route.operationId === 'openapi.get') {
    return responses;
  }

  return {
    ...responses,
    ...standardErrorResponses,
  };
}

function jsonResponse(schema: z.ZodTypeAny, description: string) {
  return {
    description,
    content: {
      'application/json': { schema },
    },
  };
}
