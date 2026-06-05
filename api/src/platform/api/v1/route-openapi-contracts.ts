// Public route OpenAPI contracts keyed by operationId for metadata-driven spec generation.
import { z } from 'zod';
import {
  PublicDocumentCreateSchema,
  PublicDocumentListQuerySchema,
  PublicDocumentParamsSchema,
  PublicDocumentSchema,
  PublicDocumentsListResponseSchema,
  PublicFleetGraphAttentionContextListQuerySchema,
  PublicFleetGraphAttentionContextsListResponseSchema,
  PublicIssueCreateSchema,
  PublicIssueExternalLinkInputSchema,
  PublicIssueExternalLinkSchema,
  PublicIssueListQuerySchema,
  PublicIssueParamsSchema,
  PublicIssueSchema,
  PublicIssueUpdateSchema,
  PublicIssueUpdateConflictErrorSchema,
  PublicIssuesListResponseSchema,
  PublicMeResponseSchema,
  PublicSprintIssueListQuerySchema,
  PublicSprintListQuerySchema,
  PublicSprintParamsSchema,
  PublicSprintSchema,
  PublicSprintsListResponseSchema,
  PublicWebhookCreateSchema,
  PublicWebhookDeliveriesListResponseSchema,
  PublicWebhookDeliverySchema,
  PublicWebhookListQuerySchema,
  PublicWebhookSubscriptionSchema,
  PublicWebhookSubscriptionCreatedSchema,
  PublicWebhookSubscriptionsListResponseSchema,
} from '@ship/shared';
import { publicApiV1RouteRegistry } from './route-metadata.js';

export type PublicRouteOpenApiContract = {
  request?: {
    query?: z.ZodTypeAny;
    params?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  };
  responses: Record<string, { description: string; schema?: z.ZodTypeAny }>;
};

export type RegistryOperationId = (typeof publicApiV1RouteRegistry)[number]['operationId'];

export const PublicWebhookDeliveryParamsSchema = z.object({
  id: z.string().uuid(),
});

export const PublicWebhookParamsSchema = z.object({
  id: z.string().uuid(),
});

const contracts = {
  'openapi.get': {
    responses: {
      '200': { description: 'Public OpenAPI 3.1 document' },
    },
  },
  'me.get': {
    responses: {
      '200': { description: 'OAuth bearer context', schema: PublicMeResponseSchema },
    },
  },
  'documents.list': {
    request: { query: PublicDocumentListQuerySchema },
    responses: {
      '200': { description: 'Document page', schema: PublicDocumentsListResponseSchema },
    },
  },
  'documents.get': {
    request: { params: PublicDocumentParamsSchema },
    responses: {
      '200': { description: 'Document', schema: PublicDocumentSchema },
    },
  },
  'documents.create': {
    request: { body: PublicDocumentCreateSchema },
    responses: {
      '201': { description: 'Document created', schema: PublicDocumentSchema },
    },
  },
  'fleetgraph.attentionContexts.list': {
    request: { query: PublicFleetGraphAttentionContextListQuerySchema },
    responses: {
      '200': {
        description: 'FleetGraph attention contexts',
        schema: PublicFleetGraphAttentionContextsListResponseSchema,
      },
    },
  },
  'issues.list': {
    request: { query: PublicIssueListQuerySchema },
    responses: {
      '200': { description: 'Issue page', schema: PublicIssuesListResponseSchema },
    },
  },
  'issues.get': {
    request: { params: PublicIssueParamsSchema },
    responses: {
      '200': { description: 'Issue', schema: PublicIssueSchema },
    },
  },
  'issues.create': {
    request: { body: PublicIssueCreateSchema },
    responses: {
      '201': { description: 'Issue created', schema: PublicIssueSchema },
    },
  },
  'issues.update': {
    request: {
      params: PublicIssueParamsSchema,
      body: PublicIssueUpdateSchema,
    },
    responses: {
      '200': { description: 'Issue updated', schema: PublicIssueSchema },
      '409': { description: 'Issue update conflict', schema: PublicIssueUpdateConflictErrorSchema },
    },
  },
  'issues.externalLinks.upsert': {
    request: {
      params: PublicIssueParamsSchema,
      body: PublicIssueExternalLinkInputSchema,
    },
    responses: {
      '200': { description: 'Issue external link updated', schema: PublicIssueExternalLinkSchema },
      '201': { description: 'Issue external link created', schema: PublicIssueExternalLinkSchema },
    },
  },
  'sprints.list': {
    request: { query: PublicSprintListQuerySchema },
    responses: {
      '200': { description: 'Sprint page', schema: PublicSprintsListResponseSchema },
    },
  },
  'sprints.get': {
    request: { params: PublicSprintParamsSchema },
    responses: {
      '200': { description: 'Sprint', schema: PublicSprintSchema },
    },
  },
  'sprints.issues.list': {
    request: {
      params: PublicSprintParamsSchema,
      query: PublicSprintIssueListQuerySchema,
    },
    responses: {
      '200': { description: 'Sprint issue page', schema: PublicIssuesListResponseSchema },
    },
  },
  'webhooks.list': {
    request: { query: PublicWebhookListQuerySchema },
    responses: {
      '200': {
        description: 'Webhook subscriptions',
        schema: PublicWebhookSubscriptionsListResponseSchema,
      },
    },
  },
  'webhooks.create': {
    request: { body: PublicWebhookCreateSchema },
    responses: {
      '201': {
        description: 'Webhook subscription created',
        schema: PublicWebhookSubscriptionCreatedSchema,
      },
    },
  },
  'webhooks.delete': {
    request: { params: PublicWebhookParamsSchema },
    responses: {
      '200': {
        description: 'Webhook subscription deactivated',
        schema: PublicWebhookSubscriptionSchema,
      },
    },
  },
  'webhooks.deliveries.list': {
    request: { query: PublicWebhookListQuerySchema },
    responses: {
      '200': {
        description: 'Webhook deliveries',
        schema: PublicWebhookDeliveriesListResponseSchema,
      },
    },
  },
  'webhooks.deliveries.replay': {
    request: { params: PublicWebhookDeliveryParamsSchema },
    responses: {
      '202': { description: 'Webhook delivery replayed', schema: PublicWebhookDeliverySchema },
    },
  },
} satisfies Record<RegistryOperationId, PublicRouteOpenApiContract>;

export const publicRouteOpenApiContracts: Record<RegistryOperationId, PublicRouteOpenApiContract> = contracts;

function isRegistryOperationId(operationId: string): operationId is RegistryOperationId {
  return Object.hasOwn(publicRouteOpenApiContracts, operationId);
}

export function publicOpenApiContractForOperation(
  operationId: string
): PublicRouteOpenApiContract | undefined {
  if (!isRegistryOperationId(operationId)) return undefined;
  return publicRouteOpenApiContracts[operationId];
}
