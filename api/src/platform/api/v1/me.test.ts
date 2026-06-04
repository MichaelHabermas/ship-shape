// Public /api/v1/me tests prove OAuth bearer validation and public audit logging.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PublicApiErrorSchema, PublicMeResponseSchema } from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import { createOAuthAccessToken, hashOAuthAccessToken } from '../../oauth/tokens.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';

describe('GET /api/v1/me', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `public-me-${testRunId}@ship.local`;
  const clientId = `ship_app_test_${testRunId}`;

  let workspaceId: string;
  let userId: string;
  let appId: string;
  let validToken: string;
  let expiredToken: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Public API ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Public API User')
       RETURNING id`,
      [testEmail]
    );
    userId = requireFirstRow(userResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [workspaceId, userId]
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
       VALUES ($1, $2, 'Public API Test App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        ['https://example.test/callback'],
        ['documents:read'],
      ]
    );
    appId = requireFirstRow(appResult.rows).id;

    validToken = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;

    expiredToken = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() - 60 * 1000),
    })).token;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2 OR request_id LIKE $3', [
      workspaceId,
      clientId,
      `${testRunId}-%`,
    ]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [appId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('returns ApiError for missing bearer token', async () => {
    const requestId = `${testRunId}-missing`;
    const response = await request(app)
      .get('/api/v1/me')
      .set('x-request-id', requestId);

    const body = expectJsonBody(response, 401, PublicApiErrorSchema);
    expect(body.code).toBe('unauthorized');
    expect(body.request_id).toBe(requestId);

    const audit = await waitForAuditRow(requestId);
    expect(audit).toMatchObject({
      app_id: null,
      client_id: null,
      user_id: null,
      workspace_id: null,
      method: 'GET',
      route: '/api/v1/me',
      scope_used: null,
      status: 401,
      error_code: 'unauthorized',
    });
  });

  it('returns ApiError for invalid bearer token', async () => {
    const requestId = `${testRunId}-invalid`;
    const response = await request(app)
      .get('/api/v1/me')
      .set('x-request-id', requestId)
      .set('Authorization', 'Bearer ship_oat_invalid');

    const body = expectJsonBody(response, 401, PublicApiErrorSchema);
    expect(body.code).toBe('unauthorized');

    const audit = await waitForAuditRow(requestId);
    expect(audit).toMatchObject({
      app_id: null,
      client_id: null,
      user_id: null,
      workspace_id: null,
      method: 'GET',
      route: '/api/v1/me',
      scope_used: null,
      status: 401,
      error_code: 'unauthorized',
    });
  });

  it('returns expired_token for expired bearer tokens', async () => {
    const requestId = `${testRunId}-expired`;
    const response = await request(app)
      .get('/api/v1/me')
      .set('x-request-id', requestId)
      .set('Authorization', `Bearer ${expiredToken}`);

    const body = expectJsonBody(response, 401, PublicApiErrorSchema);
    expect(body.code).toBe('expired_token');
    expect(body.message).toBe('Bearer token expired');
    expect(body.details).toBeUndefined();

    const audit = await waitForAuditRow(requestId);
    expect(audit).toMatchObject({
      app_id: null,
      client_id: null,
      user_id: null,
      workspace_id: null,
      method: 'GET',
      route: '/api/v1/me',
      scope_used: null,
      status: 401,
      error_code: 'expired_token',
    });
  });

  it('returns the public ApiError contract for unsupported v1 methods', async () => {
    const requestId = `${testRunId}-method`;
    const response = await request(app)
      .post('/api/v1/me')
      .set('x-request-id', requestId);

    const body = expectJsonBody(response, 404, PublicApiErrorSchema);
    expect(body).toEqual({
      code: 'not_found',
      message: 'Route not found',
      request_id: requestId,
    });

    const audit = await waitForAuditRow(requestId);
    expect(audit).toMatchObject({
      app_id: null,
      client_id: null,
      user_id: null,
      workspace_id: null,
      method: 'POST',
      route: '/api/v1/me',
      scope_used: null,
      status: 404,
      error_code: 'not_found',
    });
  });

  it('returns the public ApiError contract for malformed JSON', async () => {
    const requestId = `${testRunId}-json`;
    const response = await request(app)
      .post('/api/v1/me')
      .set('x-request-id', requestId)
      .set('content-type', 'application/json')
      .send('{"broken"');

    const body = expectJsonBody(response, 400, PublicApiErrorSchema);
    expect(body).toEqual({
      code: 'validation_failed',
      message: 'Malformed JSON request body',
      request_id: requestId,
    });
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('returns the public ApiError contract for unknown v1 routes', async () => {
    const requestId = `${testRunId}-not-found`;
    const response = await request(app)
      .get('/api/v1/not-a-route')
      .set('x-request-id', requestId);

    const body = expectJsonBody(response, 404, PublicApiErrorSchema);
    expect(body).toEqual({
      code: 'not_found',
      message: 'Route not found',
      request_id: requestId,
    });

    const audit = await waitForAuditRow(requestId);
    expect(audit).toMatchObject({
      app_id: null,
      client_id: null,
      user_id: null,
      workspace_id: null,
      method: 'GET',
      route: '/api/v1/not-a-route',
      scope_used: null,
      status: 404,
      error_code: 'not_found',
    });
  });

  it('returns the public user/app context and records an audit row for valid tokens', async () => {
    const requestId = `${testRunId}-valid`;
    const response = await request(app)
      .get('/api/v1/me')
      .set('x-request-id', requestId)
      .set('Authorization', `Bearer ${validToken}`);

    const body = expectJsonBody(response, 200, PublicMeResponseSchema);
    expect(body.user).toEqual({
      id: userId,
      email: testEmail,
      name: 'Public API User',
    });
    expect(body.app.client_id).toBe(clientId);
    expect(body.workspace_id).toBe(workspaceId);
    expect(body.granted_scopes).toEqual(['documents:read']);

    const audit = await waitForAuditRow(requestId);
    expect(audit).toMatchObject({
      app_id: appId,
      client_id: clientId,
      user_id: userId,
      workspace_id: workspaceId,
      method: 'GET',
      route: '/api/v1/me',
      scope_used: null,
      status: 200,
      error_code: null,
    });
  });

  it('stores only the OAuth access-token hash', async () => {
    const result = await pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM oauth_access_tokens WHERE token_hash = $1',
      [hashOAuthAccessToken(validToken)]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.token_hash).not.toBe(validToken);
  });

  async function waitForAuditRow(requestId: string): Promise<{
    app_id: string | null;
    client_id: string | null;
    user_id: string | null;
    workspace_id: string | null;
    method: string;
    route: string;
    scope_used: string | null;
    status: number;
    error_code: string | null;
  }> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await pool.query<{
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
      if (result.rows[0]) return result.rows[0];
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    throw new Error(`Audit row not found for ${requestId}`);
  }
});
