// Public API v1 fitness tests lock route, auth-header, audit, rate-limit, and cursor invariants.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request, { type Test } from 'supertest';
import { z } from 'zod';
import {
  PUBLIC_API_ERROR_CODES,
  PUBLIC_API_SCOPES,
  PublicApiErrorSchema,
} from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import {
  createPublicApiTestContext,
  deletePublicApiAuditRows,
  type PublicApiTestContext,
} from '../../../test/public-api-fixtures.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';
import {
  RATE_LIMIT_HEADER_LIMIT,
  RATE_LIMIT_HEADER_REMAINING,
  RATE_LIMIT_HEADER_RESET,
} from '../../ratelimit/headers.js';
import {
  decodePublicCursor,
  encodePublicCursor,
  type PublicCursorPayload,
} from './pagination.js';
import {
  publicApiV1RouteRegistry,
  type PublicRouteMetadata,
} from './route-metadata.js';

const EXACT_API_ERROR_CODES = [
  'unauthorized',
  'expired_token',
  'forbidden',
  'not_found',
  'validation_failed',
  'rate_limited',
  'server_error',
] as const;
const PublicListEnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
}).strict();
const MISSING_UUID = '00000000-0000-4000-8000-000000000099';

describe('public API v1 fitness', () => {
  const app = createApp();
  let ctx: PublicApiTestContext;
  let allScopesToken: string;
  let expiredScopesToken: string;
  let sprintId: string;

  beforeAll(async () => {
    ctx = await createPublicApiTestContext({
      label: 'Public API Fitness',
      clientIdPrefix: 'ship_app_fitness',
      requestedScopes: [...PUBLIC_API_SCOPES],
      workspaceExtras: { sprintStartDate: '2026-01-05' },
    });
    allScopesToken = await ctx.issueToken([...PUBLIC_API_SCOPES]);
    expiredScopesToken = await ctx.issueExpiredToken([...PUBLIC_API_SCOPES]);
    sprintId = await insertSprint(ctx.workspaceId, ctx.adminUserId);
  });

  afterAll(async () => {
    if (!ctx) return;
    await deletePublicApiAuditRows({ requestIdPrefix: ctx.testRunId });
    await ctx.cleanup();
  });

  it('keeps the shared public ApiError code union exact with no extra codes', () => {
    expect(PUBLIC_API_ERROR_CODES).toEqual(EXACT_API_ERROR_CODES);
  });

  it('returns only data and next_cursor from every registered list endpoint', async () => {
    for (const route of publicApiV1RouteRegistry) {
      if (!route.isListEndpoint || route.auth !== 'oauth') continue;

      const response = await publicRouteRequest(route, listPathForRoute(route))
        .set('x-request-id', `${ctx.testRunId}-list-${route.operationId.replace(/\W/g, '-')}`)
        .set('Authorization', `Bearer ${allScopesToken}`);

      const body = expectJsonBody(response, 200, PublicListEnvelopeSchema);
      expect(Object.keys(body).sort(), route.operationId).toEqual(['data', 'next_cursor']);
      expect(Array.isArray(body.data), route.operationId).toBe(true);
      expect(body.next_cursor === null || typeof body.next_cursor === 'string', route.operationId).toBe(true);
    }
  });

  it('returns ApiError plus rate-limit headers for every registered OAuth auth failure', async () => {
    for (const route of publicApiV1RouteRegistry) {
      if (route.auth !== 'oauth') continue;

      const requestId = `${ctx.testRunId}-auth-${route.operationId.replace(/\W/g, '-')}`;
      const response = await publicRouteRequest(route, placeholderPathForRoute(route))
        .set('x-request-id', requestId);
      const body = expectJsonBody(response, 401, PublicApiErrorSchema);

      expect(Object.keys(body).sort(), route.operationId).toEqual(['code', 'message', 'request_id']);
      expect(body.code, route.operationId).toBe('unauthorized');
      expect(body.request_id, route.operationId).toBe(requestId);
      expect(response.headers[headerKey(RATE_LIMIT_HEADER_LIMIT)], route.operationId).toBeDefined();
      expect(response.headers[headerKey(RATE_LIMIT_HEADER_REMAINING)], route.operationId).toBeDefined();
      expect(response.headers[headerKey(RATE_LIMIT_HEADER_RESET)], route.operationId).toBeDefined();
    }
  });

  it('returns expired_token for every registered OAuth route with an expired bearer', async () => {
    for (const route of publicApiV1RouteRegistry) {
      if (route.auth !== 'oauth') continue;

      const requestId = `${ctx.testRunId}-expired-${route.operationId.replace(/\W/g, '-')}`;
      const response = await publicRouteRequest(route, placeholderPathForRoute(route))
        .set('x-request-id', requestId)
        .set('Authorization', `Bearer ${expiredScopesToken}`);
      const body = expectJsonBody(response, 401, PublicApiErrorSchema);

      expect(Object.keys(body).sort(), route.operationId).toEqual(['code', 'message', 'request_id']);
      expect(body.code, route.operationId).toBe('expired_token');
      expect(body.message, route.operationId).toBe('Bearer token expired');
      expect(body.request_id, route.operationId).toBe(requestId);
    }
  });

  it('returns route-specific public ApiErrors and audit identity fields from the registry matrix', async () => {
    for (const testCase of routeFailureCases()) {
      const route = routeByOperation(testCase.operationId);
      const requestId = `${ctx.testRunId}-failure-${route.operationId.replace(/\W/g, '-')}`;
      let apiRequest = publicRouteRequest(route, testCase.path)
        .set('x-request-id', requestId)
        .set('Authorization', `Bearer ${allScopesToken}`);
      if (testCase.body !== undefined) apiRequest = apiRequest.send(testCase.body);

      const response = await apiRequest;
      expect(response.status, route.operationId).toBe(testCase.status);
      const body = expectJsonBody(response, testCase.status, PublicApiErrorSchema);
      expect(body.code, route.operationId).toBe(testCase.code);
      expect(body.request_id, route.operationId).toBe(requestId);
      expect(response.headers[headerKey(RATE_LIMIT_HEADER_LIMIT)], route.operationId).toBeDefined();
      expect(response.headers[headerKey(RATE_LIMIT_HEADER_REMAINING)], route.operationId).toBeDefined();
      expect(response.headers[headerKey(RATE_LIMIT_HEADER_RESET)], route.operationId).toBeDefined();

      const audit = await pool.query<{
        app_id: string | null;
        client_id: string | null;
        user_id: string | null;
        workspace_id: string | null;
        method: string;
        route: string;
        scope_used: string | null;
        status: number;
        error_code: string | null;
      }>(
        `SELECT app_id, client_id, user_id, workspace_id, method, route, scope_used, status, error_code
         FROM public_api_audit_logs
         WHERE request_id = $1`,
        [requestId]
      );
      expect(requireFirstRow(audit.rows), route.operationId).toMatchObject({
        app_id: ctx.appId,
        client_id: ctx.clientId,
        user_id: ctx.adminUserId,
        workspace_id: ctx.workspaceId,
        method: route.method,
        route: route.path,
        scope_used: route.requiredScopes.length > 0 ? route.requiredScopes.join(' ') : null,
        status: testCase.status,
        error_code: testCase.code,
      });
    }
  });

  it('audits successful /me calls with token identity metadata', async () => {
    const route = routeByOperation('me.get');
    const requestId = `${ctx.testRunId}-success-me`;
    const response = await request(app)
      .get(route.path)
      .set('x-request-id', requestId)
      .set('Authorization', `Bearer ${allScopesToken}`);

    expect(response.status).toBe(200);
    const audit = await pool.query<{
      app_id: string | null;
      client_id: string | null;
      user_id: string | null;
      workspace_id: string | null;
      route: string;
      scope_used: string | null;
      status: number;
      error_code: string | null;
    }>(
      `SELECT app_id, client_id, user_id, workspace_id, route, scope_used, status, error_code
       FROM public_api_audit_logs
       WHERE request_id = $1`,
      [requestId]
    );
    expect(requireFirstRow(audit.rows)).toMatchObject({
      app_id: ctx.appId,
      client_id: ctx.clientId,
      user_id: ctx.adminUserId,
      workspace_id: ctx.workspaceId,
      route: route.path,
      scope_used: null,
      status: 200,
      error_code: null,
    });
  });

  it('keeps document cursor pages stable when newer rows arrive between page reads', async () => {
    const createdAt = new Date(Date.now() - 10 * 60 * 1000);
    const seededIds = await insertCursorDocuments(createdAt);
    const firstResponse = await request(app)
      .get('/api/v1/documents')
      .query({ limit: 2, type: 'wiki' })
      .set('x-request-id', `${ctx.testRunId}-cursor-page-1`)
      .set('Authorization', `Bearer ${allScopesToken}`);
    const firstPage = expectJsonBody(firstResponse, 200, z.object({
      data: z.array(z.object({ id: z.string().uuid() })),
      next_cursor: z.string(),
    }));
    expect(firstPage.data).toHaveLength(2);

    const newerId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility, created_at, updated_at
       )
       VALUES ($1, 'wiki', $2, '{}', $3, 'workspace', NOW(), NOW())
       RETURNING id`,
      [ctx.workspaceId, `Cursor newer ${ctx.testRunId}`, ctx.adminUserId]
    )).rows).id;

    const secondResponse = await request(app)
      .get('/api/v1/documents')
      .query({ limit: 2, type: 'wiki', cursor: firstPage.next_cursor })
      .set('x-request-id', `${ctx.testRunId}-cursor-page-2`)
      .set('Authorization', `Bearer ${allScopesToken}`);
    const secondPage = expectJsonBody(secondResponse, 200, z.object({
      data: z.array(z.object({ id: z.string().uuid() })),
      next_cursor: z.string().nullable(),
    }));
    const firstIds = firstPage.data.map(row => row.id);
    const secondIds = secondPage.data.map(row => row.id);
    expect(secondIds).not.toContain(newerId);
    expect(secondIds.some(id => firstIds.includes(id))).toBe(false);
    expect([...firstIds, ...secondIds].filter(id => seededIds.includes(id)).length).toBeGreaterThanOrEqual(3);
  });

  it('round-trips valid cursors and rejects malformed cursor payloads', () => {
    const payload: PublicCursorPayload = {
      id: '00000000-0000-4000-8000-000000000001',
      timestamp: '2026-06-03T12:00:00.000Z',
    };

    expect(decodePublicCursor(encodePublicCursor(payload))).toEqual(payload);
    expect(decodePublicCursor('not base64')).toBeNull();
    expect(decodePublicCursor(base64Json('not json'))).toBeNull();
    expect(decodePublicCursor(base64Json({ id: payload.id }))).toBeNull();
    expect(decodePublicCursor(base64Json({ timestamp: payload.timestamp }))).toBeNull();
    expect(decodePublicCursor(base64Json({ id: payload.id, timestamp: 'not-a-date' }))).toBeNull();
    expect(decodePublicCursor(base64Json({ id: 123, timestamp: payload.timestamp }))).toBeNull();
  });

  async function insertSprint(workspaceId: string, userId: string): Promise<string> {
    return requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'sprint', 'Fitness Sprint', $2, $3, 'workspace')
       RETURNING id`,
      [
        workspaceId,
        {
          sprint_number: 1,
          status: 'planning',
          assignee_ids: [userId],
          plan: 'Fitness route coverage',
          success_criteria: ['List envelope returned'],
          confidence: 80,
        },
        userId,
      ]
    )).rows).id;
  }

  async function insertCursorDocuments(createdAt: Date): Promise<string[]> {
    const result = await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility, created_at, updated_at
       )
       VALUES
         ($1, 'wiki', $2, '{}', $3, 'workspace', $4, $4),
         ($1, 'wiki', $5, '{}', $3, 'workspace', $4, $4),
         ($1, 'wiki', $6, '{}', $3, 'workspace', $4, $4)
       RETURNING id`,
      [
        ctx.workspaceId,
        `Cursor stable A ${ctx.testRunId}`,
        ctx.adminUserId,
        createdAt,
        `Cursor stable B ${ctx.testRunId}`,
        `Cursor stable C ${ctx.testRunId}`,
      ]
    );
    return result.rows.map(row => row.id);
  }

  function routeByOperation(operationId: string): PublicRouteMetadata {
    const route = publicApiV1RouteRegistry.find(candidate => candidate.operationId === operationId);
    if (!route) throw new Error(`Missing public route metadata for ${operationId}`);
    return route;
  }

  function routeFailureCases(): Array<{
    operationId: string;
    path: string;
    status: number;
    code: typeof EXACT_API_ERROR_CODES[number];
    body?: unknown;
  }> {
    return [
      { operationId: 'fleetgraph.attentionContexts.list', path: '/api/v1/fleetgraph/attention-contexts?source_issue_id=not-a-uuid', status: 400, code: 'validation_failed' },
      { operationId: 'documents.list', path: '/api/v1/documents?cursor=not-a-cursor', status: 400, code: 'validation_failed' },
      { operationId: 'documents.get', path: `/api/v1/documents/${MISSING_UUID}`, status: 404, code: 'not_found' },
      { operationId: 'documents.create', path: '/api/v1/documents', status: 400, code: 'validation_failed', body: { title: '' } },
      { operationId: 'issues.list', path: '/api/v1/issues?cursor=not-a-cursor', status: 400, code: 'validation_failed' },
      { operationId: 'issues.get', path: `/api/v1/issues/${MISSING_UUID}`, status: 404, code: 'not_found' },
      { operationId: 'issues.create', path: '/api/v1/issues', status: 400, code: 'validation_failed', body: { title: '' } },
      { operationId: 'issues.update', path: `/api/v1/issues/${MISSING_UUID}`, status: 404, code: 'not_found', body: { state: 'done' } },
      {
        operationId: 'issues.externalLinks.upsert',
        path: `/api/v1/issues/${MISSING_UUID}/external-links`,
        status: 404,
        code: 'not_found',
        body: {
          provider: 'gitlab',
          external_id: 'missing-issue',
          kind: 'merge_request',
          url: 'https://gitlab.example.test/group/project/-/merge_requests/9',
          title: 'Missing issue merge request',
        },
      },
      { operationId: 'sprints.list', path: '/api/v1/sprints?cursor=not-a-cursor', status: 400, code: 'validation_failed' },
      { operationId: 'sprints.get', path: `/api/v1/sprints/${MISSING_UUID}`, status: 404, code: 'not_found' },
      { operationId: 'sprints.issues.list', path: `/api/v1/sprints/${MISSING_UUID}/issues`, status: 404, code: 'not_found' },
      { operationId: 'webhooks.list', path: '/api/v1/webhooks?cursor=not-a-cursor', status: 400, code: 'validation_failed' },
      { operationId: 'webhooks.create', path: '/api/v1/webhooks', status: 400, code: 'validation_failed', body: { event: 'document.created', target_url: 'not-a-url' } },
      { operationId: 'webhooks.delete', path: `/api/v1/webhooks/${MISSING_UUID}`, status: 404, code: 'not_found' },
      { operationId: 'webhooks.deliveries.list', path: '/api/v1/webhooks/deliveries?cursor=not-a-cursor', status: 400, code: 'validation_failed' },
      { operationId: 'webhooks.deliveries.replay', path: `/api/v1/webhooks/deliveries/${MISSING_UUID}/replay`, status: 404, code: 'not_found' },
    ];
  }

  function publicRouteRequest(route: PublicRouteMetadata, path: string): Test {
    switch (route.method) {
      case 'GET':
        return request(app).get(path);
      case 'POST':
        return request(app).post(path);
      case 'PATCH':
        return request(app).patch(path);
      case 'DELETE':
        return request(app).delete(path);
    }
  }

  function listPathForRoute(route: PublicRouteMetadata): string {
    if (route.operationId === 'sprints.issues.list') {
      return route.path.replace(':id', sprintId);
    }
    return route.path;
  }

  function placeholderPathForRoute(route: PublicRouteMetadata): string {
    return route.path.replace(':id', '00000000-0000-4000-8000-000000000002');
  }

  function base64Json(value: unknown): string {
    return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('base64url');
  }

  function headerKey(header: string): string {
    return header.toLowerCase();
  }
});
