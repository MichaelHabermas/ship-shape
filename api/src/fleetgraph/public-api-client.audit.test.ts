// FleetGraph public client audit proof verifies user-initiated agent reads use @ship/sdk and /api/v1.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { FetchLike } from '@ship/sdk';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import {
  createPublicApiTestContext,
  deleteIssueIterationsForWorkspace,
  type PublicApiTestContext,
} from '../test/public-api-fixtures.js';
import { type IdRow, requireFirstRow } from '../test/pg-result.js';
import { createShipAgentPublicClient } from './public-api-client.js';

describe('FleetGraph public API client audit proof', () => {
  const app = createApp();
  let ctx: PublicApiTestContext;
  let visibleIssueId: string;

  beforeAll(async () => {
    ctx = await createPublicApiTestContext({
      label: 'FleetGraph Agent Audit',
      clientIdPrefix: 'ship_app_agent_audit',
      requestedScopes: ['documents:read', 'issues:read', 'sprints:read'],
      workspaceExtras: { sprintStartDate: '2026-01-05' },
    });

    const sprintId = await insertDocument('sprint', 'Agent Audit Sprint', 'workspace', {
      sprint_number: 12,
      owner_id: ctx.adminUserId,
    });
    visibleIssueId = await insertDocument('issue', 'Agent public source issue', 'workspace', {
      priority: 'urgent',
      state: 'blocked',
      assignee_id: ctx.adminUserId,
    }, 812);
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')`,
      [visibleIssueId, sprintId]
    );
    await pool.query(
      `INSERT INTO issue_iterations (workspace_id, issue_id, status, what_attempted, blockers_encountered, author_id)
       VALUES ($1, $2, 'fail', 'Checked public reader path', 'Blocked on audit evidence', $3)`,
      [ctx.workspaceId, visibleIssueId, ctx.adminUserId]
    );
  });

  afterAll(async () => {
    await deleteIssueIterationsForWorkspace(ctx.workspaceId);
    await pool.query(
      'DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)',
      [ctx.workspaceId]
    );
    await ctx.cleanup();
  });

  it('records ship-agent audit rows when source reads go through the SDK', async () => {
    const { client, token } = await createShipAgentPublicClient({
      workspaceId: ctx.workspaceId,
      userId: ctx.adminUserId,
      baseUrl: 'http://ship.test',
      fetch: supertestFetch(app),
    });

    const result = await client.fleetgraph.attentionContexts.list({
      source_issue_id: visibleIssueId,
      limit: 1,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.issue_id).toBe(visibleIssueId);

    const appRow = requireFirstRow((await pool.query<{
      client_id: string;
      is_first_party: boolean;
      system_key: string | null;
    }>(
      `SELECT client_id, is_first_party, system_key
       FROM oauth_apps
       WHERE id = $1`,
      [token.appId]
    )).rows);
    expect(appRow).toMatchObject({
      client_id: token.clientId,
      is_first_party: true,
      system_key: 'ship-agent',
    });

    const audit = requireFirstRow((await pool.query<{
      client_id: string | null;
      user_id: string | null;
      route: string;
      scope_used: string | null;
      status: number;
      latency_ms: number;
    }>(
      `SELECT client_id, user_id, route, scope_used, status, latency_ms
       FROM public_api_audit_logs
       WHERE workspace_id = $1
         AND app_id = $2
         AND route = '/api/v1/fleetgraph/attention-contexts'
       ORDER BY created_at DESC
       LIMIT 1`,
      [ctx.workspaceId, token.appId]
    )).rows);
    expect(audit).toMatchObject({
      client_id: token.clientId,
      user_id: ctx.adminUserId,
      route: '/api/v1/fleetgraph/attention-contexts',
      scope_used: 'documents:read issues:read sprints:read',
      status: 200,
    });
    expect(audit.latency_ms).toBeGreaterThanOrEqual(0);
  });

  async function insertDocument(
    documentType: string,
    title: string,
    visibility: 'private' | 'workspace',
    properties: Record<string, unknown>,
    ticketNumber?: number
  ): Promise<string> {
    return requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, visibility, properties, ticket_number, created_by
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        ctx.workspaceId,
        documentType,
        title,
        visibility,
        JSON.stringify(properties),
        ticketNumber ?? null,
        ctx.adminUserId,
      ]
    )).rows).id;
  }
});

function supertestFetch(app: Express): FetchLike {
  return async (input, init = {}) => {
    const url = new URL(input.toString());
    const headers = headersFromInit(init.headers);
    const method = init.method?.toUpperCase() ?? 'GET';
    let testRequest = request(app)[method.toLowerCase() as 'get' | 'post' | 'patch'](`${url.pathname}${url.search}`)
      .set(headers);
    if (init.body !== undefined) testRequest = testRequest.send(init.body);

    const response = await testRequest;
    return new Response(response.text, {
      status: response.status,
      headers: response.headers as HeadersInit,
    });
  };
}

function headersFromInit(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    const record: Record<string, string> = {};
    for (const [key, value] of headers) record[key] = value;
    return record;
  }
  return headers;
}
