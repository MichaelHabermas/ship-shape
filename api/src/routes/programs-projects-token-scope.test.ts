import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { IdRow, requireFirstRow } from '../test/pg-result.js';

describe('Programs and projects API — API token scopes on writes', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36);
  const testEmail = `prog-proj-token-${testRunId}@ship.local`;

  let testWorkspaceId: string;
  let testUserId: string;
  let testProgramId: string;
  let testProjectId: string;
  let readOnlyToken: string;
  let writeToken: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Prog Proj Token ${testRunId}`]
    );
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = requireFirstRow(userResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, testUserId]
    );

    const programResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'program', 'Token Program', 'workspace', $2, '{"color":"#6366f1"}')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testProgramId = requireFirstRow(programResult.rows).id;

    const projectResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'project', 'Token Project', 'workspace', $2, '{}')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testProjectId = requireFirstRow(projectResult.rows).id;

    readOnlyToken = `ship_${crypto.randomBytes(32).toString('hex')}`;
    await pool.query(
      `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        testUserId,
        testWorkspaceId,
        `Read ${testRunId}`,
        crypto.createHash('sha256').update(readOnlyToken).digest('hex'),
        readOnlyToken.slice(0, 8),
        ['documents:read'],
      ]
    );

    writeToken = `ship_${crypto.randomBytes(32).toString('hex')}`;
    await pool.query(
      `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        testUserId,
        testWorkspaceId,
        `Write ${testRunId}`,
        crypto.createHash('sha256').update(writeToken).digest('hex'),
        writeToken.slice(0, 8),
        ['documents:write'],
      ]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM api_tokens WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  it('denies program PATCH for read-only API tokens', async () => {
    const res = await request(app)
      .patch(`/api/programs/${testProgramId}`)
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({ title: 'Renamed' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('token_scope_denied');
  });

  it('denies project PATCH for read-only API tokens', async () => {
    const res = await request(app)
      .patch(`/api/projects/${testProjectId}`)
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({ title: 'Renamed' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('token_scope_denied');
  });

  it('allows write-scoped tokens to patch program title', async () => {
    const res = await request(app)
      .patch(`/api/programs/${testProgramId}`)
      .set('Authorization', `Bearer ${writeToken}`)
      .send({ title: 'Updated Program' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Program');
  });

  it('allows write-scoped tokens to patch project title', async () => {
    const res = await request(app)
      .patch(`/api/projects/${testProjectId}`)
      .set('Authorization', `Bearer ${writeToken}`)
      .send({ title: 'Updated Project' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Project');
  });
});
