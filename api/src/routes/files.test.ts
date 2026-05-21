import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { UploadResponseSchema } from '../openapi/schemas/files.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';

describe('Files API', () => {
  const app = createApp('http://localhost:5173');
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `files-${testRunId}@ship.local`;
  const testWorkspaceName = `Files Test ${testRunId}`;

  let sessionCookie: string;
  let csrfToken: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testFileId: string;

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
       VALUES ($1, 'test-hash', 'Files Test User')
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

  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM files WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
    // Don't close pool - it's shared across test files
  });

  it('POST /api/files/upload returns 403 without valid session (CSRF blocks first)', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('x-csrf-token', 'invalid-token')
      .send({
        filename: 'test.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      });

    // CSRF protection returns 403 before auth middleware can return 401
    expect(res.status).toBe(403);
  });

  it('POST /api/files/upload creates file record and returns upload URL', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        filename: 'test.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      });

    const upload = expectOpenApiResponse({
      method: 'post',
      path: '/files/upload',
      status: 200,
      response: res,
      openApiSchemaName: 'UploadResponse',
      schema: UploadResponseSchema,
    });
    expect(upload.fileId).toBeTruthy();
    expect(upload.uploadUrl).toBeTruthy();

    // Save fileId for later tests
    testFileId = upload.fileId;

    // Verify file record was created in database
    const dbResult = await pool.query(
      'SELECT * FROM files WHERE id = $1',
      [testFileId]
    );
    expect(dbResult.rows.length).toBe(1);
    expect(dbResult.rows[0].status).toBe('pending');
    expect(dbResult.rows[0].filename).toBe('test.png');
    expect(dbResult.rows[0].mime_type).toBe('image/png');
  });

  it('POST /api/files/upload rejects blocked file types', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        filename: 'malware.exe',
        mimeType: 'application/octet-stream',
        sizeBytes: 1024,
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('not allowed');
  });

  it('POST /api/files/:id/confirm updates file status and returns CDN URL', async () => {
    // First create a file
    const uploadRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        filename: 'confirm-test.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
      });

    const fileId = uploadRes.body.fileId;

    // Confirm the upload
    const confirmRes = await request(app)
      .post(`/api/files/${fileId}/confirm`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken);

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body).toHaveProperty('fileId');
    expect(confirmRes.body).toHaveProperty('cdnUrl');
    expect(confirmRes.body).toHaveProperty('status');
    expect(confirmRes.body.status).toBe('uploaded');
    expect(confirmRes.body.cdnUrl).toContain(`/api/files/${fileId}/serve`);

    // Verify database was updated
    const dbResult = await pool.query(
      'SELECT * FROM files WHERE id = $1',
      [fileId]
    );
    expect(dbResult.rows[0].status).toBe('uploaded');
    expect(dbResult.rows[0].cdn_url).toBeTruthy();
  });

  it('POST /api/files/:id/confirm returns 404 for non-existent file', async () => {
    const fakeId = crypto.randomUUID();
    const res = await request(app)
      .post(`/api/files/${fakeId}/confirm`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(404);
  });

  it('GET /api/files/:id returns file metadata', async () => {
    // First create and confirm a file
    const uploadRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        filename: 'metadata-test.png',
        mimeType: 'image/png',
        sizeBytes: 3072,
      });

    const fileId = uploadRes.body.fileId;

    await request(app)
      .post(`/api/files/${fileId}/confirm`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken);

    // Get file metadata
    const res = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('filename');
    expect(res.body).toHaveProperty('mime_type');
    expect(res.body).toHaveProperty('size_bytes');
    expect(res.body).toHaveProperty('cdn_url');
    expect(res.body).toHaveProperty('status');
    expect(res.body.filename).toBe('metadata-test.png');
  });

  it('DELETE /api/files/:id deletes file record', async () => {
    // First create a file
    const uploadRes = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        filename: 'delete-test.png',
        mimeType: 'image/png',
        sizeBytes: 4096,
      });

    const fileId = uploadRes.body.fileId;

    // Delete the file
    const deleteRes = await request(app)
      .delete(`/api/files/${fileId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toHaveProperty('success', true);

    // Verify file was deleted from database
    const dbResult = await pool.query(
      'SELECT * FROM files WHERE id = $1',
      [fileId]
    );
    expect(dbResult.rows.length).toBe(0);
  });
});
