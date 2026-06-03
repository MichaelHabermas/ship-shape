// Public route OpenAPI contracts keyed by operationId for metadata-driven spec generation.
import { z } from 'zod';
import {
  PublicApiErrorSchema,
  PublicDocumentCreateSchema,
  PublicDocumentListQuerySchema,
  PublicDocumentParamsSchema,
  PublicDocumentSchema,
  PublicDocumentsListResponseSchema,
  PublicFleetGraphAttentionContextListQuerySchema,
  PublicFleetGraphAttentionContextsListResponseSchema,
  PublicIssueCreateSchema,
  PublicIssueListQuerySchema,
  PublicIssueParamsSchema,
  PublicIssueSchema,
  PublicIssueUpdateSchema,
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
  PublicWebhookSubscriptionCreatedSchema,
  PublicWebhookSubscriptionsListResponseSchema,
} from '@ship/shared';

export type PublicRouteOpenApiContract = {
  request?: {
    query?: z.ZodTypeAny;
    params?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  };
  responses: Record<string, { description: string; schema?: z.ZodTypeAny }>;
};

export const publicRouteOpenApiContracts: Record<string, PublicRouteOpenApiContract> = {
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
      '409': { description: 'Issue update conflict', schema: PublicApiErrorSchema },
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
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      '202': { description: 'Webhook delivery replayed', schema: PublicWebhookDeliverySchema },
    },
  },
};
