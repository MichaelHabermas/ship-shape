// Public document API tests cover OAuth scopes, cursor shape, explicit titles, and audit rows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  PublicApiErrorSchema,
  PublicDocumentSchema,
  PublicDocumentsListResponseSchema,
} from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import { createOAuthAccessToken } from '../../oauth/tokens.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';

type PublicApiAuditRow = {
  app_id: string | null;
  client_id: string | null;
  user_id: string | null;
  workspace_id: string | null;
  method: string;
  route: string;
  scope_used: string | null;
  status: number;
  error_code: string | null;
};

describe('/api/v1/documents', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `public-documents-${testRunId}@ship.local`;
  const clientId = `ship_app_documents_${testRunId}`;

  let workspaceId: string;
  let userId: string;
  let memberUserId: string;
  let appId: string;
  let readWriteToken: string;
  let readOnlyToken: string;
  let memberReadToken: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Public Documents ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;
    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Public Documents User')
       RETURNING id`,
      [email]
    );
    userId = requireFirstRow(userResult.rows).id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [workspaceId, userId]
    );
    const memberUserResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Public Documents Member')
       RETURNING id`,
      [`public-documents-member-${testRunId}@ship.local`]
    );
    memberUserId = requireFirstRow(memberUserResult.rows).id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [workspaceId, memberUserId]
    );
    const appResult = await pool.query<IdRow>(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, 'Public Documents Test App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        ['https://example.test/callback'],
        ['documents:read', 'documents:write'],
      ]
    );
    appId = requireFirstRow(appResult.rows).id;

    readWriteToken = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read', 'documents:write'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
    readOnlyToken = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
    memberReadToken = (await createOAuthAccessToken({
      appId,
      userId: memberUserId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2', [workspaceId, clientId]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [appId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, memberUserId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('enforces write scope and returns public rate-limit headers', async () => {
    const response = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({ title: 'scope failure' });

    const body = expectJsonBody(response, 403, PublicApiErrorSchema);
    expect(body.code).toBe('forbidden');
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('creates documents with explicit titles, gets them, and pages list results with cursors', async () => {
    const first = await createDocument('hello');
    const second = await createDocument('second');

    expect(first.title).toBe('hello');
    expect(second.title).toBe('second');

    const getResponse = await request(app)
      .get(`/api/v1/documents/${first.id}`)
      .set('Authorization', `Bearer ${readWriteToken}`);
    const fetched = expectJsonBody(getResponse, 200, PublicDocumentSchema);
    expect(fetched.id).toBe(first.id);

    const listResponse = await request(app)
      .get('/api/v1/documents')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${readWriteToken}`);
    const firstPage = expectJsonBody(listResponse, 200, PublicDocumentsListResponseSchema);
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const nextResponse = await request(app)
      .get('/api/v1/documents')
      .query({ limit: 1, cursor: firstPage.next_cursor })
      .set('Authorization', `Bearer ${readWriteToken}`);
    const secondPage = expectJsonBody(nextResponse, 200, PublicDocumentsListResponseSchema);
    expect(secondPage.data).toHaveLength(1);
  });

  it('returns validation errors and records audit rows for document create', async () => {
    const validationResponse = await request(app)
      .get('/api/v1/documents/not-a-uuid')
      .set('Authorization', `Bearer ${readWriteToken}`);
    const validation = expectJsonBody(validationResponse, 400, PublicApiErrorSchema);
    expect(validation.code).toBe('validation_failed');

    const requestId = `${testRunId}-create`;
    const createResponse = await request(app)
      .post('/api/v1/documents')
      .set('x-request-id', requestId)
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ title: 'audited' });
    expectJsonBody(createResponse, 201, PublicDocumentSchema);

    const audit = await waitForAuditRow(requestId);
    expect(audit).toMatchObject({
      app_id: appId,
      client_id: clientId,
      user_id: userId,
      workspace_id: workspaceId,
      method: 'POST',
      route: '/api/v1/documents',
      scope_used: 'documents:write',
      status: 201,
      error_code: null,
    });
  });

  it('does not expose another user accountability document through public document reads', async () => {
    const personResult = await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'person', 'Plan Owner', $2, $3, 'workspace')
       RETURNING id`,
      [workspaceId, { user_id: userId }, userId]
    );
    const personId = requireFirstRow(personResult.rows).id;
    const weeklyPlanResult = await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'weekly_plan', 'Private plan', $2, $3, 'workspace')
       RETURNING id`,
      [workspaceId, { person_id: personId }, userId]
    );
    const weeklyPlanId = requireFirstRow(weeklyPlanResult.rows).id;

    const getResponse = await request(app)
      .get(`/api/v1/documents/${weeklyPlanId}`)
      .set('Authorization', `Bearer ${memberReadToken}`);
    const getBody = expectJsonBody(getResponse, 404, PublicApiErrorSchema);
    expect(getBody.code).toBe('not_found');

    const listResponse = await request(app)
      .get('/api/v1/documents')
      .query({ type: 'weekly_plan' })
      .set('Authorization', `Bearer ${memberReadToken}`);
    const listBody = expectJsonBody(listResponse, 200, PublicDocumentsListResponseSchema);
    expect(listBody.data.map(document => document.id)).not.toContain(weeklyPlanId);
  });

  async function createDocument(title: string) {
    const response = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ title });
    return expectJsonBody(response, 201, PublicDocumentSchema);
  }

  async function waitForAuditRow(requestId: string): Promise<PublicApiAuditRow> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await pool.query<PublicApiAuditRow>(
        `SELECT app_id, client_id, user_id, workspace_id, method, route, scope_used, status, error_code
         FROM public_api_audit_logs
         WHERE request_id = $1`,
        [requestId]
      );
      if (result.rows[0]) return result.rows[0];
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Audit row not found for ${requestId}`);
  }
});
