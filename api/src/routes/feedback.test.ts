import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import {
  FeedbackItemSchema,
  FeedbackLegacyErrorSchema,
  FeedbackProgramPublicSchema,
} from '../openapi/schemas/feedback.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';

describe('Public Feedback API', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testWorkspaceName = `Public Feedback Test ${testRunId}`;

  let testWorkspaceId: string;
  let enabledProgramId: string;
  let disabledProgramId: string;
  let privateProgramId: string;
  let testUserId: string;
  let sessionCookie: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;

    const enabledProgramResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'program', 'Enabled Program', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, JSON.stringify({ prefix: 'EN', public_feedback_enabled: true })]
    );
    enabledProgramId = enabledProgramResult.rows[0].id;

    const disabledProgramResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'program', 'Disabled Program', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, JSON.stringify({ prefix: 'DIS', public_feedback_enabled: false })]
    );
    disabledProgramId = disabledProgramResult.rows[0].id;

    const privateProgramResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'program', 'Private Program', 'private', $2)
       RETURNING id`,
      [testWorkspaceId, JSON.stringify({ prefix: 'PRI', public_feedback_enabled: true })]
    );
    privateProgramId = privateProgramResult.rows[0].id;

    const testEmail = `feedback-protected-${testRunId}@ship.local`;
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Feedback Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    );

    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    );
    sessionCookie = `session_id=${sessionId}`;

    const csrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie);
    const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
    if (connectSidCookie) {
      sessionCookie = `${sessionCookie}; ${connectSidCookie}`;
    }
  });

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query(
      `DELETE FROM document_associations
       WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)
          OR related_id IN (SELECT id FROM documents WHERE workspace_id = $1)`,
      [testWorkspaceId]
    );
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  it('returns public program info only when feedback is enabled', async () => {
    const enabledRes = await request(app).get(`/api/feedback/program/${enabledProgramId}`);

    const program = expectOpenApiResponse({
      method: 'get',
      path: '/feedback/program/{programId}',
      status: 200,
      response: enabledRes,
      openApiSchemaName: 'FeedbackProgramPublic',
      schema: FeedbackProgramPublicSchema,
    });
    expect(program.name).toBe('Enabled Program');
    expect(program.prefix).toBe('EN');

    const disabledRes = await request(app).get(`/api/feedback/program/${disabledProgramId}`);
    expect(disabledRes.status).toBe(404);
    expect(disabledRes.body.error).toBe('Program not found');
  });

  it('does not expose private programs even when public feedback is enabled', async () => {
    const res = await request(app).get(`/api/feedback/program/${privateProgramId}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Program not found');
  });

  it('creates external feedback only for enabled workspace-visible programs', async () => {
    const createRes = await request(app)
      .post('/api/feedback')
      .send({
        title: 'External signal',
        program_id: enabledProgramId,
        submitter_email: 'submitter@example.com',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      });

    expect(createRes.status).toBe(201);
    const feedback = expectOpenApiResponse({
      method: 'post',
      path: '/feedback',
      status: 201,
      response: createRes,
      openApiSchemaName: 'FeedbackItem',
      schema: FeedbackItemSchema,
    });
    expect(feedback.program_id).toBe(enabledProgramId);
    expect(feedback.source).toBe('external');
    expect(feedback.program_prefix).toBe('EN');

    const assocResult = await pool.query(
      `SELECT id FROM document_associations
       WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'program'`,
      [feedback.id, enabledProgramId]
    );
    expect(assocResult.rows).toHaveLength(1);

    const disabledRes = await request(app)
      .post('/api/feedback')
      .send({ title: 'Blocked signal', program_id: disabledProgramId });

    expect(disabledRes.status).toBe(404);
    expect(disabledRes.body.error).toBe('Program not found');
  });

  it('preserves legacy validation response shape for invalid public feedback', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ title: '', program_id: enabledProgramId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
    expect(res.body.details).toEqual(expect.any(Array));
  });

  it('returns legacy not-found shape for invalid public program IDs', async () => {
    const res = await request(app).get('/api/feedback/program/not-a-uuid');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Program not found');
  });

  it('rejects feedback for private programs', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ title: 'Blocked private signal', program_id: privateProgramId });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Program not found');
  });

  describe('GET /api/feedback/:id (protected)', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/feedback/00000000-0000-0000-0000-000000000001');

      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent id', async () => {
      const res = await request(app)
        .get('/api/feedback/00000000-0000-0000-0000-000000000000')
        .set('Cookie', sessionCookie);

      const error = expectOpenApiResponse({
        method: 'get',
        path: '/feedback/{id}',
        status: 404,
        response: res,
        openApiSchemaName: 'FeedbackLegacyError',
        schema: FeedbackLegacyErrorSchema,
      });
      expect(error.error).toBe('Feedback not found');
    });

    it('returns 200 with valid feedback when authenticated', async () => {
      const createRes = await request(app)
        .post('/api/feedback')
        .send({
          title: 'Protected read signal',
          program_id: enabledProgramId,
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
        });

      expect(createRes.status).toBe(201);
      const feedbackId = createRes.body.id;

      const res = await request(app)
        .get(`/api/feedback/${feedbackId}`)
        .set('Cookie', sessionCookie);

      const feedback = expectOpenApiResponse({
        method: 'get',
        path: '/feedback/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'FeedbackItem',
        schema: FeedbackItemSchema,
      });
      expect(feedback.id).toBe(feedbackId);
      expect(feedback.title).toBe('Protected read signal');
      expect(feedback.program_id).toBe(enabledProgramId);
      expect(feedback.source).toBe('external');
    });
  });
});
