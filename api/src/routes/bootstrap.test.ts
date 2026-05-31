/** Bootstrap route tests — authenticated app-shell hydration payload shape. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import type { z } from 'zod';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { BootstrapResponseSchema } from '../openapi/schemas/bootstrap.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';

type BootstrapData = z.infer<typeof BootstrapResponseSchema>['data'];

describe('Bootstrap API', () => {
  const app = createApp('http://localhost:5173');
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `bootstrap-${testRunId}@ship.local`;
  const testWorkspaceName = `Bootstrap Test ${testRunId}`;

  let sessionCookie: string;
  let testWorkspaceId: string;
  let testUserId: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name, sprint_start_date)
       VALUES ($1, CURRENT_DATE)
       RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;

    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Bootstrap Test User')
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

    const projectResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'project', 'Bootstrap Active Project', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    const projectId = projectResult.rows[0].id;

    const sprintResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'wiki', 'Bootstrap Wiki', '{}', $2),
              ($1, 'issue', 'Bootstrap Issue', '{"state":"backlog","priority":"medium"}', $2),
              ($1, 'sprint', 'Bootstrap Sprint', $3, $2)
       RETURNING id, document_type`,
      [
        testWorkspaceId,
        testUserId,
        JSON.stringify({
          sprint_number: 1,
          assignee_ids: [testUserId],
        }),
      ]
    );

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'project')`,
      [sprintResult.rows[2].id, projectId]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  it('GET /api/bootstrap requires auth', async () => {
    const res = await request(app).get('/api/bootstrap');

    expect(res.status).toBe(401);
  });

  it('GET /api/bootstrap returns app-shell data without drifting project status', async () => {
    const res = await request(app)
      .get('/api/bootstrap')
      .set('Cookie', sessionCookie);

    const bootstrap = expectOpenApiResponse({
      method: 'get',
      path: '/bootstrap',
      status: 200,
      response: res,
      openApiSchemaName: 'BootstrapResponse',
      schema: BootstrapResponseSchema,
    });

    const data: BootstrapData = bootstrap.data;
    expect(data.user.email).toBe(testEmail);
    expect(data.currentWorkspace.id).toBe(testWorkspaceId);
    expect(data.documents.some((doc) => doc.title === 'Bootstrap Wiki')).toBe(true);
    expect(data.documents.find((doc) => doc.title === 'Bootstrap Wiki')?.properties).toEqual(null);
    expect(data.issues.some((issue) => issue.title === 'Bootstrap Issue')).toBe(true);
    expect(data.issues.find((issue) => issue.title === 'Bootstrap Issue')).not.toHaveProperty('content');
    expect(data.actionItems).toMatchObject({ items: expect.any(Array), total: expect.any(Number) });

    // Risk: bootstrap seeds the project list cache, so it must match /api/projects status inference.
    const project = data.projects.find((item) => item.title === 'Bootstrap Active Project');
    expect(project).toBeDefined();
    if (!project) {
      throw new Error('Expected Bootstrap Active Project in bootstrap payload');
    }
    expect(project.inferred_status).toBe('active');
    expect(project).not.toHaveProperty('plan');
    expect(project).not.toHaveProperty('plan_approval');
    expect(project).not.toHaveProperty('retro_approval');
    expect(project).not.toHaveProperty('design_review_notes');
  });
});
