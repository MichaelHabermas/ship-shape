// API tests: governance fields blocked on generic PATCH; allowed via set_governance command.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { z } from 'zod';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { ErrorResponseSchema } from '../openapi/schemas/common.js';
import { expectJsonBody } from '../test/expect-json-body.js';
import { IdRow, requireFirstRow } from '../test/pg-result.js';
import { getCsrfTokenFromApp } from '../test/session-csrf.js';

const CommandOkSchema = z.record(z.unknown());

describe('Documents API — governance field mass assignment', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36);
  let workspaceId: string;
  let userId: string;
  let sprintId: string;
  let sessionCookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Gov Patch ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Member')
       RETURNING id`,
      [`gov-patch-${testRunId}@ship.local`]
    );
    userId = requireFirstRow(userResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [workspaceId, userId]
    );

    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
       VALUES ($1, 'sprint', 'Gov Sprint', 'workspace', $2)
       RETURNING id`,
      [workspaceId, userId]
    );
    sprintId = requireFirstRow(sprintResult.rows).id;

    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
       VALUES ($1, $2, $3, now() + interval '1 hour', now())`,
      [sessionId, userId, workspaceId]
    );
    sessionCookie = `session_id=${sessionId}`;

    const csrf = await getCsrfTokenFromApp(app, sessionCookie);
    csrfToken = csrf.token;
    sessionCookie = csrf.sessionCookie;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('rejects member PATCH that injects review_approval and submitted_at', async () => {
    const res = await request(app)
      .patch(`/api/documents/${sprintId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', 'http://localhost:5173')
      .send({
        properties: {
          review_approval: { state: 'approved' },
          submitted_at: new Date().toISOString(),
        },
      });

    const error = expectJsonBody(res, 403, ErrorResponseSchema);
    expect(error.error).toMatch(/governance fields/i);
  });

  it('rejects workspace admin PATCH that injects plan_approval', async () => {
    await pool.query(
      `UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );

    const res = await request(app)
      .patch(`/api/documents/${sprintId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', 'http://localhost:5173')
      .send({
        properties: {
          plan_approval: {
            state: 'approved',
            approved_by: userId,
            approved_at: new Date().toISOString(),
          },
        },
      });

    const error = expectJsonBody(res, 403, ErrorResponseSchema);
    expect(error.error).toMatch(/governance fields/i);
  });

  it('allows workspace admin set_governance command while blocking generic PATCH', async () => {
    await pool.query(
      `UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );

    const res = await request(app)
      .post(`/api/documents/${sprintId}/commands`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .set('Origin', 'http://localhost:5173')
      .send({
        type: 'set_governance',
        properties: { public_feedback_enabled: true },
      });

    expectJsonBody(res, 200, CommandOkSchema);
  });
});
