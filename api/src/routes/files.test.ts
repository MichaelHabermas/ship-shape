import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import {
  ConfirmUploadResponseSchema,
  FileMetadataSchema,
  UploadResponseSchema,
} from '../openapi/schemas/files.js';
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { requireFirstRow, type IdRow } from '../test/pg-result.js';
import { expectJsonBody } from '../test/expect-json-body.js';
import { getCsrfTokenFromApp } from '../test/session-csrf.js';
import { z } from 'zod';

const FileUploadErrorSchema = z.object({
  error: z.string(),
  blockedExtensions: z.array(z.string()).optional(),
});
const FileDeleteResponseSchema = z.object({ success: z.literal(true) });
const FileMetadataResponseSchema = FileMetadataSchema.extend({
  size_bytes: z.coerce.number(),
});

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

  async function createUpload(filename: string, mimeType: string, sizeBytes: number) {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({ filename, mimeType, sizeBytes });
    const upload = expectOpenApiResponse({
      method: 'post',
      path: '/files/upload',
      status: 200,
      response: res,
      openApiSchemaName: 'UploadResponse',
      schema: UploadResponseSchema,
    });
    return { fileId: upload.fileId, uploadUrl: upload.uploadUrl };
  }

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
       VALUES ($1, 'test-hash', 'Files Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = requireFirstRow(userResult.rows).id;

    // Create workspace membership
    await pool.query<IdRow>(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    );

    // Create session (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query<IdRow>(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    );
    sessionCookie = `session_id=${sessionId}`;

    const csrf = await getCsrfTokenFromApp(app, sessionCookie);
    csrfToken = csrf.token;
    sessionCookie = csrf.sessionCookie;
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
    const dbResult = await pool.query<IdRow>(
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

    const error = expectJsonBody(res, 400, FileUploadErrorSchema);
    expect(error.error).toContain('not allowed');
  });

  it('POST /api/files/upload rejects dangerous multi-extension filenames', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        filename: 'malware.exe.txt',
        mimeType: 'text/plain',
        sizeBytes: 1024,
      });

    const error = expectJsonBody(res, 400, FileUploadErrorSchema);
    expect(error.error).toContain('not allowed');
  });

  it('POST /api/files/:id/local-upload rejects bytes that do not match declared size', async () => {
    const { fileId, uploadUrl } = await createUpload('size-check.html', 'text/html', 2048);

    const res = await request(app)
      .post(uploadUrl)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .set('Content-Type', 'text/html')
      .send('<h1>short</h1>');

    const error = expectJsonBody(res, 400, FileUploadErrorSchema);
    expect(error.error).toContain('size');

    const dbResult = await pool.query<{ status: string }>(
      'SELECT status FROM files WHERE id = $1',
      [fileId]
    );
    expect(requireFirstRow(dbResult.rows).status).toBe('pending');
  });

  it('GET /api/files/:id/serve downloads uploaded HTML with nosniff', async () => {
    const body = '<h1>cat8</h1>';
    const { fileId, uploadUrl } = await createUpload('safe-download.html', 'text/html', Buffer.byteLength(body));

    const uploadRes = await request(app)
      .post(uploadUrl)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .set('Content-Type', 'text/html')
      .send(body);
    expect(uploadRes.status).toBe(200);

    const serveRes = await request(app)
      .get(`/api/files/${fileId}/serve`)
      .set('Cookie', sessionCookie);

    expect(serveRes.status).toBe(200);
    expect(serveRes.headers['content-disposition']).toContain('attachment');
    expect(serveRes.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns a generic 400 for malformed JSON bodies', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    const error = expectJsonBody(res, 400, z.object({ error: z.literal('Malformed JSON request body') }));
    expect(error).toEqual({ error: 'Malformed JSON request body' });
    expect(res.text).not.toMatch(/stack|node_modules|\/Users\/|DATABASE_URL/i);
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

    const upload = expectOpenApiResponse({
      method: 'post',
      path: '/files/upload',
      status: 200,
      response: uploadRes,
      openApiSchemaName: 'UploadResponse',
      schema: UploadResponseSchema,
    });
    const fileId = upload.fileId;

    // Confirm the upload
    const confirmRes = await request(app)
      .post(`/api/files/${fileId}/confirm`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken);

    const confirmed = expectOpenApiResponse({
      method: 'post',
      path: '/files/{fileId}/confirm',
      status: 200,
      response: confirmRes,
      openApiSchemaName: 'ConfirmUploadResponse',
      schema: ConfirmUploadResponseSchema,
    });
    expect(confirmed.status).toBe('uploaded');
    expect(confirmed.cdnUrl).toContain(`/api/files/${fileId}/serve`);

    // Verify database was updated
    const dbResult = await pool.query<IdRow>(
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

    const upload = expectOpenApiResponse({
      method: 'post',
      path: '/files/upload',
      status: 200,
      response: uploadRes,
      openApiSchemaName: 'UploadResponse',
      schema: UploadResponseSchema,
    });
    const fileId = upload.fileId;

    await request(app)
      .post(`/api/files/${fileId}/confirm`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken);

    // Get file metadata
    const res = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Cookie', sessionCookie);

    const metadata = expectOpenApiResponse({
      method: 'get',
      path: '/files/{fileId}',
      status: 200,
      response: res,
      openApiSchemaName: 'FileMetadata',
      schema: FileMetadataResponseSchema,
    });
    expect(metadata.filename).toBe('metadata-test.png');
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

    const upload = expectOpenApiResponse({
      method: 'post',
      path: '/files/upload',
      status: 200,
      response: uploadRes,
      openApiSchemaName: 'UploadResponse',
      schema: UploadResponseSchema,
    });
    const fileId = upload.fileId;

    // Delete the file
    const deleteRes = await request(app)
      .delete(`/api/files/${fileId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken);

    const deleted = expectOpenApiResponse({
      method: 'delete',
      path: '/files/{fileId}',
      status: 200,
      response: deleteRes,
      openApiSchemaName: 'SuccessResponse',
      schema: FileDeleteResponseSchema,
    });
    expect(deleted.success).toBe(true);

    // Verify file was deleted from database
    const dbResult = await pool.query<IdRow>(
      'SELECT * FROM files WHERE id = $1',
      [fileId]
    );
    expect(dbResult.rows.length).toBe(0);
  });
});
