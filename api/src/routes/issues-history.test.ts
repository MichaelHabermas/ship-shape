// Verifies issue history and Claude metadata routes against current UUID and capability contracts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { pgResult } from '../test/pg-result.js';
import { IssueHistoryEntrySchema } from '../openapi/schemas/issues.js';
import { SuccessResponseSchema } from '../openapi/schemas/common.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';
import { expectJsonBody } from '../test/expect-json-body.js';

// Mock pool before importing routes
const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return { mockClient };
});
vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

// Mock visibility middleware
vi.mock('../middleware/visibility.js', () => ({
  getVisibilityContext: vi.fn().mockResolvedValue({ isAdmin: false }),
  VISIBILITY_FILTER_SQL: vi.fn().mockReturnValue('1=1'),
}));

// Mock auth middleware
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn((req: { userId?: string; workspaceId?: string }, _res: unknown, next: () => void) => {
    req.userId = '11111111-1111-4111-8111-111111111111';
    req.workspaceId = '22222222-2222-4222-8222-222222222222';
    next();
  }),
}));

vi.mock('../security/route-capability.js', () => {
  const documentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return {
    guardDocumentIdParam: vi.fn((
      res: { status: (code: number) => { json: (body: unknown) => void } },
      rawId: unknown,
      notFoundMessage: string,
    ) => {
      if (typeof rawId !== 'string' || !documentIdPattern.test(rawId)) {
        res.status(404).json({ error: notFoundMessage });
        return null;
      }
      return rawId;
    }),
    requireIssueRead: vi.fn().mockResolvedValue({ allowed: true }),
    requireIssueWrite: vi.fn().mockResolvedValue({ allowed: true }),
  };
});

vi.mock('../security/principal.js', () => ({
  principalFromRequest: vi.fn(() => ({
    kind: 'user',
    userId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    sessionId: 'test-session',
  })),
}));

vi.mock('../services/issue-mutations-service.js', async () => {
  const actual = await vi.importActual<typeof import('../services/issue-mutations-service.js')>(
    '../services/issue-mutations-service.js'
  );

  return {
    ...actual,
    updateIssueMutation: vi.fn(),
  };
});

import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';
import type { CapabilityDecision } from '../security/capabilities.js';
import { requireIssueRead, requireIssueWrite } from '../security/route-capability.js';
import { updateIssueMutation } from '../services/issue-mutations-service.js';
import express from 'express';
import request from 'supertest';
import issuesRouter from './issues.js';

const IssueHistoryListSchema = z.array(
  IssueHistoryEntrySchema.extend({
    automated_by: z.string().nullable().optional(),
  })
);
const LegacyApiErrorSchema = z.object({ error: z.string() });
const ValidationErrorSchema = z.object({
  error: z.literal('Invalid input'),
  details: z.array(z.unknown()).optional(),
});
const IssueStatePatchSchema = z.object({
  id: z.string().uuid().optional(),
  state: z.string(),
}).passthrough();

