// Public route registry keeps /api/v1 contract facts executable from one place.
import type { PublicApiScope } from '@ship/shared';
import {
  PUBLIC_OPENAPI_PATH,
  PUBLIC_FLEETGRAPH_ATTENTION_CONTEXTS_PATH,
  PUBLIC_DOCUMENT_PATH,
  PUBLIC_DOCUMENTS_PATH,
  PUBLIC_ISSUE_PATH,
  PUBLIC_ISSUES_PATH,
  PUBLIC_ME_PATH,
  PUBLIC_SPRINT_ISSUES_PATH,
  PUBLIC_SPRINT_PATH,
  PUBLIC_SPRINTS_PATH,
  PUBLIC_WEBHOOK_DELIVERIES_PATH,
  PUBLIC_WEBHOOK_DELIVERY_REPLAY_PATH,
  PUBLIC_WEBHOOKS_PATH,
} from './paths.js';

// Current edge-piece methods only. Extend this union when a real public route
// needs another method; do not treat GET/POST as the whole platform contract.
export type PublicHttpMethod = 'GET' | 'POST' | 'PATCH';
export type PublicRouteAuth = 'oauth' | 'none';
export type PublicRouteSdkMetadata = {
  client: 'root' | 'documents' | 'issues' | 'sprints' | 'fleetgraph' | 'webhooks';
  method: string;
};
export type PublicRouteExample = {
  name: string;
  description?: string;
};

type PublicRouteMetadataBase = {
  method: PublicHttpMethod;
  path: string;
  operationId: string;
  requiredScopes: readonly PublicApiScope[];
  auth: PublicRouteAuth;
  handlerMountPath: string;
  sdk?: PublicRouteSdkMetadata;
  examples?: readonly PublicRouteExample[];
};

export type PublicRouteMetadata =
  | (PublicRouteMetadataBase & {
      isListEndpoint: false;
    })
  | (PublicRouteMetadataBase & {
      isListEndpoint: true;
      pagination: 'cursor' | 'none';
    });

export const publicMeRouteMetadata = {
  method: 'GET',
  path: PUBLIC_ME_PATH,
  operationId: 'me.get',
  requiredScopes: [],
  auth: 'oauth',
  handlerMountPath: '/me',
  isListEndpoint: false,
  sdk: {
    client: 'root',
    method: 'me',
  },
} satisfies PublicRouteMetadata;

export const publicOpenApiRouteMetadata = {
  method: 'GET',
  path: PUBLIC_OPENAPI_PATH,
  operationId: 'openapi.get',
  requiredScopes: [],
  auth: 'none',
  handlerMountPath: '/openapi.json',
  isListEndpoint: false,
} satisfies PublicRouteMetadata;

export const publicFleetGraphAttentionContextsListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_FLEETGRAPH_ATTENTION_CONTEXTS_PATH,
  operationId: 'fleetgraph.attentionContexts.list',
  requiredScopes: ['documents:read', 'issues:read', 'sprints:read'],
  auth: 'oauth',
  handlerMountPath: '/fleetgraph/attention-contexts',
  isListEndpoint: true,
  pagination: 'none',
  sdk: {
    client: 'fleetgraph',
    method: 'attentionContexts.list',
  },
} satisfies PublicRouteMetadata;

export const publicDocumentsListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_DOCUMENTS_PATH,
  operationId: 'documents.list',
  requiredScopes: ['documents:read'],
  auth: 'oauth',
  handlerMountPath: '/documents',
  isListEndpoint: true,
  pagination: 'cursor',
  sdk: {
    client: 'documents',
    method: 'list',
  },
} satisfies PublicRouteMetadata;

export const publicDocumentsGetRouteMetadata = {
  method: 'GET',
  path: PUBLIC_DOCUMENT_PATH,
  operationId: 'documents.get',
  requiredScopes: ['documents:read'],
  auth: 'oauth',
  handlerMountPath: '/documents/:id',
  isListEndpoint: false,
  sdk: {
    client: 'documents',
    method: 'get',
  },
} satisfies PublicRouteMetadata;

export const publicDocumentsCreateRouteMetadata = {
  method: 'POST',
  path: PUBLIC_DOCUMENTS_PATH,
  operationId: 'documents.create',
  requiredScopes: ['documents:write'],
  auth: 'oauth',
  handlerMountPath: '/documents',
  isListEndpoint: false,
  sdk: {
    client: 'documents',
    method: 'create',
  },
} satisfies PublicRouteMetadata;

export const publicIssuesListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_ISSUES_PATH,
  operationId: 'issues.list',
  requiredScopes: ['issues:read'],
  auth: 'oauth',
  handlerMountPath: '/issues',
  isListEndpoint: true,
  pagination: 'cursor',
  sdk: {
    client: 'issues',
    method: 'list',
  },
} satisfies PublicRouteMetadata;

export const publicIssuesGetRouteMetadata = {
  method: 'GET',
  path: PUBLIC_ISSUE_PATH,
  operationId: 'issues.get',
  requiredScopes: ['issues:read'],
  auth: 'oauth',
  handlerMountPath: '/issues/:id',
  isListEndpoint: false,
  sdk: {
    client: 'issues',
    method: 'get',
  },
} satisfies PublicRouteMetadata;

