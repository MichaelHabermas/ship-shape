// Public route registry tests keep /api/v1 contract metadata from drifting.
import { afterAll, describe, expect, it } from 'vitest';
import request, { type Test } from 'supertest';
import { PUBLIC_API_RELATIVE_PATHS, PUBLIC_API_SCOPES, PublicApiErrorSchema } from '@ship/shared';
import { ShipClient, type FetchLike } from '@ship/sdk';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import {
  publicApiV1RouteRegistry,
  type PublicRouteMetadata,
  type PublicRouteSdkMetadata,
} from './route-metadata.js';
import { publicRouteOpenApiContracts } from './route-openapi-contracts.js';

type FetchCall = {
  input: string | URL;
  init?: RequestInit;
};

describe('public API v1 route registry', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  afterAll(async () => {
    await pool.query('DELETE FROM public_api_audit_logs WHERE request_id LIKE $1', [
      `${testRunId}-%`,
    ]);
  });

  it('declares unique operation ids and explicit scope requirements', () => {
    const operationIds = publicApiV1RouteRegistry.map(route => route.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);

    const allowedScopes = new Set<string>(PUBLIC_API_SCOPES);
    for (const route of publicApiV1RouteRegistry) {
      expect(Object.hasOwn(route, 'requiredScopes')).toBe(true);
      expect(Array.isArray(route.requiredScopes)).toBe(true);
      for (const scope of route.requiredScopes) {
        expect(allowedScopes.has(scope)).toBe(true);
      }
      if (route.auth === 'oauth') {
        expect(route.sdk).toBeDefined();
      }
    }
  });

  it('keeps handler mount paths aligned with public paths', () => {
    for (const route of publicApiV1RouteRegistry) {
      expect(route.path).toBe(`/api/v1${route.handlerMountPath}`);
      expect(['oauth', 'none']).toContain(route.auth);
    }
  });

  it('requires cursor pagination metadata for registered list endpoints', () => {
    for (const route of publicApiV1RouteRegistry) {
      if (route.isListEndpoint) {
        expect(['cursor', 'none']).toContain(route.pagination);
      }
    }
  });

  it('keeps OpenAPI contracts aligned with registry operationIds', () => {
    const registryIds = publicApiV1RouteRegistry.map(route => route.operationId).sort();
    const contractIds = Object.keys(publicRouteOpenApiContracts).sort();
    expect(contractIds).toEqual(registryIds);

    for (const operationId of registryIds) {
      const contract = publicRouteOpenApiContracts[operationId];
      expect(contract, operationId).toBeDefined();
      const statuses = Object.keys(contract.responses);
      expect(statuses.some(status => status.startsWith('2')), operationId).toBe(true);
    }
  });

  it('keeps registry paths aligned with shared public API suffixes', () => {
    const suffixByOperation: Record<string, string> = {
      'openapi.get': PUBLIC_API_RELATIVE_PATHS.openapi,
      'me.get': PUBLIC_API_RELATIVE_PATHS.me,
      'documents.list': PUBLIC_API_RELATIVE_PATHS.documents,
      'documents.get': PUBLIC_API_RELATIVE_PATHS.document,
      'documents.create': PUBLIC_API_RELATIVE_PATHS.documents,
      'fleetgraph.attentionContexts.list': PUBLIC_API_RELATIVE_PATHS.fleetgraphAttentionContexts,
      'issues.list': PUBLIC_API_RELATIVE_PATHS.issues,
      'issues.get': PUBLIC_API_RELATIVE_PATHS.issue,
      'issues.create': PUBLIC_API_RELATIVE_PATHS.issues,
      'issues.update': PUBLIC_API_RELATIVE_PATHS.issue,
      'issues.externalLinks.upsert': PUBLIC_API_RELATIVE_PATHS.issueExternalLinks,
      'sprints.list': PUBLIC_API_RELATIVE_PATHS.sprints,
      'sprints.get': PUBLIC_API_RELATIVE_PATHS.sprint,
      'sprints.issues.list': PUBLIC_API_RELATIVE_PATHS.sprintIssues,
      'webhooks.list': PUBLIC_API_RELATIVE_PATHS.webhooks,
      'webhooks.create': PUBLIC_API_RELATIVE_PATHS.webhooks,
      'webhooks.deliveries.list': PUBLIC_API_RELATIVE_PATHS.webhookDeliveries,
      'webhooks.deliveries.replay': PUBLIC_API_RELATIVE_PATHS.webhookDeliveryReplay,
    };
    for (const route of publicApiV1RouteRegistry) {
      const suffix = suffixByOperation[route.operationId];
      if (!suffix) continue;
      expect(route.path).toBe(`/api/v1${suffix}`);
    }
  });

  it('keeps route SDK metadata backed by typed SDK calls with matching method and path', async () => {
    const routes: readonly PublicRouteMetadata[] = publicApiV1RouteRegistry;
    for (const route of routes) {
      if (!hasSdkMetadata(route)) continue;
      const calls: FetchCall[] = [];
      const client = new ShipClient({
        baseUrl: 'https://ship.test',
        token: 'token',
        fetch: recordingFetch(calls),
      });

      const expectedPathname = await invokeSdkRoute(route, client);
      expect(calls, `${route.operationId} SDK fetch calls`).toHaveLength(1);
      const call = calls[0];
      expect(call.init?.method, `${route.operationId} SDK method`).toBe(route.method);
      expect(new URL(String(call.input)).pathname, `${route.operationId} SDK path`).toBe(expectedPathname);
    }
  });

  it('returns the public ApiError contract on registered OAuth auth failures', async () => {
    for (const route of publicApiV1RouteRegistry) {
      if (route.auth !== 'oauth') continue;
      const requestId = `${testRunId}-${route.operationId.replace(/\W/g, '-')}`;
      const response = await publicRouteRequest(route).set('x-request-id', requestId);
      const body = expectJsonBody(response, 401, PublicApiErrorSchema);

      expect(body.code).toBe('unauthorized');
      expect(body.request_id).toBe(requestId);
    }
  });

  function publicRouteRequest(route: PublicRouteMetadata): Test {
    switch (route.method) {
      case 'GET':
        return request(app).get(route.path);
      case 'POST':
        return request(app).post(route.path);
      case 'PATCH':
        return request(app).patch(route.path);
    }
  }

  function hasSdkMetadata(
    route: PublicRouteMetadata
  ): route is PublicRouteMetadata & { sdk: PublicRouteSdkMetadata } {
    return route.sdk !== undefined;
  }

  function recordingFetch(calls: FetchCall[]): FetchLike {
    return async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ data: [], next_cursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  }

  async function invokeSdkRoute(route: PublicRouteMetadata, client: ShipClient): Promise<string> {
    const id = 'route-parity-id';
    const deliveryId = 'delivery-parity-id';
    switch (route.operationId) {
      case 'fleetgraph.attentionContexts.list':
        await client.fleetgraph.attentionContexts.list({ limit: 1 });
        return '/api/v1/fleetgraph/attention-contexts';
      case 'me.get':
        await client.me();
        return '/api/v1/me';
      case 'documents.list':
        await client.documents.list({ limit: 1 });
        return '/api/v1/documents';
      case 'documents.get':
        await client.documents.get(id);
        return '/api/v1/documents/route-parity-id';
      case 'documents.create':
        await client.documents.create({ title: 'Route parity', document_type: 'wiki' });
        return '/api/v1/documents';
      case 'issues.list':
        await client.issues.list({ limit: 1 });
        return '/api/v1/issues';
      case 'issues.get':
        await client.issues.get(id);
        return '/api/v1/issues/route-parity-id';
      case 'issues.create':
        await client.issues.create({ title: 'Route parity issue' });
        return '/api/v1/issues';
      case 'issues.update':
        await client.issues.update(id, { title: 'Route parity issue update' });
        return '/api/v1/issues/route-parity-id';
      case 'issues.externalLinks.upsert':
        await client.issues.upsertExternalLink(id, {
          provider: 'gitlab',
          external_id: 'route-parity-link',
          kind: 'merge_request',
          url: 'https://gitlab.example.test/group/project/-/merge_requests/1',
        });
        return '/api/v1/issues/route-parity-id/external-links';
      case 'sprints.list':
        await client.sprints.list({ limit: 1 });
        return '/api/v1/sprints';
      case 'sprints.get':
        await client.sprints.get(id);
        return '/api/v1/sprints/route-parity-id';
      case 'sprints.issues.list':
        await client.sprints.listIssues(id, { limit: 1 });
        return '/api/v1/sprints/route-parity-id/issues';
      case 'webhooks.list':
        await client.webhooks.list({ limit: 1 });
        return '/api/v1/webhooks';
      case 'webhooks.create':
        await client.webhooks.create({
          event: 'issue.status_changed',
          targetUrl: 'https://integrator.example.test/webhooks/ship',
        });
        return '/api/v1/webhooks';
      case 'webhooks.deliveries.list':
        await client.webhooks.listDeliveries({ limit: 1 });
        return '/api/v1/webhooks/deliveries';
      case 'webhooks.deliveries.replay':
        await client.webhooks.replay(deliveryId);
        return '/api/v1/webhooks/deliveries/delivery-parity-id/replay';
      default:
        throw new Error(`No SDK parity call for ${route.operationId}`);
    }
  }
});