describe('Issues History API', () => {
  const issueId = '33333333-3333-4333-8333-333333333333';
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    const allowed: CapabilityDecision = { allowed: true };
    vi.mocked(requireIssueRead).mockResolvedValue(allowed);
    vi.mocked(requireIssueWrite).mockResolvedValue(allowed);
    // Reset mockClient defaults after clearAllMocks
    mockClient.query.mockResolvedValue(pgResult([]));
    mockClient.release.mockReturnValue(undefined);
    vi.mocked(pool.connect).mockResolvedValue(mockClient as unknown as PoolClient);
    vi.mocked(updateIssueMutation).mockResolvedValue({
      ok: true,
      status: 200,
      body: { id: issueId, state: 'done' },
    });
    app = express();
    app.use(express.json());
    app.use('/api/issues', issuesRouter);
  });

  describe('POST /api/issues/:id/history', () => {
    it('creates history entry with valid data', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .post(`/api/issues/${issueId}/history`)
        .send({
          field: 'verification_failed',
          old_value: '1',
          new_value: 'Test failed: assertion error',
          automated_by: 'claude',
        });

      const body = expectJsonBody(res, 201, SuccessResponseSchema);
      expect(body).toEqual({ success: true });
    });

    it('creates history entry without automated_by', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .post(`/api/issues/${issueId}/history`)
        .send({
          field: 'state',
          old_value: 'todo',
          new_value: 'in_progress',
        });

      const body = expectJsonBody(res, 201, SuccessResponseSchema);
      expect(body).toEqual({ success: true });
    });

    it('returns 400 for missing field', async () => {
      const res = await request(app)
        .post(`/api/issues/${issueId}/history`)
        .send({
          old_value: 'test',
          new_value: 'test2',
        });

      const error = expectJsonBody(res, 400, ValidationErrorSchema);
      expect(error.error).toBe('Invalid input');
    });

    it('returns 400 for empty field', async () => {
      const res = await request(app)
        .post(`/api/issues/${issueId}/history`)
        .send({
          field: '',
          old_value: 'test',
          new_value: 'test2',
        });

      const error = expectJsonBody(res, 400, ValidationErrorSchema);
      expect(error.error).toBe('Invalid input');
    });

    it('returns 400 for field too long', async () => {
      const res = await request(app)
        .post(`/api/issues/${issueId}/history`)
        .send({
          field: 'a'.repeat(101),
          old_value: 'test',
          new_value: 'test2',
        });

      const error = expectJsonBody(res, 400, ValidationErrorSchema);
      expect(error.error).toBe('Invalid input');
    });

    it('returns 404 for non-existent issue', async () => {
      vi.mocked(requireIssueWrite).mockImplementationOnce(async (_req, res) => {
        res.status(404).json({ error: 'Issue not found' });
        return null;
      });

      const res = await request(app)
        .post(`/api/issues/${issueId}/history`)
        .send({
          field: 'verification_failed',
          old_value: '1',
          new_value: 'error details',
        });

      const error = expectJsonBody(res, 404, LegacyApiErrorSchema);
      expect(error.error).toBe('Issue not found');
    });

    it('accepts null values', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .post(`/api/issues/${issueId}/history`)
        .send({
          field: 'sprint_id',
          old_value: null,
          new_value: 'sprint-456',
        });

      const body = expectJsonBody(res, 201, SuccessResponseSchema);
      expect(body).toEqual({ success: true });
    });
  });

  describe('GET /api/issues/:id/history', () => {
    it('returns history entries with automated_by', async () => {
      const historyEntries = [
        {
          id: '44444444-4444-4444-8444-444444444444',
          field: 'state',
          old_value: 'todo',
          new_value: 'in_progress',
          created_at: new Date(),
          changed_by_id: '11111111-1111-4111-8111-111111111111',
          changed_by_name: 'Test User',
          automated_by: null,
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          field: 'verification_failed',
          old_value: '1',
          new_value: 'test assertion failed',
          created_at: new Date(),
          changed_by_id: '11111111-1111-4111-8111-111111111111',
          changed_by_name: 'Test User',
          automated_by: 'claude',
        },
      ];

      vi.mocked(pool.query).mockResolvedValueOnce(pgResult(historyEntries));

      const res = await request(app)
        .get(`/api/issues/${issueId}/history`);

      const history = expectOpenApiResponse({
        method: 'get',
        path: '/issues/{id}/history',
        status: 200,
        response: res,
        openApiSchemaName: 'IssueHistoryEntry',
        arrayItemSchemaName: 'IssueHistoryEntry',
        schema: IssueHistoryListSchema,
      });
      expect(history).toHaveLength(2);
      expect(history[0].automated_by).toBeNull();
      expect(history[1].automated_by).toBe('claude');
      expect(history[1].field).toBe('verification_failed');
    });

    it('returns 404 for non-existent issue', async () => {
      vi.mocked(requireIssueRead).mockImplementationOnce(async (_req, res) => {
        res.status(404).json({ error: 'Issue not found' });
        return null;
      });

      const res = await request(app)
        .get(`/api/issues/${issueId}/history`);

      const error = expectJsonBody(res, 404, LegacyApiErrorSchema);
      expect(error.error).toBe('Issue not found');
    });
  });

  describe('PATCH /api/issues/:id with claude_metadata', () => {
    it('accepts claude_metadata with telemetry', async () => {
      const metadata = {
        updated_by: 'claude' as const,
        story_id: 'test-story',
        confidence: 85,
        telemetry: { iterations: 2, feedback_loops: { type_check: 3, test: 2, build: 1 } },
      };
      vi.mocked(updateIssueMutation).mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          id: issueId,
          state: 'done',
          claude_metadata: metadata,
        },
      });

      const res = await request(app)
        .patch(`/api/issues/${issueId}`)
        .send({
          state: 'done',
          claude_metadata: metadata,
        });

      const issue = expectJsonBody(res, 200, IssueStatePatchSchema);
      expect(issue.state).toBe('done');
      expect(updateIssueMutation).toHaveBeenCalled();
      const mutationCall = vi.mocked(updateIssueMutation).mock.calls.at(-1)?.[0] as
        | { issueId: string; data: { claude_metadata?: typeof metadata } }
        | undefined;
      expect(mutationCall?.issueId).toBe(issueId);
      expect(mutationCall?.data.claude_metadata).toEqual(metadata);
    });

    it('rejects claude_metadata with invalid confidence', async () => {
      const res = await request(app)
        .patch(`/api/issues/${issueId}`)
        .send({
          claude_metadata: {
            updated_by: 'claude',
            confidence: 150, // Invalid: > 100
          },
        });

      const error = expectJsonBody(res, 400, ValidationErrorSchema);
      expect(error.error).toBe('Invalid input');
    });

    it('rejects claude_metadata with wrong updated_by', async () => {
      const res = await request(app)
        .patch(`/api/issues/${issueId}`)
        .send({
          claude_metadata: {
            updated_by: 'human', // Must be 'claude'
          },
        });

      const error = expectJsonBody(res, 400, ValidationErrorSchema);
      expect(error.error).toBe('Invalid input');
    });
  });
});
