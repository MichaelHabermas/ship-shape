import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { z } from 'zod';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { IdRow, requireFirstRow } from '../test/pg-result.js';
import { ProgramSprintsResponseSchema } from '../openapi/schemas/programs.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';

describe('Programs API contract', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `programs-contract-${testRunId}@ship.local`;
  const testWorkspaceName = `Programs Contract ${testRunId}`;

  let sessionCookie: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testProgramId: string;
  let testSprintId: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name, sprint_start_date)
       VALUES ($1, CURRENT_DATE)
       RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Programs Contract User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = requireFirstRow(userResult.rows).id;

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

    const programResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
       VALUES ($1, 'program', 'Contract Test Program', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testProgramId = requireFirstRow(programResult.rows).id;

    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'sprint', 'Contract Test Sprint', 'workspace', $2, $3)
       RETURNING id`,
      [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 1, status: 'planning' })]
    );
    testSprintId = requireFirstRow(sprintResult.rows).id;

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [testSprintId, testProgramId]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  it('GET /api/programs/:id/sprints matches OpenAPI ProgramSprintsResponse', async () => {
    const res = await request(app)
      .get(`/api/programs/${testProgramId}/sprints`)
      .set('Cookie', sessionCookie);

    const body = expectOpenApiResponse({
      method: 'get',
      path: '/programs/{id}/sprints',
      status: 200,
      response: res,
      openApiSchemaName: 'ProgramSprintsResponse',
      schema: ProgramSprintsResponseSchema,
    });

    expect(body.workspace_sprint_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.weeks.some((week) => week.id === testSprintId)).toBe(true);
  });
});
