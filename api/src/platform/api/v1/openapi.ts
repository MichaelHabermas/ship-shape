// Public OpenAPI 3.1 generation walks /api/v1 route metadata and Zod schemas.
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  PublicApiErrorSchema as publicApiErrorSchema,
  PublicDocumentCreateSchema as publicDocumentCreateSchema,
  PublicDocumentListQuerySchema as publicDocumentsListQuerySchema,
  PublicDocumentParamsSchema as publicDocumentParamsSchema,
  PublicDocumentSchema as publicDocumentResponseSchema,
  PublicDocumentsListResponseSchema as publicDocumentsListResponseSchema,
  PublicFleetGraphAttentionContextListQuerySchema as publicFleetGraphAttentionContextListQuerySchema,
  PublicFleetGraphAttentionContextsListResponseSchema as publicFleetGraphAttentionContextsListResponseSchema,
  PublicIssueCreateSchema as publicIssueCreateSchema,
  PublicIssueListQuerySchema as publicIssueListQuerySchema,
  PublicIssueParamsSchema as publicIssueParamsSchema,
  PublicIssueSchema as publicIssueResponseSchema,
  PublicIssuesListResponseSchema as publicIssuesListResponseSchema,
  PublicIssueUpdateSchema as publicIssueUpdateSchema,
  PublicMeResponseSchema as publicMeResponseSchema,
  PublicSprintListQuerySchema as publicSprintListQuerySchema,
  PublicSprintIssueListQuerySchema as publicSprintIssueListQuerySchema,
  PublicSprintParamsSchema as publicSprintParamsSchema,
  PublicSprintSchema as publicSprintResponseSchema,
  PublicSprintsListResponseSchema as publicSprintsListResponseSchema,
  PublicWebhookCreateSchema as publicWebhookCreateSchema,
  PublicWebhookDeliveriesListResponseSchema as publicWebhookDeliveriesListResponseSchema,
  PublicWebhookDeliverySchema as publicWebhookDeliverySchema,
  PublicWebhookListQuerySchema as publicWebhookListQuerySchema,
  PublicWebhookSubscriptionCreatedSchema as publicWebhookSubscriptionCreatedSchema,
  PublicWebhookSubscriptionsListResponseSchema as publicWebhookSubscriptionsListResponseSchema,
} from '@ship/shared';
import {
  publicApiV1RouteRegistry,
  type PublicRouteMetadata,
} from './route-metadata.js';
import { PUBLIC_API_V1_BASE_PATH } from './paths.js';

extendZodWithOpenApi(z);

type PublicOpenApiPathConfig = Parameters<OpenAPIRegistry['registerPath']>[0];
type PublicOpenApiResponses = PublicOpenApiPathConfig['responses'];

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
    method: route.method.toLowerCase() as 'get' | 'post' | 'patch',
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
  switch (route.operationId) {
    case 'documents.list':
      return { query: publicDocumentsListQuerySchema };
    case 'fleetgraph.attentionContexts.list':
      return { query: publicFleetGraphAttentionContextListQuerySchema };
    case 'issues.list':
      return { query: publicIssueListQuerySchema };
    case 'sprints.list':
      return { query: publicSprintListQuerySchema };
    case 'sprints.issues.list':
      return {
        params: publicSprintParamsSchema,
        query: publicSprintIssueListQuerySchema,
      };
    case 'webhooks.list':
    case 'webhooks.deliveries.list':
      return { query: publicWebhookListQuerySchema };
    case 'documents.get':
      return { params: publicDocumentParamsSchema };
    case 'issues.get':
      return { params: publicIssueParamsSchema };
    case 'sprints.get':
      return { params: publicSprintParamsSchema };
    case 'documents.create':
      return {
        body: {
          content: {
            'application/json': { schema: publicDocumentCreateSchema },
          },
        },
      };
    case 'issues.create':
      return {
        body: {
          content: {
            'application/json': { schema: publicIssueCreateSchema },
          },
        },
      };
    case 'issues.update':
      return {
        params: publicIssueParamsSchema,
        body: {
          content: {
            'application/json': { schema: publicIssueUpdateSchema },
          },
        },
      };
    case 'webhooks.create':
      return {
        body: {
          content: {
            'application/json': { schema: publicWebhookCreateSchema },
          },
        },
      };
    case 'webhooks.deliveries.replay':
      return { params: z.object({ id: z.string().uuid() }) };
    default:
      return undefined;
  }
}

