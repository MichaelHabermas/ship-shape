// Public API middleware tests cover scope denial outside route-specific behavior.
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PublicApiErrorSchema } from '@ship/shared';
import { pool } from '../../../db/client.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';
import { createOAuthAccessToken } from '../../oauth/tokens.js';
import { publicApiAuditMiddleware, requirePublicApiBearer } from './middleware.js';

describe('public API middleware', () => {
  const app = express();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `public-middleware-${testRunId}@ship.local`;
  const clientId = `ship_app_middleware_${testRunId}`;

  let workspaceId: string;
  let userId: string;
  let appId: string;
  let readOnlyToken: string;

  beforeAll(async () => {
    app.use('/api/v1', publicApiAuditMiddleware);
    app.get('/api/v1/needs-write', requirePublicApiBearer(['documents:write']), (_req, res) => {
      res.json({ ok: true });
    });

    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Public Middleware ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Public Middleware User')
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
       VALUES ($1, $2, 'Middleware Test App', $3, 'test-secret-hash', $4, $5)
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

    readOnlyToken = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2 OR request_id LIKE $3', [
      workspaceId,
      clientId,
      `${testRunId}-%`,
    ]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('returns forbidden and audits when the token lacks the required scope', async () => {
    const requestId = `${testRunId}-missing-scope`;
    const response = await request(app)
      .get('/api/v1/needs-write')
      .set('x-request-id', requestId)
      .set('Authorization', `Bearer ${readOnlyToken}`);

    const body = PublicApiErrorSchema.parse(response.body);
    expect(response.status).toBe(403);
    expect(body).toEqual({
      code: 'forbidden',
      message: 'Missing required scope: documents:write',
      details: { missing_scope: 'documents:write', required_scopes: ['documents:write'] },
      request_id: requestId,
    });

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

    expect(requireFirstRow(audit.rows)).toMatchObject({
      app_id: appId,
      client_id: clientId,
      user_id: userId,
      workspace_id: workspaceId,
      method: 'GET',
      route: '/api/v1/needs-write',
      scope_used: 'documents:write',
      status: 403,
      error_code: 'forbidden',
    });
  });
});
