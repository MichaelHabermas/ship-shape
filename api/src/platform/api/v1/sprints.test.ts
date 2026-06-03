// Public sprint API tests cover sprint reads, cursor pages, visibility, and nested issue scopes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  PublicApiErrorSchema,
  PublicIssuesListResponseSchema,
  PublicSprintSchema,
  PublicSprintsListResponseSchema,
} from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import { createPublicApiTestContext, type PublicApiTestContext } from '../../../test/public-api-fixtures.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';

describe('/api/v1/sprints', () => {
  const app = createApp();
  let ctx: PublicApiTestContext;
  let workspaceId: string;
  let userId: string;
  let memberUserId: string;
  let sprintReadToken: string;
  let sprintAndIssueReadToken: string;
  let issueOnlyToken: string;
  let memberSprintReadToken: string;
  let sprintId: string;
  let secondSprintId: string;
  let issueId: string;

  beforeAll(async () => {
    ctx = await createPublicApiTestContext({
      label: 'Public Sprints',
      clientIdPrefix: 'ship_app_sprints',
      requestedScopes: ['sprints:read', 'issues:read'],
      includeMember: true,
      workspaceExtras: { sprintStartDate: '2026-01-05' },
    });
    workspaceId = ctx.workspaceId;
    userId = ctx.adminUserId;
    if (!ctx.memberUserId) throw new Error('expected member user in sprint test fixture');
    memberUserId = ctx.memberUserId;
    sprintReadToken = await ctx.issueToken(['sprints:read']);
    sprintAndIssueReadToken = await ctx.issueToken(['sprints:read', 'issues:read']);
    issueOnlyToken = await ctx.issueToken(['issues:read']);
    memberSprintReadToken = await ctx.issueToken(['sprints:read'], memberUserId);

    sprintId = await insertSprint('Public Sprint 1', 1, 'workspace');
    secondSprintId = await insertSprint('Public Sprint 2', 2, 'workspace');
    issueId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, ticket_number, created_by, visibility
       )
       VALUES ($1, 'issue', 'Sprint issue', $2, 88, $3, 'workspace')
       RETURNING id`,
      [workspaceId, { state: 'todo', priority: 'high', source: 'internal', assignee_id: null }, userId]
    )).rows).id;
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')`,
      [issueId, sprintId]
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('lists and gets sprint documents with cursor pages', async () => {
    const getResponse = await request(app)
      .get(`/api/v1/sprints/${sprintId}`)
      .set('Authorization', `Bearer ${sprintReadToken}`);
    const sprint = expectJsonBody(getResponse, 200, PublicSprintSchema);
    expect(sprint).toMatchObject({
      id: sprintId,
      name: 'Public Sprint 1',
      sprint_number: 1,
    });

    const listResponse = await request(app)
      .get('/api/v1/sprints')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${sprintReadToken}`);
    const firstPage = expectJsonBody(listResponse, 200, PublicSprintsListResponseSchema);
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const nextResponse = await request(app)
      .get('/api/v1/sprints')
      .query({ limit: 1, cursor: firstPage.next_cursor })
      .set('Authorization', `Bearer ${sprintReadToken}`);
    const secondPage = expectJsonBody(nextResponse, 200, PublicSprintsListResponseSchema);
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.next_cursor).toBeNull();
    const pageIds = [...firstPage.data, ...secondPage.data].map(sprint => sprint.id);
    expect(new Set(pageIds).size).toBe(2);
    expect(pageIds).toEqual(expect.arrayContaining([sprintId, secondSprintId]));
  });

  it('requires both sprint and issue read scopes for nested sprint issues', async () => {
    const missingIssues = await request(app)
      .get(`/api/v1/sprints/${sprintId}/issues`)
      .set('Authorization', `Bearer ${sprintReadToken}`);
    const missingIssuesBody = expectJsonBody(missingIssues, 403, PublicApiErrorSchema);
    expect(missingIssuesBody.details).toMatchObject({ missing_scope: 'issues:read' });

    const missingSprints = await request(app)
      .get(`/api/v1/sprints/${sprintId}/issues`)
      .set('Authorization', `Bearer ${issueOnlyToken}`);
    const missingSprintsBody = expectJsonBody(missingSprints, 403, PublicApiErrorSchema);
    expect(missingSprintsBody.details).toMatchObject({ missing_scope: 'sprints:read' });

    const response = await request(app)
      .get(`/api/v1/sprints/${sprintId}/issues`)
      .set('Authorization', `Bearer ${sprintAndIssueReadToken}`);
    const page = expectJsonBody(response, 200, PublicIssuesListResponseSchema);
    expect(page.data.map(issue => issue.id)).toContain(issueId);
  });

  it('does not expose private sprint documents to another member', async () => {
    const privateSprintId = await insertSprint('Private Sprint', 99, 'private');

    const getResponse = await request(app)
      .get(`/api/v1/sprints/${privateSprintId}`)
      .set('Authorization', `Bearer ${memberSprintReadToken}`);
    expectJsonBody(getResponse, 404, PublicApiErrorSchema);

    const listResponse = await request(app)
      .get('/api/v1/sprints')
      .set('Authorization', `Bearer ${memberSprintReadToken}`);
    const listBody = expectJsonBody(listResponse, 200, PublicSprintsListResponseSchema);
    expect(listBody.data.map(sprint => sprint.id)).not.toContain(privateSprintId);
  });

  it('does not leak private program or hidden accountability document metadata', async () => {
    const privateProgramId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'program', 'Private Sprint Program', $2, $3, 'private')
       RETURNING id`,
      [workspaceId, { prefix: 'PSP', accountable_id: userId }, userId]
    )).rows).id;
    const publicSprintId = await insertSprint('Public Sprint With Hidden Links', 101, 'workspace');
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [publicSprintId, privateProgramId]
    );
    await pool.query(
      `INSERT INTO documents (
         workspace_id, document_type, title, parent_id, properties, created_by, visibility
       )
       VALUES ($1, 'weekly_plan', 'Hidden plan', $2, $3, $4, 'workspace')`,
      [workspaceId, publicSprintId, {}, userId]
    );
    const retroId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'weekly_retro', 'Hidden retro', $2, $3, 'workspace')
       RETURNING id`,
      [workspaceId, { outcome: 'private outcome' }, userId]
    )).rows).id;
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')`,
      [retroId, publicSprintId]
    );

    const getResponse = await request(app)
      .get(`/api/v1/sprints/${publicSprintId}`)
      .set('Authorization', `Bearer ${memberSprintReadToken}`);
    const sprint = expectJsonBody(getResponse, 200, PublicSprintSchema);

    expect(sprint.program_id).toBeNull();
    expect(sprint.program_name).toBeNull();
    expect(sprint.program_prefix).toBeNull();
    expect(sprint.program_accountable_id).toBeNull();
    expect(sprint.has_plan).toBe(false);
    expect(sprint.has_retro).toBe(false);
    expect(sprint.retro_outcome).toBeNull();
    expect(sprint.retro_id).toBeNull();
  });

  async function insertSprint(
    title: string,
    sprintNumber: number,
    visibility: 'private' | 'workspace'
  ): Promise<string> {
    return requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'sprint', $2, $3, $4, $5)
       RETURNING id`,
      [
        workspaceId,
        title,
        {
          sprint_number: sprintNumber,
          status: 'planning',
          assignee_ids: [userId],
          plan: `Plan ${sprintNumber}`,
          success_criteria: ['Done'],
          confidence: 80,
        },
        userId,
        visibility,
      ]
    )).rows).id;
  }
});
