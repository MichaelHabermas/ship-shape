import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { CsrfTokenResponseSchema, LoginResponseSchema, SessionResponseSchema } from '../openapi/schemas/auth.js';
import { SetupStatusResponseSchema } from '../openapi/schemas/setup.js';
import { WorkspaceListResponseSchema } from '../openapi/schemas/workspaces.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';

type IdRow = {
  id: string;
};

describe('OpenAPI runtime response contracts', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `openapi-contract-${testRunId}@ship.local`;
  const testWorkspaceName = `OpenAPI Contract ${testRunId}`;

  let testWorkspaceId: string | undefined;
  let testUserId: string | undefined;
  let sessionId: string | undefined;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;

    const passwordHash = await bcrypt.hash('contract-password', 10);
    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, 'OpenAPI Contract User')
       RETURNING id`,
      [testEmail, passwordHash]
    );
    testUserId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    );

    sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    );
  });

  afterAll(async () => {
    if (sessionId) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    }
    if (testWorkspaceId && testUserId) {
      await pool.query(
        'DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [testWorkspaceId, testUserId]
      );
    }
    if (testUserId) {
      await pool.query('DELETE FROM users WHERE id = $1 AND email = $2', [testUserId, testEmail]);
    }
    if (testWorkspaceId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1 AND name = $2', [
        testWorkspaceId,
        testWorkspaceName,
      ]);
    }
  });

  it('validates GET /auth/session against the OpenAPI response schema', async () => {
    if (!sessionId) {
      throw new Error('Test setup did not create a session');
    }

    const response = await request(app)
      .get('/api/auth/session')
      .set('Cookie', `session_id=${sessionId}`);

    const session = expectOpenApiResponse({
      method: 'get',
      path: '/auth/session',
      status: 200,
      response,
      openApiSchemaName: 'SessionResponse',
      schema: SessionResponseSchema,
    });

    expect(session.data.expiresAt).toBeDefined();
  });

  it('validates POST /auth/login against the OpenAPI response schema', async () => {
    const csrfResponse = await request(app).get('/api/csrf-token');
    const csrf = expectOpenApiResponse({
      method: 'get',
      path: '/csrf-token',
      status: 200,
      response: csrfResponse,
      openApiSchemaName: 'CsrfTokenResponse',
      schema: CsrfTokenResponseSchema,
    });
    const csrfCookie = csrfResponse.headers['set-cookie']?.[0]?.split(';')[0] ?? '';

    const response = await request(app)
      .post('/api/auth/login')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrf.token)
      .send({ email: testEmail, password: 'contract-password' });

    const login = expectOpenApiResponse({
      method: 'post',
      path: '/auth/login',
      status: 200,
      response,
      openApiSchemaName: 'LoginResponse',
      schema: LoginResponseSchema,
    });

    expect(login.data.user.email).toBe(testEmail);
    expect(login.data.currentWorkspace?.id).toBe(testWorkspaceId);
  });

  it('validates GET /setup/status against the OpenAPI response schema', async () => {
    const response = await request(app).get('/api/setup/status');
    const status = expectOpenApiResponse({
      method: 'get',
      path: '/setup/status',
      status: 200,
      response,
      openApiSchemaName: 'SetupStatusResponse',
      schema: SetupStatusResponseSchema,
    });
    expect(typeof status.data.needsSetup).toBe('boolean');
  });

  it('validates GET /workspaces against the OpenAPI response schema', async () => {
    if (!sessionId) {
      throw new Error('Test setup did not create a session');
    }

    const response = await request(app)
      .get('/api/workspaces')
      .set('Cookie', `session_id=${sessionId}`);

    const workspaces = expectOpenApiResponse({
      method: 'get',
      path: '/workspaces',
      status: 200,
      response,
      openApiSchemaName: 'WorkspaceListResponse',
      schema: WorkspaceListResponseSchema,
    });

    expect(workspaces.data.workspaces.some((workspace) => workspace.id === testWorkspaceId)).toBe(true);
  });
});
