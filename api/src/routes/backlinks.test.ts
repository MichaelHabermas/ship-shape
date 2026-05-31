/** API tests for document backlink creation, listing, and replacement. */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { z } from 'zod';
import { extractDocumentMentionIds } from '@ship/shared';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { BacklinkSchema } from '../openapi/schemas/backlinks.js';
import { ErrorResponseSchema, SuccessResponseSchema } from '../openapi/schemas/common.js';
import { expectApiErrorResponse } from '../test/expect-api-error.js';
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { requireFirstRow, type IdRow } from '../test/pg-result.js';

type TargetIdRow = { target_id: string };
import { getCsrfTokenFromApp } from '../test/session-csrf.js';

const BacklinkListSchema = z.array(BacklinkSchema);

describe('Backlinks API', () => {
  const app = createApp('http://localhost:5173');
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

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Backlinks Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = requireFirstRow(userResult.rows).id;

    await pool.query<IdRow>(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    );

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
    await pool.query('DELETE FROM document_links WHERE source_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM document_links WHERE source_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);

    const doc1Result = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Target Document', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testDocId = requireFirstRow(doc1Result.rows).id;

    const doc2Result = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Source Document 1', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testDoc2Id = requireFirstRow(doc2Result.rows).id;

    const doc3Result = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Source Document 2', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    );
    testDoc3Id = requireFirstRow(doc3Result.rows).id;
  });

  describe('GET /api/documents/:id/backlinks', () => {
    it('should return documents that link to the target document', async () => {
      await pool.query<IdRow>(
        `INSERT INTO document_links (source_id, target_id) VALUES ($1, $2), ($3, $2)`,
        [testDoc2Id, testDocId, testDoc3Id]
      );

      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      const backlinks = expectOpenApiResponse({
        method: 'get',
        path: '/documents/{id}/backlinks',
        status: 200,
        response,
        openApiSchemaName: 'Backlink',
        schema: BacklinkListSchema,
        arrayItemSchemaName: 'Backlink',
      })
      expect(backlinks).toHaveLength(2)
      expect(backlinks[0]).toHaveProperty('id')
      expect(backlinks[0]).toHaveProperty('document_type')
      expect(backlinks[0]).toHaveProperty('title')

      const ids = backlinks.map((b) => b.id)
      expect(ids).toContain(testDoc2Id)
      expect(ids).toContain(testDoc3Id)
    })

    it('should return empty array for document with no backlinks', async () => {
      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      const backlinks = expectOpenApiResponse({
        method: 'get',
        path: '/documents/{id}/backlinks',
        status: 200,
        response,
        openApiSchemaName: 'Backlink',
        schema: BacklinkListSchema,
        arrayItemSchemaName: 'Backlink',
      })
      expect(backlinks).toHaveLength(0)
    })

    it('should require authentication', async () => {
      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`);

      expectApiErrorResponse({
        method: 'get',
        path: '/documents/{id}/backlinks',
        status: 401,
        response,
      })
    })

    it('should respect workspace scope', async () => {
      const otherWorkspaceResult = await pool.query<IdRow>(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace Backlinks')
         RETURNING id`
      );
      const otherWorkspaceId = requireFirstRow(otherWorkspaceResult.rows).id;

      const otherDocResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'wiki', 'Other Document', $2)
         RETURNING id`,
        [otherWorkspaceId, testUserId]
      );
      const otherDocId = requireFirstRow(otherDocResult.rows).id;

      const response = await request(app)
        .get(`/api/documents/${otherDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      const error = expectApiErrorResponse({
        method: 'get',
        path: '/documents/{id}/backlinks',
        status: 404,
        response,
        openApiSchemaName: 'ErrorResponse',
        schema: ErrorResponseSchema,
      })
      expect(error.error).toBe('Document not found')

      await pool.query('DELETE FROM documents WHERE id = $1', [otherDocId]);
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId]);
    })

    it('should return 404 for non-existent document', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .get(`/api/documents/${fakeId}/backlinks`)
        .set('Cookie', sessionCookie);

      const error = expectApiErrorResponse({
        method: 'get',
        path: '/documents/{id}/backlinks',
        status: 404,
        response,
        openApiSchemaName: 'ErrorResponse',
        schema: ErrorResponseSchema,
      })
      expect(error.error).toBe('Document not found')
    })

    it('should include display_id for issue documents with ticket numbers', async () => {
      const programResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
         VALUES ($1, 'program', 'Test Program', '{"prefix": "TST"}', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      );
      const programId = requireFirstRow(programResult.rows).id;

      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Test Issue', 42, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      );

      await pool.query<IdRow>(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [requireFirstRow(issueResult.rows).id, programId]
      );
      const issueId = requireFirstRow(issueResult.rows).id;

      await pool.query<IdRow>(
        `INSERT INTO document_links (source_id, target_id) VALUES ($1, $2)`,
        [issueId, testDocId]
      );

      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      const backlinks = expectOpenApiResponse({
        method: 'get',
        path: '/documents/{id}/backlinks',
        status: 200,
        response,
        openApiSchemaName: 'Backlink',
        schema: BacklinkListSchema,
        arrayItemSchemaName: 'Backlink',
      })
      expect(backlinks).toHaveLength(1)
      expect(backlinks[0].document_type).toBe('issue')
      expect(backlinks[0].display_id).toBe('#42')

      await pool.query('DELETE FROM document_links WHERE source_id = $1', [issueId]);
      await pool.query('DELETE FROM documents WHERE id IN ($1, $2)', [issueId, programId]);
    })

    it('should order backlinks by created_at DESC', async () => {
      await pool.query<IdRow>(
        `INSERT INTO document_links (source_id, target_id, created_at)
         VALUES ($1, $2, now() - interval '2 hours')`,
        [testDoc2Id, testDocId]
      );

      await pool.query<IdRow>(
        `INSERT INTO document_links (source_id, target_id, created_at)
         VALUES ($1, $2, now() - interval '1 hour')`,
        [testDoc3Id, testDocId]
      );

      const response = await request(app)
        .get(`/api/documents/${testDocId}/backlinks`)
        .set('Cookie', sessionCookie);

      const backlinks = expectOpenApiResponse({
        method: 'get',
        path: '/documents/{id}/backlinks',
        status: 200,
        response,
        openApiSchemaName: 'Backlink',
        schema: BacklinkListSchema,
        arrayItemSchemaName: 'Backlink',
      })
      expect(backlinks).toHaveLength(2)
      expect(backlinks[0].id).toBe(testDoc3Id)
      expect(backlinks[1].id).toBe(testDoc2Id)
    })
  })

  describe('POST /api/documents/:id/links', () => {
    it('should create links to target documents', async () => {
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDoc2Id, testDoc3Id] });

      expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 200,
        response,
        openApiSchemaName: 'SuccessResponse',
        schema: SuccessResponseSchema,
      })

      const result = await pool.query<{ target_id: string }>(
        'SELECT target_id FROM document_links WHERE source_id = $1',
        [testDocId]
      );
      expect(result.rows).toHaveLength(2);
      const targetIds = result.rows.map(r => r.target_id);
      expect(targetIds).toContain(testDoc2Id);
      expect(targetIds).toContain(testDoc3Id);
    })

    it('should replace existing links', async () => {
      await pool.query<IdRow>(
        `INSERT INTO document_links (source_id, target_id) VALUES ($1, $2)`,
        [testDocId, testDoc2Id]
      );

      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDoc3Id] });

      expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 200,
        response,
        openApiSchemaName: 'SuccessResponse',
        schema: SuccessResponseSchema,
      })

      const result = await pool.query<TargetIdRow>(
        'SELECT target_id FROM document_links WHERE source_id = $1',
        [testDocId]
      );
      expect(result.rows).toHaveLength(1);
      expect(requireFirstRow(result.rows).target_id).toBe(testDoc3Id);
    })

    it('should clear all links when target_ids is empty', async () => {
      await pool.query<IdRow>(
        `INSERT INTO document_links (source_id, target_id) VALUES ($1, $2), ($1, $3)`,
        [testDocId, testDoc2Id, testDoc3Id]
      );

      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [] });

      expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 200,
        response,
        openApiSchemaName: 'SuccessResponse',
        schema: SuccessResponseSchema,
      })

      const result = await pool.query<IdRow>(
        'SELECT id FROM document_links WHERE source_id = $1',
        [testDocId]
      );
      expect(result.rows).toHaveLength(0);
    })

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDoc2Id] });

      expect(response.status).toBe(403);
    })

    it('should validate input schema', async () => {
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: 'not-an-array' });

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 400,
        response,
        openApiSchemaName: 'ErrorResponse',
        schema: ErrorResponseSchema,
      })
      expect(error.error).toBe('Invalid input')
    })

    it('should reject invalid UUID in target_ids', async () => {
      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: ['not-a-uuid'] });

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 400,
        response,
        openApiSchemaName: 'ErrorResponse',
        schema: ErrorResponseSchema,
      })
      expect(error.error).toBe('Invalid input')
    })

    it('should return 404 for non-existent source document', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .post(`/api/documents/${fakeId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDoc2Id] });

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 404,
        response,
        openApiSchemaName: 'ErrorResponse',
        schema: ErrorResponseSchema,
      })
      expect(error.error).toBe('Document not found')
    })

    it('should return 400 when target document does not exist', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [fakeId] });

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 400,
        response,
        openApiSchemaName: 'ErrorResponse',
        schema: ErrorResponseSchema,
      })
      expect(error.error).toBe('One or more target documents not found')
    })

    it('should respect workspace scope for source document', async () => {
      const otherWorkspaceResult = await pool.query<IdRow>(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace Links')
         RETURNING id`
      );
      const otherWorkspaceId = requireFirstRow(otherWorkspaceResult.rows).id;

      const otherDocResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'wiki', 'Other Document', $2)
         RETURNING id`,
        [otherWorkspaceId, testUserId]
      );
      const otherDocId = requireFirstRow(otherDocResult.rows).id;

      const response = await request(app)
        .post(`/api/documents/${otherDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [testDocId] });

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 404,
        response,
        openApiSchemaName: 'ErrorResponse',
        schema: ErrorResponseSchema,
      })
      expect(error.error).toBe('Document not found')

      await pool.query('DELETE FROM documents WHERE id = $1', [otherDocId]);
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId]);
    })

    it('should respect workspace scope for target documents', async () => {
      const otherWorkspaceResult = await pool.query<IdRow>(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace Target')
         RETURNING id`
      );
      const otherWorkspaceId = requireFirstRow(otherWorkspaceResult.rows).id;

      const otherDocResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'wiki', 'Other Document', $2)
         RETURNING id`,
        [otherWorkspaceId, testUserId]
      );
      const otherDocId = requireFirstRow(otherDocResult.rows).id;

      const response = await request(app)
        .post(`/api/documents/${testDocId}/links`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_ids: [otherDocId] });

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 400,
        response,
        openApiSchemaName: 'ErrorResponse',
        schema: ErrorResponseSchema,
      })
      expect(error.error).toBe('One or more target documents not found')

      await pool.query('DELETE FROM documents WHERE id = $1', [otherDocId]);
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId]);
    })

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

      expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/links',
        status: 200,
        response: postRes,
        openApiSchemaName: 'SuccessResponse',
        schema: SuccessResponseSchema,
      })

      const getRes = await request(app)
        .get(`/api/documents/${targetId}/backlinks`)
        .set('Cookie', sessionCookie);

      const mentionBacklinks = expectOpenApiResponse({
        method: 'get',
        path: '/documents/{id}/backlinks',
        status: 200,
        response: getRes,
        openApiSchemaName: 'Backlink',
        schema: BacklinkListSchema,
        arrayItemSchemaName: 'Backlink',
      })
      expect(mentionBacklinks.some((b) => b.id === testDocId)).toBe(true)
    })
  })
})
