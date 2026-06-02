// Public route registry keeps /api/v1 contract facts executable from one place.
import type { PublicApiScope } from '@ship/shared';
import {
  PUBLIC_OPENAPI_PATH,
  PUBLIC_DOCUMENT_PATH,
  PUBLIC_DOCUMENTS_PATH,
  PUBLIC_ME_PATH,
  PUBLIC_WEBHOOK_DELIVERIES_PATH,
  PUBLIC_WEBHOOK_DELIVERY_REPLAY_PATH,
  PUBLIC_WEBHOOKS_PATH,
} from './paths.js';

// Current edge-piece methods only. Extend this union when a real public route
// needs another method; do not treat GET/POST as the whole platform contract.
export type PublicHttpMethod = 'GET' | 'POST';
export type PublicRouteAuth = 'oauth' | 'none';
export type PublicRouteOperationId = string;
export type PublicRouteSdkMetadata = {
  client: 'root' | 'documents' | 'issues' | 'sprints' | 'webhooks';
  method: string;
};
export type PublicRouteExample = {
  name: string;
  description?: string;
};

type PublicRouteMetadataBase = {
  method: PublicHttpMethod;
  path: string;
  operationId: PublicRouteOperationId;
  requiredScope: PublicApiScope | null;
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
      pagination: 'cursor';
    });

export const publicMeRouteMetadata = {
  method: 'GET',
  path: PUBLIC_ME_PATH,
  operationId: 'me.get',
  requiredScope: null,
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
  requiredScope: null,
  auth: 'none',
  handlerMountPath: '/openapi.json',
  isListEndpoint: false,
} satisfies PublicRouteMetadata;

export const publicDocumentsListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_DOCUMENTS_PATH,
  operationId: 'documents.list',
  requiredScope: 'documents:read',
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
  requiredScope: 'documents:read',
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
  requiredScope: 'documents:write',
  auth: 'oauth',
  handlerMountPath: '/documents',
  isListEndpoint: false,
  sdk: {
    client: 'documents',
    method: 'create',
  },
} satisfies PublicRouteMetadata;

export const publicWebhooksListRouteMetadata = {
  method: 'GET',
  path: PUBLIC_WEBHOOKS_PATH,
  operationId: 'webhooks.list',
  requiredScope: 'webhooks:manage',
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
  requiredScope: 'webhooks:manage',
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
  requiredScope: 'webhooks:manage',
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
  requiredScope: 'webhooks:manage',
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
  publicMeRouteMetadata,
  publicDocumentsListRouteMetadata,
  publicDocumentsGetRouteMetadata,
  publicDocumentsCreateRouteMetadata,
  publicWebhooksListRouteMetadata,
  publicWebhooksCreateRouteMetadata,
  publicWebhookDeliveriesListRouteMetadata,
  publicWebhookDeliveryReplayRouteMetadata,
] as const satisfies readonly PublicRouteMetadata[];
