// Verifies FleetGraph routes enforce real auth, CSRF, and source visibility boundaries.
import crypto from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { saveBlockedImportantIssueFinding } from '../fleetgraph/persistence.js';
import { hashToken } from '../security/tokens.js';
import { requireFirstRow } from '../utils/query-rows.js';

const app = createApp('http://localhost:5173');
const testRunId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type CsrfResponseBody = { token: string };
type FleetGraphFindingsBody = { findings: unknown[] };
type FleetGraphRunBody = { decision: string; finding?: unknown };
type FleetGraphChatBody = {
  decision: string;
  answer?: {
    title?: string;
    body?: string;
    nextStep?: string;
  };
};

async function createUser(label: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, 'test-hash', $2)
     RETURNING id`,
    [`fleetgraph-${label}-${testRunId}@ship.local`, `FleetGraph ${label}`]
  );
  return requireFirstRow(result.rows).id;
}

async function createSession(input: { userId: string; workspaceId: string }): Promise<{ cookie: string; csrfToken: string }> {
  const sessionId = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [sessionId, input.userId, input.workspaceId]
  );
  let cookie = `session_id=${sessionId}`;
  const csrfRes = await request(app).get('/api/csrf-token').set('Cookie', cookie);
  const csrfCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
  if (csrfCookie) cookie = `${cookie}; ${csrfCookie}`;
  const body = JSON.parse(csrfRes.text) as CsrfResponseBody;
  return { cookie, csrfToken: body.token };
}

describe('FleetGraph route security', () => {
  let workspaceId: string;
  let ownerId: string;
  let memberId: string;
  let adminId: string;
  let memberCookie: string;
  let memberCsrf: string;
  let adminCookie: string;
  let adminCsrf: string;
  let adminToken: string;
  let readOnlyToken: string;
  let issueId: string;
  let sprintId: string;
  let findingId: string;

  beforeAll(async () => {
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (name, sprint_start_date)
       VALUES ($1, '2026-05-18')
       RETURNING id`,
      [`FleetGraph security ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspace.rows).id;
    ownerId = await createUser('owner');
    memberId = await createUser('member');
    adminId = await createUser('admin');
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member'), ($1, $3, 'member'), ($1, $4, 'admin')`,
      [workspaceId, ownerId, memberId, adminId]
    );

    const issue = await pool.query<{ id: string }>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'issue', 'Private blocked issue', 'private', $2, $3::jsonb)
       RETURNING id`,
      [workspaceId, ownerId, JSON.stringify({ priority: 'urgent', state: 'in_progress', assignee_id: ownerId })]
    );
    issueId = requireFirstRow(issue.rows).id;
    const sprint = await pool.query<{ id: string }>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'sprint', 'Week 1', 'workspace', $2, $3::jsonb)
       RETURNING id`,
      [workspaceId, ownerId, JSON.stringify({ sprint_number: 1, owner_id: ownerId })]
    );
    sprintId = requireFirstRow(sprint.rows).id;
    const finding = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'urgent',
      confidence: 0.86,
      title: 'Private source finding',
      summary: 'This summary must not leak to unauthorized members.',
      evidenceSnapshot: [{
        kind: 'source_issue',
        sourceDocumentId: issueId,
        sourceType: 'issue',
        claim: 'Hidden private issue is blocked.',
        excerpt: 'secret blocker',
        visibility: 'internal',
        visibleFields: ['title'],
      }],
      humanGate: { required: true },
    });
    findingId = finding.id;
    const memberSession = await createSession({ userId: memberId, workspaceId });
    memberCookie = memberSession.cookie;
    memberCsrf = memberSession.csrfToken;
    const adminSession = await createSession({ userId: adminId, workspaceId });
    adminCookie = adminSession.cookie;
    adminCsrf = adminSession.csrfToken;
    adminToken = `ship_${crypto.randomBytes(32).toString('hex')}`;
    readOnlyToken = `ship_${crypto.randomBytes(32).toString('hex')}`;
    await pool.query(
      `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix, scopes)
       VALUES
         ($1, $2, 'fleetgraph-admin', $3, $4, ARRAY['admin:workspace']::text[]),
         ($1, $2, 'fleetgraph-read', $5, $6, ARRAY['documents:read']::text[])`,
      [
        adminId,
        workspaceId,
        hashToken(adminToken),
        adminToken.slice(0, 12),
        hashToken(readOnlyToken),
        readOnlyToken.slice(0, 12),
      ]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM fleetgraph_runs WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM fleetgraph_findings WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM api_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [[ownerId, memberId, adminId]]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, memberId, adminId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('requires authentication for FleetGraph read routes', async () => {
    await request(app)
      .get(`/api/fleetgraph/findings?sourceSprintId=${sprintId}`)
      .expect(401);
  });

  it('requires CSRF for session-authenticated FleetGraph mutations', async () => {
    await request(app)
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .set('Cookie', memberCookie)
      .expect(403);
  });

  it('omits findings whose source issue is not visible to the actor', async () => {
    const res = await request(app)
      .get(`/api/fleetgraph/findings?sourceSprintId=${sprintId}`)
      .set('Cookie', memberCookie)
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphFindingsBody;
    expect(body.findings).toEqual([]);
    expect(res.text).not.toContain(issueId);
    expect(res.text).not.toContain('secret blocker');
  });

  it('does not dismiss findings for non-admin members or leak hidden identifiers', async () => {
    const res = await request(app)
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .expect(403);

    const body = JSON.parse(res.text) as FleetGraphRunBody;
    expect(body.finding).toBeUndefined();
    expect(res.text).not.toContain(issueId);
    expect(res.text).not.toContain('secret blocker');
    const status = await pool.query<{ status: string }>(
      'SELECT status FROM fleetgraph_findings WHERE id = $1',
      [findingId]
    );
    expect(requireFirstRow(status.rows).status).toBe('open');
  });

  it('rejects manual runs for non-admin workspace members', async () => {
    await request(app)
      .post('/api/fleetgraph/manual-run')
      .set('Cookie', memberCookie)
      .set('x-csrf-token', memberCsrf)
      .send({})
      .expect(403);
  });

  it('allows admin-scoped bearer tokens to trigger manual runs without CSRF', async () => {
    const res = await request(app)
      .post('/api/fleetgraph/manual-run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(200);

    const body = JSON.parse(res.text) as { mode: string; results: unknown[] };
    expect(body.mode).toBe('proactive');
    expect(body.results.length).toBeGreaterThan(0);
  });

  it('rejects read-only bearer tokens for admin-gated FleetGraph routes', async () => {
    await request(app)
      .post('/api/fleetgraph/manual-run')
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({})
      .expect(403);

    await request(app)
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .expect(403);
  });

  it('answers attached document chat through the real FleetGraph route', async () => {
    await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'urgent',
      confidence: 0.86,
      title: 'Private source finding for chat',
      summary: 'This chat smoke summary proves the route can answer from attached context.',
      evidenceSnapshot: [{
        kind: 'source_issue',
        sourceDocumentId: issueId,
        sourceType: 'issue',
        claim: 'Hidden private issue is blocked.',
        excerpt: 'chat smoke blocker',
        visibility: 'internal',
        visibleFields: ['title'],
      }],
      humanGate: { required: true },
    });

    const res = await request(app)
      .post('/api/fleetgraph/chat')
      .set('Cookie', adminCookie)
      .set('x-csrf-token', adminCsrf)
      .send({
        prompt: 'Summarize this issue',
        context: {
          kind: 'document',
          documentId: issueId,
          sourcePath: `/documents/${issueId}`,
        },
      })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphChatBody;
    expect(body.decision).toBe('explain');
    expect(body.answer?.title).toBe('Private blocked issue');
    expect(body.answer?.body).toContain('Private blocked issue is an issue.');
    expect(res.text).not.toContain('I can answer from the attached issue');
  });

  it('fails closed for manual runs in production unless explicitly enabled', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousManualFlag = process.env.FLEETGRAPH_MANUAL_RUN_API_ENABLED;
    process.env.NODE_ENV = 'production';
    delete process.env.FLEETGRAPH_MANUAL_RUN_API_ENABLED;
    try {
      await request(app)
        .post('/api/fleetgraph/manual-run')
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrf)
        .send({})
        .expect(403);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousManualFlag === undefined) {
        delete process.env.FLEETGRAPH_MANUAL_RUN_API_ENABLED;
      } else {
        process.env.FLEETGRAPH_MANUAL_RUN_API_ENABLED = previousManualFlag;
      }
    }
  });

  it('allows workspace admins to dismiss without mutating Ship source documents', async () => {
    const dismissFinding = await saveBlockedImportantIssueFinding({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      severity: 'urgent',
      confidence: 0.86,
      title: 'Private source finding for dismiss',
      summary: 'This finding is only for the dismiss mutation assertion.',
      evidenceSnapshot: [{
        kind: 'source_issue',
        sourceDocumentId: issueId,
        sourceType: 'issue',
        claim: 'Hidden private issue is blocked.',
        excerpt: 'secret blocker',
        visibility: 'internal',
        visibleFields: ['title'],
      }],
      humanGate: { required: true },
    });
    const before = await pool.query<{ title: string; properties: Record<string, unknown> }>(
      'SELECT title, properties FROM documents WHERE id = $1',
      [issueId]
    );

    const res = await request(app)
      .post(`/api/fleetgraph/findings/${dismissFinding.id}/dismiss`)
      .set('Cookie', adminCookie)
      .set('x-csrf-token', adminCsrf)
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphRunBody;
    expect(body.decision).toBe('dismiss');
    const status = await pool.query<{ status: string; dismissed_by: string }>(
      'SELECT status, dismissed_by FROM fleetgraph_findings WHERE id = $1',
      [dismissFinding.id]
    );
    expect(requireFirstRow(status.rows)).toMatchObject({
      status: 'dismissed',
      dismissed_by: adminId,
    });
    const after = await pool.query<{ title: string; properties: Record<string, unknown> }>(
      'SELECT title, properties FROM documents WHERE id = $1',
      [issueId]
    );
    expect(requireFirstRow(after.rows)).toEqual(requireFirstRow(before.rows));
  });
});
