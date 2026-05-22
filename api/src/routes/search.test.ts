import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { IdRow, requireFirstRow } from '../test/pg-result.js';
import { pool } from '../db/client.js';
import { rebuildDocumentSearchIndex } from '../utils/tiptap-search.js';

describe('Search API', () => {
  const app = createApp('http://localhost:5173');
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `search-${testRunId}@ship.local`;
  const secondTestEmail = `search-second-${testRunId}@ship.local`;
  const testWorkspaceName = `Search Test ${testRunId}`;

  let sessionCookie: string;
  let secondUserSessionCookie: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let secondTestUserId: string;
  let testPersonDocId: string;
  let testWikiDocId: string;
  let testApiToken: string;

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id;

    // Create test user
    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Search Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = requireFirstRow(userResult.rows).id;

    const secondUserResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Second Search Test User')
       RETURNING id`,
      [secondTestEmail]
    );
    secondTestUserId = requireFirstRow(secondUserResult.rows).id;

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, secondTestUserId]
    );

    // Create session (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    );
    sessionCookie = `session_id=${sessionId}`;

    testApiToken = `ship_${crypto.randomBytes(32).toString('hex')}`;
    await pool.query(
      `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        testUserId,
        testWorkspaceId,
        `Search Test Token ${testRunId}`,
        crypto.createHash('sha256').update(testApiToken).digest('hex'),
        testApiToken.slice(0, 8),
      ]
    );

    const secondUserSessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [secondUserSessionId, secondTestUserId, testWorkspaceId]
    );
    secondUserSessionCookie = `session_id=${secondUserSessionId}`;

    // Create test person document
    const personResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content)
       VALUES ($1, 'person', 'Test Person', '{}')
       RETURNING id`,
      [testWorkspaceId]
    );
    testPersonDocId = requireFirstRow(personResult.rows).id;

    // Create test wiki document
    const wikiResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content)
       VALUES ($1, 'wiki', 'Test Wiki', '{}')
       RETURNING id`,
      [testWorkspaceId]
    );
    testWikiDocId = requireFirstRow(wikiResult.rows).id;
  });

  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM documents WHERE id IN ($1, $2) OR workspace_id = $3', [testPersonDocId, testWikiDocId, testWorkspaceId]);
    await pool.query('DELETE FROM api_tokens WHERE user_id IN ($1, $2)', [testUserId, secondTestUserId]);
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, secondTestUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, secondTestUserId]);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, secondTestUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
    // Don't close pool - it's shared across test files
  });

  async function rebuildSearchIndex() {
    await rebuildDocumentSearchIndex(testWorkspaceId);
  }

  it('GET /api/search/mentions returns 401 without auth', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=test');

    expect(res.status).toBe(401);
  });

  it('GET /api/search/mentions returns people and documents', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=Test')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('people');
    expect(res.body).toHaveProperty('documents');
    expect(Array.isArray(res.body.people)).toBe(true);
    expect(Array.isArray(res.body.documents)).toBe(true);
  });

  it('GET /api/search/mentions filters by query string', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=nonexistent12345')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.people).toHaveLength(0);
    expect(res.body.documents).toHaveLength(0);
  });

  it('GET /api/search/mentions returns people with correct structure', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=Test')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);

    // Should find our test person
    expect(res.body.people.length).toBeGreaterThan(0);
    const person = res.body.people[0];
    expect(person).toHaveProperty('id');
    expect(person).toHaveProperty('name');
  });

  it('GET /api/search/mentions returns documents with correct structure', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=Test')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);

    // Should find our test wiki document
    expect(res.body.documents.length).toBeGreaterThan(0);
    const doc = res.body.documents[0];
    expect(doc).toHaveProperty('id');
    expect(doc).toHaveProperty('title');
    expect(doc).toHaveProperty('document_type');
  });

  it('GET /api/search/documents returns 401 without auth', async () => {
    const res = await request(app)
      .get('/api/search/documents?q=test');

    expect(res.status).toBe(401);
  });

  it('GET /api/search/documents searches titles only and returns metadata', async () => {
    const contentOnlyResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'No Title Match', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"PaletteOnlyNeedle"}]}]}', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    const titleResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'PaletteOnlyNeedle Title', '{"type":"doc","content":[]}', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );

    const res = await request(app)
      .get('/api/search/documents?q=PaletteOnlyNeedle')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('documents');
    expect(res.body).toHaveProperty('total');

    const ids = res.body.documents.map((doc: any) => doc.id);
    expect(ids).toContain(requireFirstRow(titleResult.rows).id);
    expect(ids).not.toContain(requireFirstRow(contentOnlyResult.rows).id);

    const doc = res.body.documents.find((item: any) => item.id === requireFirstRow(titleResult.rows).id);
    expect(doc).toMatchObject({
      id: requireFirstRow(titleResult.rows).id,
      title: 'PaletteOnlyNeedle Title',
      document_type: 'wiki',
    });
    expect(doc).not.toHaveProperty('content');
    expect(doc).not.toHaveProperty('properties');
  });

  it('GET /api/search/documents filters by document type', async () => {
    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Type Filter Target', $2),
              ($1, 'issue', 'Type Filter Target', $2)`,
      [testWorkspaceId, testUserId]
    );

    const res = await request(app)
      .get('/api/search/documents?q=Type%20Filter&type=issue')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.documents.length).toBeGreaterThan(0);
    expect(res.body.documents.every((doc: any) => doc.document_type === 'issue')).toBe(true);
  });

  it('GET /api/search/documents validates document type', async () => {
    const res = await request(app)
      .get('/api/search/documents?q=test&type=made_up')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid document type');
  });

  it('GET /api/search/documents respects limit parameter', async () => {
    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Limited Palette Search A', $2),
              ($1, 'wiki', 'Limited Palette Search B', $2),
              ($1, 'wiki', 'Limited Palette Search C', $2)`,
      [testWorkspaceId, testUserId]
    );

    const res = await request(app)
      .get('/api/search/documents?q=Limited%20Palette%20Search&limit=2')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('GET /api/search/content returns 401 without auth', async () => {
    const res = await request(app)
      .get('/api/search/content?q=test');

    expect(res.status).toBe(401);
  });

  it('GET /api/search/content requires a query', async () => {
    const res = await request(app)
      .get('/api/search/content')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Search query is required');
  });

  it('GET /api/search/content searches extracted TipTap body text', async () => {
    const bodyOnlyResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'Body Match Search', $2, $3)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'The launch checklist includes BodyNeedleAlpha.' }],
            },
          ],
        }),
        testUserId,
      ]
    );
    await rebuildSearchIndex();

    const res = await request(app)
      .get('/api/search/content?q=BodyNeedleAlpha')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 1,
      limit: 20,
      offset: 0,
    });
    expect(res.body.documents[0]).toMatchObject({
      id: requireFirstRow(bodyOnlyResult.rows).id,
      title: 'Body Match Search',
      document_type: 'wiki',
    });
    expect(res.body.documents[0].snippet).toContain('<mark>BodyNeedleAlpha</mark>');
    expect(res.body.documents[0].rank).toBeGreaterThan(0);
  });

  it('GET /api/search/content matches selected properties text', async () => {
    const propertiesOnlyResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties, content, created_by)
       VALUES ($1, 'wiki', 'Properties Only Search', $2, '{"type":"doc","content":[]}', $3)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({ tags: ['PropertiesOnlyNeedleTheta'] }),
        testUserId,
      ]
    );
    await rebuildSearchIndex();

    const res = await request(app)
      .get('/api/search/content?q=PropertiesOnlyNeedleTheta')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.documents.map((doc: any) => doc.id)).toContain(requireFirstRow(propertiesOnlyResult.rows).id);
  });

  it('GET /api/search/content ranks title matches above body-only matches', async () => {
    const bodyResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'Body Ranked Doc', $2, $3)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RankNeedleBeta' }] }],
        }),
        testUserId,
      ]
    );
    const titleResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'RankNeedleBeta Title Ranked Doc', $2, $3)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({ type: 'doc', content: [] }),
        testUserId,
      ]
    );
    await rebuildSearchIndex();

    const res = await request(app)
      .get('/api/search/content?q=RankNeedleBeta')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    const ids = res.body.documents.map((doc: any) => doc.id);
    expect(ids.indexOf(requireFirstRow(titleResult.rows).id)).toBeLessThan(ids.indexOf(requireFirstRow(bodyResult.rows).id));
  });

  it('GET /api/search/content filters by document type', async () => {
    const wikiResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'Type Content Wiki', $2, $3)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'TypeNeedleGamma' }] }] }),
        testUserId,
      ]
    );
    const issueResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'issue', 'Type Content Issue', $2, $3)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'TypeNeedleGamma' }] }] }),
        testUserId,
      ]
    );
    await rebuildSearchIndex();

    const res = await request(app)
      .get('/api/search/content?q=TypeNeedleGamma&type=issue')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    const ids = res.body.documents.map((doc: any) => doc.id);
    expect(ids).toContain(requireFirstRow(issueResult.rows).id);
    expect(ids).not.toContain(requireFirstRow(wikiResult.rows).id);
    expect(res.body.documents.every((doc: any) => doc.document_type === 'issue')).toBe(true);
  });

  it('GET /api/search/content validates document type', async () => {
    const res = await request(app)
      .get('/api/search/content?q=test&type=made_up')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid document type');
  });

  it('GET /api/search/content applies visibility before limit', async () => {
    const privateResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, visibility, created_by)
       VALUES ($1, 'wiki', 'Private LimitVisibilityNeedleDelta LimitVisibilityNeedleDelta', $2, 'private', $3)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LimitVisibilityNeedleDelta LimitVisibilityNeedleDelta' }] }],
        }),
        secondTestUserId,
      ]
    );
    const visibleResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, visibility, created_by)
       VALUES ($1, 'wiki', 'Visible Limit Doc', $2, 'workspace', $3)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LimitVisibilityNeedleDelta' }] }],
        }),
        testUserId,
      ]
    );
    await rebuildSearchIndex();

    const userRes = await request(app)
      .get('/api/search/content?q=LimitVisibilityNeedleDelta&limit=1')
      .set('Cookie', sessionCookie);

    expect(userRes.status).toBe(200);
    expect(userRes.body.documents).toHaveLength(1);
    expect(userRes.body.documents[0].id).toBe(requireFirstRow(visibleResult.rows).id);

    const secondUserRes = await request(app)
      .get('/api/search/content?q=LimitVisibilityNeedleDelta&limit=1')
      .set('Cookie', secondUserSessionCookie);

    expect(secondUserRes.status).toBe(200);
    expect(secondUserRes.body.documents[0].id).toBe(requireFirstRow(privateResult.rows).id);
  });

  it('GET /api/search/content respects limit and offset', async () => {
    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by, updated_at)
       VALUES ($1, 'wiki', 'OffsetNeedleEpsilon A', '{"type":"doc","content":[]}', $2, now() - interval '3 minutes'),
              ($1, 'wiki', 'OffsetNeedleEpsilon B', '{"type":"doc","content":[]}', $2, now() - interval '2 minutes'),
              ($1, 'wiki', 'OffsetNeedleEpsilon C', '{"type":"doc","content":[]}', $2, now() - interval '1 minute')`,
      [testWorkspaceId, testUserId]
    );
    await rebuildSearchIndex();

    const res = await request(app)
      .get('/api/search/content?q=OffsetNeedleEpsilon&limit=1&offset=1')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 3,
      limit: 1,
      offset: 1,
    });
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].title).toBe('OffsetNeedleEpsilon B');
  });

  it('REST document content updates refresh the search index', async () => {
    const createRes = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${testApiToken}`)
      .send({
        title: 'REST Search Indexed',
        document_type: 'wiki',
      });

    expect(createRes.status).toBe(201);
    const docId = createRes.body.id;

    const firstUpdate = await request(app)
      .patch(`/api/documents/${docId}/content`)
      .set('Authorization', `Bearer ${testApiToken}`)
      .send({
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RestNeedleZeta' }] }],
        },
      });

    expect(firstUpdate.status).toBe(200);

    const firstSearch = await request(app)
      .get('/api/search/content?q=RestNeedleZeta')
      .set('Cookie', sessionCookie);

    expect(firstSearch.status).toBe(200);
    expect(firstSearch.body.documents.map((doc: any) => doc.id)).toContain(docId);

    const secondUpdate = await request(app)
      .patch(`/api/documents/${docId}/content`)
      .set('Authorization', `Bearer ${testApiToken}`)
      .send({
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ReplacementNeedleEta' }] }],
        },
      });

    expect(secondUpdate.status).toBe(200);

    const oldTermSearch = await request(app)
      .get('/api/search/content?q=RestNeedleZeta')
      .set('Cookie', sessionCookie);
    const newTermSearch = await request(app)
      .get('/api/search/content?q=ReplacementNeedleEta')
      .set('Cookie', sessionCookie);

    expect(oldTermSearch.status).toBe(200);
    expect(newTermSearch.status).toBe(200);
    expect(oldTermSearch.body.documents.map((doc: any) => doc.id)).not.toContain(docId);
    expect(newTermSearch.body.documents.map((doc: any) => doc.id)).toContain(docId);
  });
});

