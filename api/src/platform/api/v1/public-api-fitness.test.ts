// Public API v1 fitness tests lock route, auth-header, and cursor invariants; error-code drift is expected-fail.
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

describe('public API v1 fitness', () => {
  const app = createApp();
  let ctx: PublicApiTestContext;
  let allScopesToken: string;
  let sprintId: string;

  beforeAll(async () => {
    ctx = await createPublicApiTestContext({
      label: 'Public API Fitness',
      clientIdPrefix: 'ship_app_fitness',
      requestedScopes: [...PUBLIC_API_SCOPES],
      workspaceExtras: { sprintStartDate: '2026-01-05' },
    });
    allScopesToken = await ctx.issueToken([...PUBLIC_API_SCOPES]);
    sprintId = await insertSprint(ctx.workspaceId, ctx.adminUserId);
  });

  afterAll(async () => {
    if (!ctx) return;
    await deletePublicApiAuditRows({ requestIdPrefix: ctx.testRunId });
    await ctx.cleanup();
  });

  it.fails('keeps the shared public ApiError code union exact with no extra codes', () => {
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

  function publicRouteRequest(route: PublicRouteMetadata, path: string): Test {
    switch (route.method) {
      case 'GET':
        return request(app).get(path);
      case 'POST':
        return request(app).post(path);
      case 'PATCH':
        return request(app).patch(path);
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