export const publicIssuesCreateRouteMetadata = {
  method: 'POST',
  path: PUBLIC_ISSUES_PATH,
  operationId: 'issues.create',
  requiredScopes: ['issues:write'],
  auth: 'oauth',
  handlerMountPath: '/issues',
  isListEndpoint: false,
  sdk: {
    client: 'issues',
    method: 'create',
  },
} satisfies PublicRouteMetadata;

export const publicIssuesUpdateRouteMetadata = {
  method: 'PATCH',
  path: PUBLIC_ISSUE_PATH,
  operationId: 'issues.update',
  requiredScopes: ['issues:write'],
  auth: 'oauth',
  handlerMountPath: '/issues/:id',
  isListEndpoint: false,
  sdk: {
    client: 'issues',
    method: 'update',
  },
} satisfies PublicRouteMetadata;

export const publicSprintsListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_SPRINTS_PATH,
  operationId: 'sprints.list',
  requiredScopes: ['sprints:read'],
  auth: 'oauth',
  handlerMountPath: '/sprints',
  isListEndpoint: true,
  pagination: 'cursor',
  sdk: {
    client: 'sprints',
    method: 'list',
  },
} satisfies PublicRouteMetadata;

export const publicSprintsGetRouteMetadata = {
  method: 'GET',
  path: PUBLIC_SPRINT_PATH,
  operationId: 'sprints.get',
  requiredScopes: ['sprints:read'],
  auth: 'oauth',
  handlerMountPath: '/sprints/:id',
  isListEndpoint: false,
  sdk: {
    client: 'sprints',
    method: 'get',
  },
} satisfies PublicRouteMetadata;

export const publicSprintIssuesListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_SPRINT_ISSUES_PATH,
  operationId: 'sprints.issues.list',
  requiredScopes: ['sprints:read', 'issues:read'],
  auth: 'oauth',
  handlerMountPath: '/sprints/:id/issues',
  isListEndpoint: true,
  pagination: 'cursor',
  sdk: {
    client: 'sprints',
    method: 'listIssues',
  },
} satisfies PublicRouteMetadata;

export const publicWebhooksListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_WEBHOOKS_PATH,
  operationId: 'webhooks.list',
  requiredScopes: ['webhooks:manage'],
  auth: 'oauth',
  handlerMountPath: '/webhooks',
  isListEndpoint: true,
  pagination: 'cursor',
  sdk: {
    client: 'webhooks',
    method: 'list',
  },
} satisfies PublicRouteMetadata;

export const publicWebhooksCreateRouteMetadata = {
  method: 'POST',
  path: PUBLIC_WEBHOOKS_PATH,
  operationId: 'webhooks.create',
  requiredScopes: ['webhooks:manage'],
  auth: 'oauth',
  handlerMountPath: '/webhooks',
  isListEndpoint: false,
  sdk: {
    client: 'webhooks',
    method: 'create',
  },
} satisfies PublicRouteMetadata;

export const publicWebhookDeliveriesListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_WEBHOOK_DELIVERIES_PATH,
  operationId: 'webhooks.deliveries.list',
  requiredScopes: ['webhooks:manage'],
  auth: 'oauth',
  handlerMountPath: '/webhooks/deliveries',
  isListEndpoint: true,
  pagination: 'cursor',
  sdk: {
    client: 'webhooks',
    method: 'listDeliveries',
  },
} satisfies PublicRouteMetadata;

export const publicWebhookDeliveryReplayRouteMetadata = {
  method: 'POST',
  path: PUBLIC_WEBHOOK_DELIVERY_REPLAY_PATH,
  operationId: 'webhooks.deliveries.replay',
  requiredScopes: ['webhooks:manage'],
  auth: 'oauth',
  handlerMountPath: '/webhooks/deliveries/:id/replay',
  isListEndpoint: false,
  sdk: {
    client: 'webhooks',
    method: 'replay',
  },
} satisfies PublicRouteMetadata;

export const publicApiV1RouteRegistry = [
  publicOpenApiRouteMetadata,
  publicFleetGraphAttentionContextsListRouteMetadata,
  publicMeRouteMetadata,
  publicDocumentsListRouteMetadata,
  publicDocumentsGetRouteMetadata,
  publicDocumentsCreateRouteMetadata,
  publicIssuesListRouteMetadata,
  publicIssuesGetRouteMetadata,
  publicIssuesCreateRouteMetadata,
  publicIssuesUpdateRouteMetadata,
  publicSprintsListRouteMetadata,
  publicSprintsGetRouteMetadata,
  publicSprintIssuesListRouteMetadata,
  publicWebhooksListRouteMetadata,
  publicWebhooksCreateRouteMetadata,
  publicWebhookDeliveriesListRouteMetadata,
  publicWebhookDeliveryReplayRouteMetadata,
] as const satisfies readonly PublicRouteMetadata[];
