// Public FleetGraph API tests cover attention-context scopes and visibility filtering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  PublicApiErrorSchema,
  PublicFleetGraphAttentionContextsListResponseSchema,
} from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import {
  createPublicApiTestContext,
  deleteIssueIterationsForWorkspace,
  type PublicApiTestContext,
} from '../../../test/public-api-fixtures.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';

describe('/api/v1/fleetgraph/attention-contexts', () => {
  const app = createApp();
  let ctx: PublicApiTestContext;
  let workspaceId: string;
  let adminUserId: string;
  let memberUserId: string;
  let clientId: string;
  let readToken: string;
  let missingDocumentScopeToken: string;
  let memberReadToken: string;
  let visibleSprintId: string;
  let visibleIssueId: string;
  let hiddenIssueId: string;

  beforeAll(async () => {
    ctx = await createPublicApiTestContext({
      label: 'Public FleetGraph',
      clientIdPrefix: 'ship_app_fleetgraph',
      requestedScopes: ['documents:read', 'issues:read', 'sprints:read'],
      includeMember: true,
      workspaceExtras: { sprintStartDate: '2026-01-05' },
    });
    workspaceId = ctx.workspaceId;
    adminUserId = ctx.adminUserId;
    if (!ctx.memberUserId) throw new Error('expected member user in fleetgraph test fixture');
    memberUserId = ctx.memberUserId;
    clientId = ctx.clientId;
    readToken = await ctx.issueToken(['documents:read', 'issues:read', 'sprints:read']);
    missingDocumentScopeToken = await ctx.issueToken(['issues:read', 'sprints:read']);
    memberReadToken = await ctx.issueToken(
      ['documents:read', 'issues:read', 'sprints:read'],
      memberUserId
    );

    visibleSprintId = await insertDocument('sprint', 'Visible Sprint', 'workspace', {
      sprint_number: 7,
      owner_id: adminUserId,
    });
    const hiddenProjectId = await insertDocument('project', 'Hidden Project', 'private', {
      owner_id: adminUserId,
    });
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [
        hiddenProjectId,
        await insertDocument('program', 'Hidden Program', 'private', { owner_id: adminUserId }),
      ]
    );

    visibleIssueId = await insertDocument('issue', 'Visible attention issue', 'workspace', {
      priority: 'urgent',
      state: 'in_progress',
      assignee_id: adminUserId,
    }, 701);
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint'), ($1, $3, 'project')`,
      [visibleIssueId, visibleSprintId, hiddenProjectId]
    );
    await pool.query(
      `INSERT INTO issue_iterations (workspace_id, issue_id, status, what_attempted, blockers_encountered, author_id)
       VALUES ($1, $2, 'fail', 'Checked dependency state', 'Waiting on hidden dependency', $3)`,
      [workspaceId, visibleIssueId, adminUserId]
    );

    const hiddenSprintId = await insertDocument('sprint', 'Hidden Sprint', 'private', {
      sprint_number: 8,
      owner_id: adminUserId,
    });
    hiddenIssueId = await insertDocument('issue', 'Hidden attention issue', 'private', {
      priority: 'high',
      state: 'backlog',
      assignee_id: adminUserId,
    }, 702);
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')`,
      [hiddenIssueId, hiddenSprintId]
    );
  });

  afterAll(async () => {
    await deleteIssueIterationsForWorkspace(workspaceId);
    await pool.query(
      'DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)',
      [workspaceId]
    );
    await ctx.cleanup();
  });

  it('requires all FleetGraph read scopes', async () => {
    const response = await request(app)
      .get('/api/v1/fleetgraph/attention-contexts')
      .set('Authorization', `Bearer ${missingDocumentScopeToken}`);

    const body = expectJsonBody(response, 403, PublicApiErrorSchema);
    expect(body.details).toMatchObject({ missing_scope: 'documents:read' });
  });

  it('lists attention contexts without leaking hidden issue, project, or program metadata', async () => {
    const response = await request(app)
      .get('/api/v1/fleetgraph/attention-contexts')
      .set('Authorization', `Bearer ${memberReadToken}`);

    const body = expectJsonBody(response, 200, PublicFleetGraphAttentionContextsListResponseSchema);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      issue_id: visibleIssueId,
      sprint_id: visibleSprintId,
      issue_title: 'Visible attention issue',
      blocker_text: 'Waiting on hidden dependency',
      project_id: null,
      project_title: null,
      program_id: null,
      program_title: null,
    });
    expect(body.data.map((context) => context.issue_id)).not.toContain(hiddenIssueId);
    expect(response.text).not.toContain('Hidden Project');
    expect(response.text).not.toContain('Hidden Program');
    expect(response.text).not.toContain('Hidden attention issue');
  });

  it('supports source filters for a caller with all required scopes', async () => {
    const requestId = `fleetgraph-context-${ctx.testRunId}`;
    const response = await request(app)
      .get('/api/v1/fleetgraph/attention-contexts')
      .query({ source_issue_id: visibleIssueId, limit: 1 })
      .set('x-request-id', requestId)
      .set('Authorization', `Bearer ${readToken}`);

    const body = expectJsonBody(response, 200, PublicFleetGraphAttentionContextsListResponseSchema);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.issue_id).toBe(visibleIssueId);

    const audit = requireFirstRow((await pool.query<{
      client_id: string | null;
      user_id: string | null;
      route: string;
      scope_used: string | null;
      status: number;
      latency_ms: number;
    }>(
      `SELECT client_id, user_id, route, scope_used, status, latency_ms
       FROM public_api_audit_logs
       WHERE request_id = $1`,
      [requestId]
    )).rows);
    expect(audit).toMatchObject({
      client_id: clientId,
      user_id: adminUserId,
      route: '/api/v1/fleetgraph/attention-contexts',
      scope_used: 'documents:read issues:read sprints:read',
      status: 200,
    });
    expect(audit.latency_ms).toBeGreaterThanOrEqual(0);
  });

  async function insertDocument(
    documentType: string,
    title: string,
    visibility: 'private' | 'workspace',
    properties: Record<string, unknown>,
    ticketNumber?: number
  ): Promise<string> {
    return requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, visibility, properties, ticket_number, created_by
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id`,
      [workspaceId, documentType, title, visibility, JSON.stringify(properties), ticketNumber ?? null, adminUserId]
    )).rows).id;
  }
});
