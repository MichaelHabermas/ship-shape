import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { FeedbackProgramPublicSchema } from '../openapi/schemas/feedback.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';

describe('Public Feedback API', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testWorkspaceName = `Public Feedback Test ${testRunId}`;

  let testWorkspaceId: string;
  let enabledProgramId: string;
  let disabledProgramId: string;
  let privateProgramId: string;

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
  });

  afterAll(async () => {
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
    expect(createRes.body.program_id).toBe(enabledProgramId);
    expect(createRes.body.source).toBe('external');
    expect(createRes.body.program_prefix).toBe('EN');

    const assocResult = await pool.query(
      `SELECT id FROM document_associations
       WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'program'`,
      [createRes.body.id, enabledProgramId]
    );
    expect(assocResult.rows).toHaveLength(1);

    const disabledRes = await request(app)
      .post('/api/feedback')
      .send({ title: 'Blocked signal', program_id: disabledProgramId });

    expect(disabledRes.status).toBe(404);
    expect(disabledRes.body.error).toBe('Program not found');
  });

  it('rejects feedback for private programs', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ title: 'Blocked private signal', program_id: privateProgramId });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Program not found');
  });
});
