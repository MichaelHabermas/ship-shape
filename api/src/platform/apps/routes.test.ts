// OAuth app registration tests exercise session auth, CSRF, admin checks, and shown-once secrets.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { createApp } from '../../app.js';
import { pool } from '../../db/client.js';
import { expectJsonBody } from '../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';

const OAuthAppCreatedSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    client_id: z.string().startsWith('ship_app_'),
    client_secret: z.string().startsWith('ship_secret_'),
    redirect_uris: z.array(z.string()),
    requested_scopes: z.array(z.string()),
    created_at: z.string().or(z.date()),
    warning: z.string(),
  }),
});

const InternalErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

describe('OAuth app registration', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const adminEmail = `oauth-admin-${testRunId}@ship.local`;
  const memberEmail = `oauth-member-${testRunId}@ship.local`;

  let workspaceId: string;
  let adminUserId: string;
  let memberUserId: string;
  let adminSessionId: string;
  let memberSessionId: string;
  let adminApiToken: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`OAuth Apps ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const adminResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'OAuth Admin')
       RETURNING id`,
      [adminEmail]
    );
    adminUserId = requireFirstRow(adminResult.rows).id;

    const memberResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'OAuth Member')
       RETURNING id`,
      [memberEmail]
    );
    memberUserId = requireFirstRow(memberResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, adminUserId, memberUserId]
    );

    adminSessionId = crypto.randomBytes(32).toString('hex');
    memberSessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, NOW() + interval '1 hour'),
              ($4, $5, $3, NOW() + interval '1 hour')`,
      [adminSessionId, adminUserId, workspaceId, memberSessionId, memberUserId]
    );

    adminApiToken = `ship_${crypto.randomBytes(32).toString('hex')}`;
    await pool.query(
      `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        adminUserId,
        workspaceId,
        `OAuth app creation ${testRunId}`,
        crypto.createHash('sha256').update(adminApiToken).digest('hex'),
        adminApiToken.slice(0, 12),
        ['documents:read'],
      ]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM audit_logs WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM api_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM sessions WHERE id = ANY($1)', [[adminSessionId, memberSessionId]]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[adminUserId, memberUserId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('lets a workspace admin create an OAuth app with a shown-once secret', async () => {
    const csrf = await getCsrfCookie();
    const response = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Docs Demo App',
        redirect_uris: ['https://example.test/callback'],
        requested_scopes: ['documents:read'],
      });

    const body = expectJsonBody(response, 201, OAuthAppCreatedSchema);
    const appResult = await pool.query<{
      client_id: string;
      client_secret_hash: string;
      requested_scopes: string[];
    }>(
      'SELECT client_id, client_secret_hash, requested_scopes FROM oauth_apps WHERE id = $1',
      [body.data.id]
    );
    const row = requireFirstRow(appResult.rows);

    expect(row.client_id).toBe(body.data.client_id);
    expect(row.client_secret_hash).not.toBe(body.data.client_secret);
    expect(JSON.stringify(row)).not.toContain(body.data.client_secret);
    await expect(argon2.verify(row.client_secret_hash, body.data.client_secret)).resolves.toBe(true);
    expect(row.requested_scopes).toEqual(['documents:read']);

    const auditResult = await pool.query<{ details: Record<string, unknown> | null }>(
      `SELECT details
       FROM audit_logs
       WHERE action = 'oauth_app.created'
         AND resource_type = 'oauth_app'
         AND resource_id = $1`,
      [body.data.id]
    );
    const auditDetails = requireFirstRow(auditResult.rows).details;
    expect(JSON.stringify(auditDetails)).not.toContain(body.data.client_secret);
  });

  it('allows HTTP localhost redirect URIs for local development', async () => {
    const csrf = await getCsrfCookie();
    const response = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Localhost App',
        redirect_uris: ['http://localhost:5173/callback'],
        requested_scopes: ['documents:read'],
      });

    const body = expectJsonBody(response, 201, OAuthAppCreatedSchema);
    expect(body.data.redirect_uris).toEqual(['http://localhost:5173/callback']);
  });

  it('rejects invalid requested scopes and redirect URIs', async () => {
    const csrf = await getCsrfCookie();
    const invalidScopeResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Bad Scope App',
        redirect_uris: ['https://example.test/callback'],
        requested_scopes: ['me:read'],
      });

    const invalidScope = expectJsonBody(invalidScopeResponse, 400, InternalErrorSchema);
    expect(invalidScope.error.code).toBe('VALIDATION_ERROR');

    const invalidUriResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Bad URI App',
        redirect_uris: ['not-a-url'],
        requested_scopes: ['documents:read'],
      });

    const invalidUri = expectJsonBody(invalidUriResponse, 400, InternalErrorSchema);
    expect(invalidUri.error.code).toBe('VALIDATION_ERROR');

    const unsafeSchemeResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Unsafe Scheme App',
        redirect_uris: ['javascript:alert(1)'],
        requested_scopes: ['documents:read'],
      });

    const unsafeScheme = expectJsonBody(unsafeSchemeResponse, 400, InternalErrorSchema);
    expect(unsafeScheme.error.code).toBe('VALIDATION_ERROR');

    const fragmentResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Fragment App',
        redirect_uris: ['https://example.test/callback#frag'],
        requested_scopes: ['documents:read'],
      });

    const fragment = expectJsonBody(fragmentResponse, 400, InternalErrorSchema);
    expect(fragment.error.code).toBe('VALIDATION_ERROR');

    const publicHttpResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Public HTTP App',
        redirect_uris: ['http://example.test/callback'],
        requested_scopes: ['documents:read'],
      });

    const publicHttp = expectJsonBody(publicHttpResponse, 400, InternalErrorSchema);
    expect(publicHttp.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not let legacy API tokens create OAuth apps', async () => {
    const response = await request(app)
      .post('/api/platform/apps')
      .set('Authorization', `Bearer ${adminApiToken}`)
      .send({
        name: 'API Token App',
        redirect_uris: ['https://example.test/callback'],
        requested_scopes: ['documents:read'],
      });

    const body = expectJsonBody(response, 403, InternalErrorSchema);
    expect(body.error.message).toBe('Session authentication required to create OAuth apps');
  });

  it('forbids non-admin workspace members from creating apps', async () => {
    const csrf = await getCsrfCookie();
    const response = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${memberSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Member App',
        redirect_uris: ['https://example.test/callback'],
        requested_scopes: ['documents:read'],
      });

    const body = expectJsonBody(response, 403, InternalErrorSchema);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  async function getCsrfCookie(): Promise<{ token: string; cookie: string }> {
    const response = await request(app).get('/api/csrf-token');
    const token = z.object({ token: z.string() }).parse(response.body).token;
    const cookie = response.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    return { token, cookie };
  }
});
