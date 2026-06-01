import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { requireFirstRow, type IdRow } from '../test/pg-result.js';
import { AssociationSchema, DocumentContextResponseSchema } from '../openapi/schemas/backlinks.js';
import { BootstrapResponseSchema } from '../openapi/schemas/bootstrap.js';
import { IncompleteChildrenWarningSchema } from '../openapi/schemas/issues.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';
import { expectJsonBody } from '../test/expect-json-body.js';
import { getCsrfTokenFromApp } from '../test/session-csrf.js';
import { z } from 'zod';

const AssociationListSchema = z.array(AssociationSchema);
const TeamProjectOptionSchema = z.object({
  id: z.string().uuid(),
  programId: z.string().uuid().nullable(),
}).passthrough();
const TeamProjectListSchema = z.array(TeamProjectOptionSchema);
const TeamJsonPayloadSchema = z.record(z.unknown());
const IncompleteChildrenWarningTestSchema = IncompleteChildrenWarningSchema.extend({
  incomplete_children: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      ticket_number: z.number().int().nullable(),
      state: z.string(),
    })
  ),
});

describe('security graph visibility regressions', () => {
  const app = createApp();
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let workspaceId: string;
  let memberId: string;
  let otherUserId: string;
  let memberPersonId: string;
  let memberCookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    const workspace = await pool.query<IdRow>(
      `INSERT INTO workspaces (name, sprint_start_date) VALUES ($1, CURRENT_DATE) RETURNING id`,
      [`Security Graph ${runId}`]
    );
    workspaceId = requireFirstRow(workspace.rows).id;

    const member = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Graph Member') RETURNING id`,
      [`graph-member-${runId}@ship.local`]
    );
    memberId = requireFirstRow(member.rows).id;

    const other = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Graph Other') RETURNING id`,
      [`graph-other-${runId}@ship.local`]
    );
    otherUserId = requireFirstRow(other.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
      [workspaceId, memberId, otherUserId]
    );

    const person = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'person', 'Graph Member Person', 'workspace', $2, $3)
       RETURNING id`,
      [workspaceId, memberId, JSON.stringify({ user_id: memberId, email: `graph-member-${runId}@ship.local` })]
    );
    memberPersonId = requireFirstRow(person.rows).id;

    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, memberId, workspaceId]
    );
    memberCookie = `session_id=${sessionId}`;

    const csrf = await getCsrfTokenFromApp(app, memberCookie);
    csrfToken = csrf.token;
    memberCookie = csrf.sessionCookie;
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM document_associations
       WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)
          OR related_id IN (SELECT id FROM documents WHERE workspace_id = $1)`,
      [workspaceId]
    );
    await pool.query('DELETE FROM document_links WHERE source_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [workspaceId]);
    await pool.query('DELETE FROM sessions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [memberId, otherUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('does not echo association metadata and omits hidden related documents', async () => {
    const source = await insertDoc('wiki', 'Visible Source', memberId, 'workspace');
    const visibleProgram = await insertDoc('program', 'Visible Program', memberId, 'workspace');
    const privateProgram = await insertDoc('program', 'Secret Program', otherUserId, 'private');

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
       VALUES ($1, $2, 'program', $3), ($1, $4, 'program', $5)`,
      [
        source,
        visibleProgram,
        JSON.stringify({ secret: 'visible-internal' }),
        privateProgram,
        JSON.stringify({ secret: 'private-internal' }),
      ]
    );

    const response = await request(app)
      .get(`/api/documents/${source}/associations`)
      .set('Cookie', memberCookie);

    const associations = expectOpenApiResponse({
      method: 'get',
      path: '/documents/{id}/associations',
      status: 200,
      response,
      openApiSchemaName: 'Association',
      arrayItemSchemaName: 'Association',
      schema: AssociationListSchema,
    });
    expect(associations).toHaveLength(1);
    expect(associations[0].related_id).toBe(visibleProgram);
    expect(JSON.stringify(associations)).not.toContain(privateProgram);
    expect(JSON.stringify(associations)).not.toContain('internal');
    expect(associations[0]).not.toHaveProperty('metadata');
  });

  it('omits hidden program ids from document context breadcrumbs', async () => {
    const issue = await insertDoc('issue', 'Visible Issue', memberId, 'workspace');
    const privateProgram = await insertDoc('program', 'Hidden Breadcrumb Program', otherUserId, 'private');
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [issue, privateProgram]
    );

    const response = await request(app)
      .get(`/api/documents/${issue}/context`)
      .set('Cookie', memberCookie);

    const context = expectOpenApiResponse({
      method: 'get',
      path: '/documents/{id}/context',
      status: 200,
      response,
      openApiSchemaName: 'DocumentContextResponse',
      schema: DocumentContextResponseSchema,
    });
    expect(JSON.stringify(context)).not.toContain(privateProgram);
    expect(JSON.stringify(context)).not.toContain('Hidden Breadcrumb Program');
  });

  it('counts only visible associated documents in bootstrap aggregates', async () => {
    const program = await insertDoc('program', 'Counted Program', memberId, 'workspace');
    const visibleIssue = await insertDoc('issue', 'Visible Count Issue', memberId, 'workspace');
    const privateIssue = await insertDoc('issue', 'Hidden Count Issue', otherUserId, 'private');
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $3, 'program'), ($2, $3, 'program')`,
      [visibleIssue, privateIssue, program]
    );

    const response = await request(app).get('/api/bootstrap').set('Cookie', memberCookie);
    const bootstrap = expectOpenApiResponse({
      method: 'get',
      path: '/bootstrap',
      status: 200,
      response,
      openApiSchemaName: 'BootstrapResponse',
      schema: BootstrapResponseSchema,
    });
    const found = bootstrap.data.programs.find((item) => item.id === program);
    expect(Number(found.issue_count)).toBe(1);
    expect(JSON.stringify(found)).not.toContain('Hidden Count Issue');
  });

  it('does not reveal hidden program ids from visible bootstrap projects', async () => {
    const privateProgram = await insertDoc('program', 'Hidden Bootstrap Program', otherUserId, 'private');
    const project = await insertDoc('project', 'Visible Bootstrap Project', memberId, 'workspace');
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [project, privateProgram]
    );

    const response = await request(app).get('/api/bootstrap').set('Cookie', memberCookie);

    const bootstrap = expectOpenApiResponse({
      method: 'get',
      path: '/bootstrap',
      status: 200,
      response,
      openApiSchemaName: 'BootstrapResponse',
      schema: BootstrapResponseSchema,
    });
    const found = bootstrap.data.projects.find((item) => item.id === project);
    expect(found).toBeTruthy();
    expect(found?.program_id).toBeNull();
    expect(JSON.stringify(bootstrap)).not.toContain(privateProgram);
    expect(JSON.stringify(bootstrap)).not.toContain('Hidden Bootstrap Program');
  });

  it('does not reveal hidden program metadata from team project options', async () => {
    const privateProgram = await insertDoc('program', 'Hidden Team Project Program', otherUserId, 'private', {
      emoji: 'HIDDEN',
      color: '#f00',
    });
    const project = await insertDoc('project', 'Visible Team Project Option', memberId, 'workspace');
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [project, privateProgram]
    );

    const response = await request(app).get('/api/team/projects').set('Cookie', memberCookie);

    const teamProjects = expectJsonBody(response, 200, TeamProjectListSchema);
    const found = teamProjects.find((item) => item.id === project);
    expect(found).toBeTruthy();
    expect(found?.programId).toBeNull();
    expect(JSON.stringify(teamProjects)).not.toContain(privateProgram);
    expect(JSON.stringify(teamProjects)).not.toContain('Hidden Team Project Program');
    expect(JSON.stringify(teamProjects)).not.toContain('HIDDEN');
  });

  it('does not reveal hidden project metadata from explicit team assignments', async () => {
    const privateProject = await insertDoc('project', 'Hidden Explicit Assignment Project', otherUserId, 'private');
    await insertDoc('sprint', 'Visible Explicit Assignment Sprint', memberId, 'workspace', {
      sprint_number: 1,
      project_id: privateProject,
      assignee_ids: [memberPersonId],
    });

    const response = await request(app).get('/api/team/assignments').set('Cookie', memberCookie);

    const assignments = expectJsonBody(response, 200, TeamJsonPayloadSchema);
    expect(JSON.stringify(assignments)).not.toContain(privateProject);
    expect(JSON.stringify(assignments)).not.toContain('Hidden Explicit Assignment Project');
  });

  it('does not reveal hidden project metadata from inferred team assignments', async () => {
    const sprint = await insertDoc('sprint', 'Visible Inferred Assignment Sprint', memberId, 'workspace', {
      start_date: new Date().toISOString().split('T')[0],
    });
    const privateProject = await insertDoc('project', 'Hidden Inferred Assignment Project', otherUserId, 'private');
    const issue = await insertDoc('issue', 'Visible Inferred Assignment Issue', memberId, 'workspace', {
      assignee_id: memberId,
    });
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint'), ($1, $3, 'project')`,
      [issue, sprint, privateProject]
    );

    const response = await request(app).get('/api/team/assignments').set('Cookie', memberCookie);

    const assignments = expectJsonBody(response, 200, TeamJsonPayloadSchema);
    expect(JSON.stringify(assignments)).not.toContain(privateProject);
    expect(JSON.stringify(assignments)).not.toContain('Hidden Inferred Assignment Project');
  });

  it('does not reveal private program metadata in team grid', async () => {
    const privateProgram = await insertDoc('program', 'Hidden Team Program', otherUserId, 'private', {
      emoji: 'LOCK',
      color: '#ff0000',
    });
    const sprint = await insertDoc('sprint', 'Visible Sprint', memberId, 'workspace', {
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
    });
    const issue = await insertDoc('issue', 'Visible Team Issue', memberId, 'workspace', {
      assignee_id: memberId,
      state: 'todo',
    });
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint'), ($1, $3, 'program')`,
      [issue, sprint, privateProgram]
    );

    const response = await request(app)
      .get('/api/team/grid?fromSprint=1&toSprint=2')
      .set('Cookie', memberCookie);

    const grid = expectJsonBody(response, 200, TeamJsonPayloadSchema);
    expect(JSON.stringify(grid)).not.toContain(privateProgram);
    expect(JSON.stringify(grid)).not.toContain('Hidden Team Program');
    expect(JSON.stringify(grid)).not.toContain('LOCK');
  });

  it('shows only visible incomplete children in parent close warnings', async () => {
    const parent = await insertDoc('issue', 'Closable Parent', memberId, 'workspace', { state: 'todo' });
    const visibleChild = await insertDoc('issue', 'Visible Child Warning', memberId, 'workspace', { state: 'todo' });
    const privateChild = await insertDoc('issue', 'Private Child Warning', otherUserId, 'private', { state: 'todo' });
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $3, 'parent'), ($2, $3, 'parent')`,
      [visibleChild, privateChild, parent]
    );

    const response = await request(app)
      .patch(`/api/issues/${parent}`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', csrfToken)
      .send({ state: 'done' });

    const warning = expectOpenApiResponse({
      method: 'patch',
      path: '/issues/{id}',
      status: 409,
      response,
      openApiSchemaName: 'IncompleteChildrenWarning',
      schema: IncompleteChildrenWarningTestSchema,
    });
    expect(warning.incomplete_children).toHaveLength(1);
    expect(warning.incomplete_children[0].id).toBe(visibleChild);
    expect(JSON.stringify(warning)).not.toContain(privateChild);
    expect(JSON.stringify(warning)).not.toContain('Private Child Warning');
  });

  it('blocks member public feedback enablement through generic document PATCH', async () => {
    const program = await insertDoc('program', 'Feedback Program', memberId, 'workspace', {
      public_feedback_enabled: false,
    });

    const response = await request(app)
      .patch(`/api/documents/${program}`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', csrfToken)
      .send({ properties: { public_feedback_enabled: true } });

    expect(response.status).toBe(403);

    const stored = await pool.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM documents WHERE id = $1`,
      [program]
    );
    expect(stored.rows[0]?.properties.public_feedback_enabled).toBe(false);
  });

  async function insertDoc(
    type: string,
    title: string,
    createdBy: string,
    visibility: 'private' | 'workspace',
    properties: Record<string, unknown> = {}
  ): Promise<string> {
    const result = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [workspaceId, type, title, visibility, createdBy, JSON.stringify(properties)]
    );
    return requireFirstRow(result.rows).id;
  }
});
