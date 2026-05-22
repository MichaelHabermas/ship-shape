import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { z } from 'zod';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { IdRow, requireFirstRow } from '../test/pg-result.js';
import {
  ProjectIssueListItemSchema,
  ProjectWeekListItemSchema,
} from '../openapi/schemas/projects.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';

const ProjectIssueListSchema = z.array(ProjectIssueListItemSchema);
const ProjectWeekListSchema = z.array(ProjectWeekListItemSchema);

describe('Projects API contract', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `projects-contract-${testRunId}@ship.local`;
  const testWorkspaceName = `Projects Contract ${testRunId}`;

  let sessionCookie: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testProgramId: string;
  let testProjectId: string;
  let testIssueId: string;
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
       VALUES ($1, 'test-hash', 'Projects Contract User')
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
       VALUES ($1, 'program', 'Contract Program', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testProgramId = requireFirstRow(programResult.rows).id;

    const projectResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, parent_id)
       VALUES ($1, 'project', 'Contract Project', 'workspace', $2, $3)
       RETURNING id`,
      [testWorkspaceId, testUserId, testProgramId]
    );
    testProjectId = requireFirstRow(projectResult.rows).id;

    const issueResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
       VALUES ($1, 'issue', 'Contract Issue', 'workspace', $2, $3, 9001)
       RETURNING id`,
      [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
    );
    testIssueId = requireFirstRow(issueResult.rows).id;

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'project')`,
      [testIssueId, testProjectId]
    );

    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'sprint', 'Contract Sprint', 'workspace', $2, $3)
       RETURNING id`,
      [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 1, status: 'planning' })]
    );
    testSprintId = requireFirstRow(sprintResult.rows).id;

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program'), ($1, $3, 'project')`,
      [testSprintId, testProgramId, testProjectId]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  it('GET /api/projects/:id/issues matches OpenAPI ProjectIssueListItem[]', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/issues`)
      .set('Cookie', sessionCookie);

    const issues = expectOpenApiResponse({
      method: 'get',
      path: '/projects/{id}/issues',
      status: 200,
      response: res,
      openApiSchemaName: 'ProjectIssueListItem',
      arrayItemSchemaName: 'ProjectIssueListItem',
      schema: ProjectIssueListSchema,
    });

    expect(issues.some((issue) => issue.id === testIssueId)).toBe(true);
  });

  it('GET /api/projects/:id/weeks matches OpenAPI ProjectWeekListItem[]', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/weeks`)
      .set('Cookie', sessionCookie);

    const weeks = expectOpenApiResponse({
      method: 'get',
      path: '/projects/{id}/weeks',
      status: 200,
      response: res,
      openApiSchemaName: 'ProjectWeekListItem',
      arrayItemSchemaName: 'ProjectWeekListItem',
      schema: ProjectWeekListSchema,
    });

    expect(weeks.some((week) => week.id === testSprintId)).toBe(true);
  });
});