describe('Search Learnings API', () => {
  const app = createApp('http://localhost:5173');
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `learning-${testRunId}@ship.local`;
  const testWorkspaceName = `Learning Test ${testRunId}`;

  let sessionCookie: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let learningDocId: string;
  let regularWikiId: string;

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id;

    // Create test user
    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Learning Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = requireFirstRow(userResult.rows).id;

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    );

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    );
    sessionCookie = `session_id=${sessionId}`;

    // Create learning document (title starts with "Learning:")
    const learningResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties, content, created_by)
       VALUES ($1, 'wiki', 'Learning: API Token Authentication', $2, '{"type":"doc","content":[]}', $3)
       RETURNING id`,
      [testWorkspaceId, JSON.stringify({ tags: ['security', 'api'], category: 'authentication', source_prd: 'test-prd' }), testUserId]
    );
    learningDocId = requireFirstRow(learningResult.rows).id;

    // Create regular wiki document (should not appear in learnings search)
    const regularResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'Regular Wiki Document', '{}', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    regularWikiId = requireFirstRow(regularResult.rows).id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM documents WHERE id IN ($1, $2)', [learningDocId, regularWikiId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  it('GET /api/search/learnings returns 401 without auth', async () => {
    const res = await request(app).get('/api/search/learnings');
    expect(res.status).toBe(401);
  });

  it('GET /api/search/learnings returns learnings by title', async () => {
    const res = await request(app)
      .get('/api/search/learnings')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('learnings');
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.learnings)).toBe(true);

    // Should find our learning document
    const learning = res.body.learnings.find((l: any) => l.id === learningDocId);
    expect(learning).toBeDefined();
    expect(learning.title).toBe('Learning: API Token Authentication');
  });

  it('GET /api/search/learnings filters by keyword', async () => {
    const res = await request(app)
      .get('/api/search/learnings?q=authentication')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.learnings.length).toBeGreaterThan(0);
    expect(res.body.learnings[0].category).toBe('authentication');
  });

  it('GET /api/search/learnings returns tags and metadata', async () => {
    const res = await request(app)
      .get('/api/search/learnings?q=API')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    const learning = res.body.learnings.find((l: any) => l.id === learningDocId);
    expect(learning).toBeDefined();
    expect(learning.tags).toContain('security');
    expect(learning.source_prd).toBe('test-prd');
  });

  it('GET /api/search/learnings excludes non-learning wiki docs', async () => {
    const res = await request(app)
      .get('/api/search/learnings?q=Regular')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    // Regular wiki doc should not appear
    const regularDoc = res.body.learnings.find((l: any) => l.id === regularWikiId);
    expect(regularDoc).toBeUndefined();
  });

  it('GET /api/search/learnings respects limit parameter', async () => {
    const res = await request(app)
      .get('/api/search/learnings?limit=1')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.learnings.length).toBeLessThanOrEqual(1);
  });
});