function responsesForRoute(route: PublicRouteMetadata): PublicOpenApiResponses {
  const errors: PublicOpenApiResponses = {
    '400': jsonResponse(publicApiErrorSchema, 'Validation error'),
    '401': jsonResponse(publicApiErrorSchema, 'Missing, invalid, revoked, or expired bearer token'),
    '403': jsonResponse(publicApiErrorSchema, 'Insufficient OAuth scope'),
    '404': jsonResponse(publicApiErrorSchema, 'Not found'),
    '429': jsonResponse(publicApiErrorSchema, 'Rate limited'),
    '500': jsonResponse(publicApiErrorSchema, 'Server error'),
  };

  switch (route.operationId) {
    case 'openapi.get':
      return {
        '200': {
          description: 'Public OpenAPI 3.1 document',
        },
      };
    case 'me.get':
      return {
        '200': jsonResponse(publicMeResponseSchema, 'OAuth bearer context'),
        ...errors,
      };
    case 'documents.list':
      return {
        '200': jsonResponse(publicDocumentsListResponseSchema, 'Document page'),
        ...errors,
      };
    case 'fleetgraph.attentionContexts.list':
      return {
        '200': jsonResponse(publicFleetGraphAttentionContextsListResponseSchema, 'FleetGraph attention contexts'),
        ...errors,
      };
    case 'documents.get':
      return {
        '200': jsonResponse(publicDocumentResponseSchema, 'Document'),
        ...errors,
      };
    case 'documents.create':
      return {
        '201': jsonResponse(publicDocumentResponseSchema, 'Document created'),
        ...errors,
      };
    case 'issues.list':
      return {
        '200': jsonResponse(publicIssuesListResponseSchema, 'Issue page'),
        ...errors,
      };
    case 'issues.get':
      return {
        '200': jsonResponse(publicIssueResponseSchema, 'Issue'),
        ...errors,
      };
    case 'issues.create':
      return {
        '201': jsonResponse(publicIssueResponseSchema, 'Issue created'),
        ...errors,
      };
    case 'issues.update':
      return {
        '200': jsonResponse(publicIssueResponseSchema, 'Issue updated'),
        '409': jsonResponse(publicApiErrorSchema, 'Issue update conflict'),
        ...errors,
      };
    case 'sprints.list':
      return {
        '200': jsonResponse(publicSprintsListResponseSchema, 'Sprint page'),
        ...errors,
      };
    case 'sprints.get':
      return {
        '200': jsonResponse(publicSprintResponseSchema, 'Sprint'),
        ...errors,
      };
    case 'sprints.issues.list':
      return {
        '200': jsonResponse(publicIssuesListResponseSchema, 'Sprint issue page'),
        ...errors,
      };
    case 'webhooks.list':
      return {
        '200': jsonResponse(publicWebhookSubscriptionsListResponseSchema, 'Webhook subscriptions'),
        ...errors,
      };
    case 'webhooks.create':
      return {
        '201': jsonResponse(publicWebhookSubscriptionCreatedSchema, 'Webhook subscription created'),
        ...errors,
      };
    case 'webhooks.deliveries.list':
      return {
        '200': jsonResponse(publicWebhookDeliveriesListResponseSchema, 'Webhook deliveries'),
        ...errors,
      };
    case 'webhooks.deliveries.replay':
      return {
        '202': jsonResponse(publicWebhookDeliverySchema, 'Webhook delivery replayed'),
        ...errors,
      };
    default:
      return errors;
  }
}

function jsonResponse(schema: z.ZodTypeAny, description: string) {
  return {
    description,
    content: {
      'application/json': { schema },
    },
  };
}
