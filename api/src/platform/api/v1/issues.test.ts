// Public issue API tests cover OAuth scopes, cursor pages, visibility, patch, and audit rows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  PublicApiErrorSchema,
  PublicIssueSchema,
  PublicIssueUpdateConflictErrorSchema,
  PublicIssuesListResponseSchema,
} from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import { createOAuthAccessToken } from '../../oauth/tokens.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';

type PublicApiAuditRow = {
  app_id: string | null;
  client_id: string | null;
  user_id: string | null;
  workspace_id: string | null;
  method: string;
  route: string;
  scope_used: string | null;
  status: number;
  error_code: string | null;
};

describe('/api/v1/issues', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clientId = `ship_app_issues_${testRunId}`;

  let workspaceId: string;
  let userId: string;
  let memberUserId: string;
  let appId: string;
  let readWriteToken: string;
  let readOnlyToken: string;
  let documentsOnlyToken: string;
  let memberReadToken: string;

  beforeAll(async () => {
    workspaceId = requireFirstRow((await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Public Issues ${testRunId}`]
    )).rows).id;
    userId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Public Issues Admin')
       RETURNING id`,
      [`public-issues-${testRunId}@ship.local`]
    )).rows).id;
    memberUserId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Public Issues Member')
       RETURNING id`,
      [`public-issues-member-${testRunId}@ship.local`]
    )).rows).id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, userId, memberUserId]
    );
    appId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, 'Public Issues Test App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        ['https://example.test/callback'],
        ['issues:read', 'issues:write', 'documents:read'],
      ]
    )).rows).id;

    readWriteToken = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['issues:read', 'issues:write'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
    readOnlyToken = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['issues:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
    documentsOnlyToken = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
    memberReadToken = (await createOAuthAccessToken({
      appId,
      userId: memberUserId,
      workspaceId,
      grantedScopes: ['issues:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2', [workspaceId, clientId]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [appId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, memberUserId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('returns public errors for missing and insufficient scopes', async () => {
    const unauthenticated = await request(app).get('/api/v1/issues');
    expectJsonBody(unauthenticated, 401, PublicApiErrorSchema);

    const forbidden = await request(app)
      .get('/api/v1/issues')
      .set('Authorization', `Bearer ${documentsOnlyToken}`);
    const body = expectJsonBody(forbidden, 403, PublicApiErrorSchema);
    expect(body.details).toMatchObject({ missing_scope: 'issues:read' });
  });

  it('creates, gets, lists with cursors, and narrowly patches issues', async () => {
    const first = await createIssue('first public issue');
    const second = await createIssue('second public issue');

    const getResponse = await request(app)
      .get(`/api/v1/issues/${first.id}`)
      .set('Authorization', `Bearer ${readOnlyToken}`);
    const fetched = expectJsonBody(getResponse, 200, PublicIssueSchema);
    expect(fetched.id).toBe(first.id);

    const listResponse = await request(app)
      .get('/api/v1/issues')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${readOnlyToken}`);
    const firstPage = expectJsonBody(listResponse, 200, PublicIssuesListResponseSchema);
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const nextResponse = await request(app)
      .get('/api/v1/issues')
      .query({ limit: 1, cursor: firstPage.next_cursor })
      .set('Authorization', `Bearer ${readOnlyToken}`);
    const secondPage = expectJsonBody(nextResponse, 200, PublicIssuesListResponseSchema);
    expect(secondPage.data).toHaveLength(1);
    const pagedIds = [...firstPage.data, ...secondPage.data].map(issue => issue.id);
    expect(new Set(pagedIds).size).toBe(2);
    expect(pagedIds).toEqual(expect.arrayContaining([first.id, second.id]));

    const patchResponse = await request(app)
      .patch(`/api/v1/issues/${first.id}`)
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ state: 'in_progress', assignee_id: memberUserId });
    const patched = expectJsonBody(patchResponse, 200, PublicIssueSchema);
    expect(patched).toMatchObject({
      id: first.id,
      state: 'in_progress',
      assignee_id: memberUserId,
    });
  });

  it('rejects invalid patch bodies and records audit rows', async () => {
    const patchTarget = await createIssue('patch scope target');
    const invalid = await request(app)
      .patch('/api/v1/issues/not-a-uuid')
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ state: 'done' });
    expectJsonBody(invalid, 400, PublicApiErrorSchema);

    const confirmOnly = await request(app)
      .patch(`/api/v1/issues/${patchTarget.id}`)
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ confirm_orphan_children: true });
    expectJsonBody(confirmOnly, 400, PublicApiErrorSchema);

    const patchRequestId = `${testRunId}-patch-forbidden`;
    const forbiddenPatch = await request(app)
      .patch(`/api/v1/issues/${patchTarget.id}`)
      .set('x-request-id', patchRequestId)
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({ state: 'done' });
    const forbiddenPatchBody = expectJsonBody(forbiddenPatch, 403, PublicApiErrorSchema);
    expect(forbiddenPatchBody.details).toMatchObject({ missing_scope: 'issues:write' });

    const patchAudit = await waitForAuditRow(patchRequestId);
    expect(patchAudit).toMatchObject({
      app_id: appId,
      client_id: clientId,
      user_id: userId,
      workspace_id: workspaceId,
      method: 'PATCH',
      route: `/api/v1/issues/${patchTarget.id}`,
      scope_used: 'issues:write',
      status: 403,
      error_code: 'forbidden',
    });

    const requestId = `${testRunId}-create`;
    const response = await request(app)
      .post('/api/v1/issues')
      .set('x-request-id', requestId)
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ title: 'audited public issue' });
    expectJsonBody(response, 201, PublicIssueSchema);

    const audit = await waitForAuditRow(requestId);
    expect(audit).toMatchObject({
      app_id: appId,
      client_id: clientId,
      user_id: userId,
      workspace_id: workspaceId,
      method: 'POST',
      route: '/api/v1/issues',
      scope_used: 'issues:write',
      status: 201,
      error_code: null,
    });
  });

  it('does not expose private issues to another member', async () => {
    const privateIssueId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, ticket_number, created_by, visibility
       )
       VALUES ($1, 'issue', 'Private issue', $2, 999, $3, 'private')
       RETURNING id`,
      [workspaceId, { state: 'todo', priority: 'medium', source: 'internal', assignee_id: null }, userId]
    )).rows).id;

    const getResponse = await request(app)
      .get(`/api/v1/issues/${privateIssueId}`)
      .set('Authorization', `Bearer ${memberReadToken}`);
    expectJsonBody(getResponse, 404, PublicApiErrorSchema);

    const listResponse = await request(app)
      .get('/api/v1/issues')
      .set('Authorization', `Bearer ${memberReadToken}`);
    const listBody = expectJsonBody(listResponse, 200, PublicIssuesListResponseSchema);
    expect(listBody.data.map(issue => issue.id)).not.toContain(privateIssueId);
  });

  it('does not leak private related document metadata through belongs_to or filters', async () => {
    const privateProgramId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'program', 'Hidden Program', $2, $3, 'private')
       RETURNING id`,
      [workspaceId, { prefix: 'HID', color: '#000000' }, userId]
    )).rows).id;
    const issueId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, ticket_number, created_by, visibility
       )
       VALUES ($1, 'issue', 'Visible issue with hidden program', $2, 701, $3, 'workspace')
       RETURNING id`,
      [workspaceId, { state: 'todo', priority: 'medium', source: 'internal', assignee_id: null }, userId]
    )).rows).id;
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [issueId, privateProgramId]
    );

    const getResponse = await request(app)
      .get(`/api/v1/issues/${issueId}`)
      .set('Authorization', `Bearer ${memberReadToken}`);
    const issue = expectJsonBody(getResponse, 200, PublicIssueSchema);
    expect(issue.belongs_to).toEqual([]);

    const listResponse = await request(app)
      .get('/api/v1/issues')
      .query({ program_id: privateProgramId })
      .set('Authorization', `Bearer ${memberReadToken}`);
    const page = expectJsonBody(listResponse, 200, PublicIssuesListResponseSchema);
    expect(page.data.map(item => item.id)).not.toContain(issueId);
  });

  it('tolerates malformed issue JSON properties from generic document writes', async () => {
    const issueId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, ticket_number, created_by, visibility
       )
       VALUES ($1, 'issue', 'Malformed public issue', $2, 702, $3, 'workspace')
       RETURNING id`,
      [
        workspaceId,
        { state: 'not-real', priority: 'not-real', source: 'not-real', assignee_id: 'not-a-uuid' },
        userId,
      ]
    )).rows).id;

    const getResponse = await request(app)
      .get(`/api/v1/issues/${issueId}`)
      .set('Authorization', `Bearer ${readOnlyToken}`);
    const issue = expectJsonBody(getResponse, 200, PublicIssueSchema);
    expect(issue).toMatchObject({
      id: issueId,
      state: 'backlog',
      priority: 'medium',
      source: 'internal',
      assignee_id: null,
    });
  });

  it('returns structured conflict details when closing a parent with incomplete children', async () => {
    const parentId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, ticket_number, created_by, visibility
       )
       VALUES ($1, 'issue', 'Parent issue', $2, 710, $3, 'workspace')
       RETURNING id`,
      [workspaceId, { state: 'in_progress', priority: 'medium', source: 'internal', assignee_id: null }, userId]
    )).rows).id;
    const childId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, ticket_number, created_by, visibility
       )
       VALUES ($1, 'issue', 'Child issue', $2, 711, $3, 'workspace')
       RETURNING id`,
      [workspaceId, { state: 'backlog', priority: 'medium', source: 'internal', assignee_id: null }, userId]
    )).rows).id;
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'parent')`,
      [childId, parentId]
    );

    const conflictResponse = await request(app)
      .patch(`/api/v1/issues/${parentId}`)
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ state: 'done' });
    const conflict = expectJsonBody(conflictResponse, 409, PublicIssueUpdateConflictErrorSchema);
    expect(conflict.code).toBe('conflict');
    expect(conflict.details?.reason).toBe('incomplete_children');
    expect(conflict.details?.incomplete_children.length).toBeGreaterThanOrEqual(1);
    expect(conflict.details?.incomplete_children[0]?.id).toBe(childId);

    const confirmResponse = await request(app)
      .patch(`/api/v1/issues/${parentId}`)
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ state: 'done', confirm_orphan_children: true });
    const updated = expectJsonBody(confirmResponse, 200, PublicIssueSchema);
    expect(updated.state).toBe('done');
  });

  async function createIssue(title: string) {
    const response = await request(app)
      .post('/api/v1/issues')
      .set('Authorization', `Bearer ${readWriteToken}`)
      .send({ title });
    return expectJsonBody(response, 201, PublicIssueSchema);
  }

  async function waitForAuditRow(requestId: string): Promise<PublicApiAuditRow> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await pool.query<PublicApiAuditRow>(
        `SELECT app_id, client_id, user_id, workspace_id, method, route, scope_used, status, error_code
         FROM public_api_audit_logs
         WHERE request_id = $1`,
        [requestId]
      );
      if (result.rows[0]) return result.rows[0];
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Audit row not found for ${requestId}`);
  }
});
