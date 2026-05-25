import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { IdRow, requireFirstRow } from '../test/pg-result.js';

describe('Documents API — API token scopes at mutation entry', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `docs-token-${testRunId}@ship.local`;

  let testWorkspaceId: string;
  let testUserId: string;
  let testWikiId: string;
  let readOnlyToken: string;
  let writeToken: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Docs Token Scope ${testRunId}`]
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

    const wikiResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, content)
       VALUES ($1, 'wiki', 'Token Scope Wiki', 'workspace', $2, '{"type":"doc","content":[]}')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testWikiId = requireFirstRow(wikiResult.rows).id;

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

  it('denies PATCH content for read-only API tokens', async () => {
    const res = await request(app)
      .patch(`/api/documents/${testWikiId}/content`)
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({ content: { type: 'doc', content: [] } });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('token_scope_denied');
  });

  it('denies governance commands for write-only API tokens', async () => {
    const res = await request(app)
      .post(`/api/documents/${testWikiId}/commands`)
      .set('Authorization', `Bearer ${writeToken}`)
      .send({ type: 'set_governance', properties: { accountable_id: testUserId } });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('token_scope_denied');
  });

  it('allows write-scoped tokens to patch content', async () => {
    const res = await request(app)
      .patch(`/api/documents/${testWikiId}/content`)
      .set('Authorization', `Bearer ${writeToken}`)
      .send({ content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'scoped' }] }] } });

    expect(res.status).toBe(200);
  });
});
