import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';

describe('Search API', () => {
  const app = createApp('http://localhost:5173');
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `search-${testRunId}@ship.local`;
  const testWorkspaceName = `Search Test ${testRunId}`;

  let sessionCookie: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testPersonDocId: string;
  let testWikiDocId: string;

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Search Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = userResult.rows[0].id;

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    );

    // Create session (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    );
    sessionCookie = `session_id=${sessionId}`;

    // Create test person document
    const personResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content)
       VALUES ($1, 'person', 'Test Person', '{}')
       RETURNING id`,
      [testWorkspaceId]
    );
    testPersonDocId = personResult.rows[0].id;

    // Create test wiki document
    const wikiResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content)
       VALUES ($1, 'wiki', 'Test Wiki', '{}')
       RETURNING id`,
      [testWorkspaceId]
    );
    testWikiDocId = wikiResult.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM documents WHERE id IN ($1, $2) OR workspace_id = $3', [testPersonDocId, testWikiDocId, testWorkspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
    // Don't close pool - it's shared across test files
  });

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
    const contentOnlyResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'No Title Match', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"PaletteOnlyNeedle"}]}]}', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    const titleResult = await pool.query(
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
    expect(ids).toContain(titleResult.rows[0].id);
    expect(ids).not.toContain(contentOnlyResult.rows[0].id);

    const doc = res.body.documents.find((item: any) => item.id === titleResult.rows[0].id);
    expect(doc).toMatchObject({
      id: titleResult.rows[0].id,
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
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Learning Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = userResult.rows[0].id;

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
    const learningResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, content, created_by)
       VALUES ($1, 'wiki', 'Learning: API Token Authentication', $2, '{"type":"doc","content":[]}', $3)
       RETURNING id`,
      [testWorkspaceId, JSON.stringify({ tags: ['security', 'api'], category: 'authentication', source_prd: 'test-prd' }), testUserId]
    );
    learningDocId = learningResult.rows[0].id;

    // Create regular wiki document (should not appear in learnings search)
    const regularResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'Regular Wiki Document', '{}', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    regularWikiId = regularResult.rows[0].id;
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
