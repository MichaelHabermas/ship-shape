import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { requireFirstRow, type IdRow } from '../test/pg-result.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';
import { expectJsonBody } from '../test/expect-json-body.js';
import { getCsrfTokenFromApp } from '../test/session-csrf.js';
import { z } from 'zod';

const AiStatusSchema = z.union([
  z.object({ available: z.literal(true) }),
  z.object({ available: z.literal(false), error: z.literal('ai_unavailable') }),
]);
const CsrfRejectedSchema = z.object({ error: z.literal('Cross-site request rejected') });

describe('AI route validation security', () => {
  const app = createApp();
  const runId = Date.now().toString(36);
  let workspaceId: string;
  let userId: string;
  let cookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    const workspace = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`ai-security-${runId}`]
    );
    workspaceId = requireFirstRow(workspace.rows).id;

    const user = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'AI Security User') RETURNING id`,
      [`ai-security-${runId}@ship.local`]
    );
    userId = requireFirstRow(user.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [workspaceId, userId]
    );

    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, user_agent, ip_address)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), $4, $5)`,
      [sessionId, userId, workspaceId, 'ai-security-agent', '::ffff:127.0.0.1']
    );
    cookie = `session_id=${sessionId}`;

    const csrf = await getCsrfTokenFromApp(app, cookie);
    csrfToken = csrf.token;
    cookie = csrf.sessionCookie;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('reports AI availability with the documented shape', async () => {
    const response = await request(app)
      .get('/api/ai/status')
      .set('Cookie', cookie)
      .set('User-Agent', 'ai-security-agent');

    const status = expectOpenApiResponse({
      method: 'get',
      path: '/ai/status',
      status: 200,
      response,
      openApiSchemaName: 'AiStatus',
      schema: AiStatusSchema,
    });
    expect(typeof status.available).toBe('boolean');
  });

  it('rejects malformed analyze-plan bodies before analysis', async () => {
    for (const body of [{}, { content: 123 }, { content: '' }, { content: 'x'.repeat(50_001) }]) {
      const response = await request(app)
        .post('/api/ai/analyze-plan')
        .set('Cookie', cookie)
        .set('User-Agent', 'ai-security-agent')
        .set('x-csrf-token', csrfToken)
        .send(body);

      expect(response.status).toBe(400);
    }
  });

  it('rejects malformed analyze-retro bodies before analysis', async () => {
    for (const body of [{}, { retro_content: 123, plan_content: 'plan' }, { retro_content: 'retro', plan_content: '' }]) {
      const response = await request(app)
        .post('/api/ai/analyze-retro')
        .set('Cookie', cookie)
        .set('User-Agent', 'ai-security-agent')
        .set('x-csrf-token', csrfToken)
        .send(body);

      expect(response.status).toBe(400);
    }
  });

  it('accepts valid string AI analysis bodies', async () => {
    const response = await request(app)
      .post('/api/ai/analyze-plan')
      .set('Cookie', cookie)
      .set('User-Agent', 'ai-security-agent')
      .set('x-csrf-token', csrfToken)
      .send({ content: 'Ship one measurable thing.' });

    const body = expectJsonBody(response, 200, z.record(z.unknown()));
    expect(body).not.toHaveProperty('details');
  });

  it('rejects cross-site cookie-auth mutations even with a CSRF token', async () => {
    const response = await request(app)
      .post('/api/ai/analyze-plan')
      .set('Cookie', cookie)
      .set('User-Agent', 'ai-security-agent')
      .set('Origin', 'https://evil.example')
      .set('x-csrf-token', csrfToken)
      .send({ content: 'Ship one measurable thing.' });

    const error = expectJsonBody(response, 403, CsrfRejectedSchema);
    expect(error).toEqual({ error: 'Cross-site request rejected' });
  });
});
