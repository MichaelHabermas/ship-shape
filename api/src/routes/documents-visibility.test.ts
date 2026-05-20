import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';

describe('Document Visibility', () => {
  const app = createApp();
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const user1Email = `user1-vis-${testRunId}@ship.local`;
  const user2Email = `user2-vis-${testRunId}@ship.local`;
  const adminEmail = `admin-vis-${testRunId}@ship.local`;
  const testWorkspaceName = `Visibility Test ${testRunId}`;

  let user1SessionCookie: string;
  let user1CsrfToken: string;
  let user2SessionCookie: string;
  let user2CsrfToken: string;
  let adminSessionCookie: string;
  let adminCsrfToken: string;
  let testWorkspaceId: string;
  let user1Id: string;
  let user2Id: string;
  let adminId: string;

  // Setup: Create test users and sessions
  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;

    // Create user 1 (regular member)
    const user1Result = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'User One')
       RETURNING id`,
      [user1Email]
    );
    user1Id = user1Result.rows[0].id;

    // Create user 2 (regular member)
    const user2Result = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'User Two')
       RETURNING id`,
      [user2Email]
    );
    user2Id = user2Result.rows[0].id;

    // Create admin user
    const adminResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Admin User')
       RETURNING id`,
      [adminEmail]
    );
    adminId = adminResult.rows[0].id;

    // Create workspace memberships
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, user1Id]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, user2Id]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, adminId]
    );

    // Create sessions for all users
    const session1Id = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [session1Id, user1Id, testWorkspaceId]
    );
    user1SessionCookie = `session_id=${session1Id}`;

    const session2Id = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [session2Id, user2Id, testWorkspaceId]
    );
    user2SessionCookie = `session_id=${session2Id}`;

    const adminSessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [adminSessionId, adminId, testWorkspaceId]
    );
    adminSessionCookie = `session_id=${adminSessionId}`;

    // Get CSRF tokens for all users
    const csrf1Res = await request(app).get('/api/csrf-token').set('Cookie', user1SessionCookie);
    user1CsrfToken = csrf1Res.body.token;
    const connectSid1 = csrf1Res.headers['set-cookie']?.[0]?.split(';')[0] || '';
    if (connectSid1) user1SessionCookie = `${user1SessionCookie}; ${connectSid1}`;

    const csrf2Res = await request(app).get('/api/csrf-token').set('Cookie', user2SessionCookie);
    user2CsrfToken = csrf2Res.body.token;
    const connectSid2 = csrf2Res.headers['set-cookie']?.[0]?.split(';')[0] || '';
    if (connectSid2) user2SessionCookie = `${user2SessionCookie}; ${connectSid2}`;

    const csrfAdminRes = await request(app).get('/api/csrf-token').set('Cookie', adminSessionCookie);
    adminCsrfToken = csrfAdminRes.body.token;
    const connectSidAdmin = csrfAdminRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
    if (connectSidAdmin) adminSessionCookie = `${adminSessionCookie}; ${connectSidAdmin}`;
  });

  // Cleanup after all tests
  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2, $3)', [user1Id, user2Id, adminId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [user1Id, user2Id, adminId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  // Clean up documents before each test
  beforeEach(async () => {
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
  });

  describe('Basic visibility filtering', () => {
    it('returns workspace docs to all workspace members', async () => {
      // Create workspace-visible document as user1
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Workspace Doc', 'workspace', $2)`,
        [testWorkspaceId, user1Id]
      );

      // User2 should see it
      const res = await request(app)
        .get('/api/documents')
        .set('Cookie', user2SessionCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Workspace Doc');
      expect(res.body[0].visibility).toBe('workspace');
    });

    it('returns private docs only to creator', async () => {
      // Create private document as user1
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      // User1 should see it
      const res1 = await request(app)
        .get('/api/documents')
        .set('Cookie', user1SessionCookie);

      expect(res1.status).toBe(200);
      expect(res1.body).toHaveLength(1);
      expect(res1.body[0].title).toBe('Private Doc');
    });

    it('returns private docs to workspace admins', async () => {
      // Create private document as user1
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      // Admin should see it
      const res = await request(app)
        .get('/api/documents')
        .set('Cookie', adminSessionCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Private Doc');
    });

    it('excludes other users private docs from list', async () => {
      // Create private document as user1
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      // User2 should NOT see it
      const res = await request(app)
        .get('/api/documents')
        .set('Cookie', user2SessionCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });

  describe('Single document access', () => {
    it('allows creator to access their private doc', async () => {
      // Create private document as user1
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'My Private Doc', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      const res = await request(app)
        .get(`/api/documents/${docId}`)
        .set('Cookie', user1SessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('My Private Doc');
      expect(res.body.visibility).toBe('private');
    });

    it('blocks non-creator from accessing private doc', async () => {
      // Create private document as user1
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private Doc', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      // User2 should get 404 (not 403, to not reveal existence)
      const res = await request(app)
        .get(`/api/documents/${docId}`)
        .set('Cookie', user2SessionCookie);

      expect(res.status).toBe(404);
    });

    it('allows admin to access any private doc', async () => {
      // Create private document as user1
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'User1 Private Doc', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      const res = await request(app)
        .get(`/api/documents/${docId}`)
        .set('Cookie', adminSessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('User1 Private Doc');
    });

    it('returns 404 for private doc accessed by non-creator', async () => {
      // Create private document as user1
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Secret Doc', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      // Non-creator gets 404 to not reveal document exists
      const res = await request(app)
        .get(`/api/documents/${docId}`)
        .set('Cookie', user2SessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Document not found');
    });
  });

  describe('Creating documents', () => {
    it('creates document with workspace visibility by default', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set('Cookie', user1SessionCookie)
        .set('X-CSRF-Token', user1CsrfToken)
        .send({ title: 'New Doc', document_type: 'wiki' });

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe('workspace');
    });

    it('allows creating document with private visibility', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set('Cookie', user1SessionCookie)
        .set('X-CSRF-Token', user1CsrfToken)
        .send({ title: 'Private New Doc', document_type: 'wiki', visibility: 'private' });

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe('private');
    });

    it('inherits visibility from parent document', async () => {
      // Create private parent
      const parentResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private Parent', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const parentId = parentResult.rows[0].id;

      // Create child without specifying visibility
      const res = await request(app)
        .post('/api/documents')
        .set('Cookie', user1SessionCookie)
        .set('X-CSRF-Token', user1CsrfToken)
        .send({ title: 'Child Doc', document_type: 'wiki', parent_id: parentId });

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe('private');
    });
  });

  describe('Updating visibility', () => {
    it('allows creator to change visibility to private', async () => {
      // Create workspace document
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Public Doc', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      const res = await request(app)
        .patch(`/api/documents/${docId}`)
        .set('Cookie', user1SessionCookie)
        .set('X-CSRF-Token', user1CsrfToken)
        .send({ visibility: 'private' });

      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe('private');
    });

    it('allows creator to change visibility to workspace', async () => {
      // Create private document
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private Doc', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      const res = await request(app)
        .patch(`/api/documents/${docId}`)
        .set('Cookie', user1SessionCookie)
        .set('X-CSRF-Token', user1CsrfToken)
        .send({ visibility: 'workspace' });

      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe('workspace');
    });

    it('cascades visibility change to child documents', async () => {
      // Create parent with workspace visibility
      const parentResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Parent Doc', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const parentId = parentResult.rows[0].id;

      // Create child
      const childResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, parent_id)
         VALUES ($1, 'wiki', 'Child Doc', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, user1Id, parentId]
      );
      const childId = childResult.rows[0].id;

      // Change parent to private
      await request(app)
        .patch(`/api/documents/${parentId}`)
        .set('Cookie', user1SessionCookie)
        .set('X-CSRF-Token', user1CsrfToken)
        .send({ visibility: 'private' });

      // Check child visibility changed
      const childRes = await request(app)
        .get(`/api/documents/${childId}`)
        .set('Cookie', user1SessionCookie);

      expect(childRes.status).toBe(200);
      expect(childRes.body.visibility).toBe('private');
    });

    it('prevents non-creator from changing visibility', async () => {
      // Create workspace document as user1
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'User1 Doc', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      // User2 tries to change visibility
      const res = await request(app)
        .patch(`/api/documents/${docId}`)
        .set('Cookie', user2SessionCookie)
        .set('X-CSRF-Token', user2CsrfToken)
        .send({ visibility: 'private' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Only the creator or admin');
    });

    it('allows admin to change any document visibility', async () => {
      // Create document as user1
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'User1 Doc', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      // Admin changes visibility
      const res = await request(app)
        .patch(`/api/documents/${docId}`)
        .set('Cookie', adminSessionCookie)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({ visibility: 'private' });

      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe('private');
    });
  });

  describe('Moving documents', () => {
    it('updates visibility when moving private doc to workspace parent', async () => {
      // Create workspace parent
      const parentResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Workspace Parent', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const parentId = parentResult.rows[0].id;

      // Create private standalone doc
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private Doc', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      // Move private doc to workspace parent
      const res = await request(app)
        .patch(`/api/documents/${docId}`)
        .set('Cookie', user1SessionCookie)
        .set('X-CSRF-Token', user1CsrfToken)
        .send({ parent_id: parentId });

      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe('workspace');
    });

    it('preserves visibility when moving workspace doc to workspace parent', async () => {
      // Create workspace parent
      const parentResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Workspace Parent', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const parentId = parentResult.rows[0].id;

      // Create workspace doc
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Workspace Doc', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, user1Id]
      );
      const docId = docResult.rows[0].id;

      // Move to parent
      const res = await request(app)
        .patch(`/api/documents/${docId}`)
        .set('Cookie', user1SessionCookie)
        .set('X-CSRF-Token', user1CsrfToken)
        .send({ parent_id: parentId });

      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe('workspace');
    });
  });

  describe('Search', () => {
    it('includes private docs in search for creator', async () => {
      // Create private document with searchable title
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Searchable Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      const res = await request(app)
        .get('/api/search/mentions?q=Searchable')
        .set('Cookie', user1SessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].title).toBe('Searchable Private Doc');
    });

    it('includes private docs in document title search for creator', async () => {
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Searchable Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      const res = await request(app)
        .get('/api/search/documents?q=Searchable')
        .set('Cookie', user1SessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].title).toBe('Searchable Private Doc');
    });

    it('excludes private docs from search for non-creator', async () => {
      // Create private document with searchable title
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Searchable Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      const res = await request(app)
        .get('/api/search/mentions?q=Searchable')
        .set('Cookie', user2SessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(0);
    });

    it('excludes private docs from document title search for non-creator', async () => {
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Searchable Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      const res = await request(app)
        .get('/api/search/documents?q=Searchable')
        .set('Cookie', user2SessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(0);
    });

    it('includes private docs in search for admin', async () => {
      // Create private document with searchable title
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Searchable Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      const res = await request(app)
        .get('/api/search/mentions?q=Searchable')
        .set('Cookie', adminSessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].title).toBe('Searchable Private Doc');
    });

    it('includes private docs in document title search for admin', async () => {
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Searchable Private Doc', 'private', $2)`,
        [testWorkspaceId, user1Id]
      );

      const res = await request(app)
        .get('/api/search/documents?q=Searchable')
        .set('Cookie', adminSessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].title).toBe('Searchable Private Doc');
    });
  });
});
