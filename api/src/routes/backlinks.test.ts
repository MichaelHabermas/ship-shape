/** API tests for document backlink creation, listing, and replacement. */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { extractDocumentMentionIds } from '@ship/shared';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';

describe('Backlinks API', () => {
  const app = createApp('http://localhost:5173');
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `backlinks-${testRunId}@ship.local`;
  const testWorkspaceName = `Backlinks Test ${testRunId}`;

  let sessionCookie: string;
  let csrfToken: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testDocId: string;
  let testDoc2Id: string;
  let testDoc3Id: string;

  // Setup: Create a test user and session
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
       VALUES ($1, 'test-hash', 'Backlinks Test User')
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

    // Get CSRF token
    const csrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie);
    csrfToken = csrfRes.body.token;
    // Add connect.sid cookie for CSRF token storage
    const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
    if (connectSidCookie) {
      sessionCookie = `${sessionCookie}; ${connectSidCookie}`;
    }
  });

  // Cleanup after all tests
  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM document_links WHERE source_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  // Create fresh documents before each test
  beforeEach(async () => {
    // Clean up any existing documents and links
    await pool.query('DELETE FROM document_links WHERE source_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);

    // Create test documents
    const doc1Result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Target Document', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testDocId = doc1Result.rows[0].id;

    const doc2Result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Source Document 1', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testDoc2Id = doc2Result.rows[0].id;

    const doc3Result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Source Document 2', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testDoc3Id = doc3Result.rows[0].id;
  });

  describe('GET /api/documents/:id/backlinks', () => {
    it('should return documents that link to the target document', async () => {
      // Create backlinks: doc2 -> doc1, doc3 -> doc1
      await pool.query(
        `INSERT INTO document_links (source_id, target_id) VALUES ($1, $2), ($3, $2)`,
        [testDoc2Id, testDocId, testDoc3Id]
      );

      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);

      // Verify response structure
      const backlink = response.body[0];
      expect(backlink).toHaveProperty('id');
      expect(backlink).toHaveProperty('document_type');
      expect(backlink).toHaveProperty('title');

      // Verify we got the correct documents
      const backlinks = response.body as Array<{ id: string }>;
      const ids = backlinks.map((b) => b.id);
      expect(ids).toContain(testDoc2Id);
      expect(ids).toContain(testDoc3Id);
    });

    it('should return empty array for document with no backlinks', async () => {
      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should respect workspace scope', async () => {
      // Create document in a different workspace
      const otherWorkspaceResult = await pool.query(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace Backlinks')
         RETURNING id`
      );
      const otherWorkspaceId = otherWorkspaceResult.rows[0].id;

      const otherDocResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'wiki', 'Other Document', $2)
         RETURNING id`,
        [otherWorkspaceId, testUserId]
      );
      const otherDocId = otherDocResult.rows[0].id;

      // Try to get backlinks for document from another workspace
      const response = await request(app)
        .get(`/api/documents/${otherDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      // Should return 404 because the document doesn't belong to user's workspace
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Document not found');

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [otherDocId]);
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId]);
    });

    it('should return 404 for non-existent document', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .get(`/api/documents/${fakeId}/backlinks`)
        .set('Cookie', sessionCookie);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Document not found');
    });

    it('should include display_id for issue documents with ticket numbers', async () => {
      // Create a program for prefix
      const programResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
         VALUES ($1, 'program', 'Test Program', '{"prefix": "TST"}', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      );
      const programId = programResult.rows[0].id;

      // Create an issue document that links to the target
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Test Issue', 42, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      );

      // Associate issue with program
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [issueResult.rows[0].id, programId]
      );
      const issueId = issueResult.rows[0].id;

      // Create link: issue -> target doc
      await pool.query(
        `INSERT INTO document_links (source_id, target_id) VALUES ($1, $2)`,
        [issueId, testDocId]
      );

      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);

      const backlink = response.body[0];
      expect(backlink.document_type).toBe('issue');
      expect(backlink.display_id).toBe('#42');

      // Cleanup
      await pool.query('DELETE FROM document_links WHERE source_id = $1', [issueId]);
      await pool.query('DELETE FROM documents WHERE id IN ($1, $2)', [issueId, programId]);
    });

    it('should order backlinks by created_at DESC', async () => {
      // Create links with slight delays to ensure different timestamps
      await pool.query(
        `INSERT INTO document_links (source_id, target_id, created_at)
         VALUES ($1, $2, now() - interval '2 hours')`,
        [testDoc2Id, testDocId]
      );

      await pool.query(
        `INSERT INTO document_links (source_id, target_id, created_at)
         VALUES ($1, $2, now() - interval '1 hour')`,
        [testDoc3Id, testDocId]
      );

      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);

      // Most recent link should be first (doc3)
      expect(response.body[0].id).toBe(testDoc3Id);
      expect(response.body[1].id).toBe(testDoc2Id);
    });
  });

  describe('POST /api/documents/:id/links', () => {
    it('should create links to target documents', async () => {
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDoc2Id, testDoc3Id] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify links were created
      const result = await pool.query<{ target_id: string }>(
        'SELECT target_id FROM document_links WHERE source_id = $1',
        [testDocId]
      );
      expect(result.rows).toHaveLength(2);
      const targetIds = result.rows.map(r => r.target_id);
      expect(targetIds).toContain(testDoc2Id);
      expect(targetIds).toContain(testDoc3Id);
    });

    it('should replace existing links', async () => {
      // Create initial link
      await pool.query(
        `INSERT INTO document_links (source_id, target_id) VALUES ($1, $2)`,
        [testDocId, testDoc2Id]
      );

      // Update to different target
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDoc3Id] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify only the new link exists
      const result = await pool.query(
        'SELECT target_id FROM document_links WHERE source_id = $1',
        [testDocId]
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].target_id).toBe(testDoc3Id);
    });

    it('should clear all links when target_ids is empty', async () => {
      // Create initial links
      await pool.query(
        `INSERT INTO document_links (source_id, target_id) VALUES ($1, $2), ($1, $3)`,
        [testDocId, testDoc2Id, testDoc3Id]
      );

      // Clear links
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify all links are gone
      const result = await pool.query(
        'SELECT id FROM document_links WHERE source_id = $1',
        [testDocId]
      );
      expect(result.rows).toHaveLength(0);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDoc2Id] });

      // CSRF protection returns 403 when there's no valid session
      expect(response.status).toBe(403);
    });

    it('should validate input schema', async () => {
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid input');
    });

    it('should reject invalid UUID in target_ids', async () => {
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: ['not-a-uuid'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid input');
    });

    it('should return 404 for non-existent source document', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .post(`/api/documents/${fakeId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDoc2Id] });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Document not found');
    });

    it('should return 400 when target document does not exist', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [fakeId] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('One or more target documents not found');
    });

    it('should respect workspace scope for source document', async () => {
      // Create document in a different workspace
      const otherWorkspaceResult = await pool.query(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace Links')
         RETURNING id`
      );
      const otherWorkspaceId = otherWorkspaceResult.rows[0].id;

      const otherDocResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'wiki', 'Other Document', $2)
         RETURNING id`,
        [otherWorkspaceId, testUserId]
      );
      const otherDocId = otherDocResult.rows[0].id;

      // Try to create links from document in another workspace
      const response = await request(app)
        .post(`/api/documents/${otherDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDocId] });

      // Should return 404 because the document doesn't belong to user's workspace
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Document not found');

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [otherDocId]);
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId]);
    });

    it('should respect workspace scope for target documents', async () => {
      // Create document in a different workspace
      const otherWorkspaceResult = await pool.query(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace Target')
         RETURNING id`
      );
      const otherWorkspaceId = otherWorkspaceResult.rows[0].id;

      const otherDocResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'wiki', 'Other Document', $2)
         RETURNING id`,
        [otherWorkspaceId, testUserId]
      );
      const otherDocId = otherDocResult.rows[0].id;

      // Try to create link to document in another workspace
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [otherDocId] });

      // Should return 400 because target document is not in the same workspace
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('One or more target documents not found');

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [otherDocId]);
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId]);
    });

    it('syncs links from TipTap JSON mention ids (editor boundary)', async () => {
      const targetId = testDoc2Id;
      const content = {
        type: 'doc',
        content: [
          {
            type: 'mention',
            attrs: { mentionType: 'document', id: targetId, label: 'Target' },
          },
        ],
      };
      const mentionIds = extractDocumentMentionIds(content);
      expect(mentionIds).toContain(targetId);

      const postRes = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: mentionIds });
      expect(postRes.status).toBe(200);

      const getRes = await request(app)
        .get(`/api/documents/${targetId}/backlinks`)
        .set('Cookie', sessionCookie);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body)).toBe(true);
      const mentionBacklinks = getRes.body as Array<{ id: string }>;
      expect(mentionBacklinks.some((b) => b.id === testDocId)).toBe(true);
    });
  });
});
