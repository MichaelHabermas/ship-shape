import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { pgResult } from '../test/pg-result.js';
import { UuidSchema } from '../openapi/schemas/common.js';
import { expectJsonBody } from '../test/expect-json-body.js';

// Mock pool before importing routes
vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
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
    req.userId = 'user-123';
    req.workspaceId = 'ws-123';
    next();
  }),
}));

import { pool } from '../db/client.js';
import express from 'express';
import request from 'supertest';
import iterationsRouter from './iterations.js';

const SprintIterationSchema = z.object({
  id: UuidSchema,
  sprint_id: UuidSchema,
  story_id: z.string().nullable(),
  story_title: z.string(),
  status: z.enum(['pass', 'fail', 'in_progress']),
  what_attempted: z.string().nullable().optional(),
  blockers_encountered: z.string().nullable().optional(),
  author: z.object({
    id: UuidSchema,
    name: z.string(),
    email: z.string(),
  }),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

const SprintIterationListSchema = z.array(SprintIterationSchema);
const LegacyApiErrorSchema = z.object({ error: z.string() });
const ValidationErrorSchema = z.object({
  error: z.literal('Invalid input'),
  details: z.array(z.unknown()).optional(),
});

describe('Iterations API', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/weeks', iterationsRouter);
  });

  describe('POST /api/weeks/:id/iterations', () => {
    it('creates iteration with valid data', async () => {
      const sprintId = '11111111-1111-4111-8111-111111111111';
      const mockIteration = {
        id: '22222222-2222-4222-8222-222222222222',
        sprint_id: sprintId,
        story_id: 'story-1',
        story_title: 'Test Story',
        status: 'pass',
        what_attempted: 'Did the thing',
        blockers_encountered: null,
        author_id: '33333333-3333-4333-8333-333333333333',
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(pool.query)
        // Sprint check
        .mockResolvedValueOnce(pgResult([{ id: sprintId }]))
        // Insert iteration
        .mockResolvedValueOnce(pgResult([mockIteration]))
        // Get author
        .mockResolvedValueOnce(pgResult([{ id: '33333333-3333-4333-8333-333333333333', name: 'Test User', email: 'test@example.com' }]));

      const res = await request(app)
        .post(`/api/weeks/${sprintId}/iterations`)
        .send({
          story_id: 'story-1',
          story_title: 'Test Story',
          status: 'pass',
          what_attempted: 'Did the thing',
        });

      const iteration = expectJsonBody(res, 201, SprintIterationSchema);
      expect(iteration.story_title).toBe('Test Story');
      expect(iteration.status).toBe('pass');
      expect(iteration.author.name).toBe('Test User');
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app)
        .post('/api/weeks/sprint-123/iterations')
        .send({
          story_title: 'Test Story',
          status: 'invalid',
        });

      const error = expectJsonBody(res, 400, ValidationErrorSchema);
      expect(error.error).toBe('Invalid input');
    });

    it('returns 400 for missing story_title', async () => {
      const res = await request(app)
        .post('/api/weeks/sprint-123/iterations')
        .send({
          status: 'pass',
        });

      const error = expectJsonBody(res, 400, ValidationErrorSchema);
      expect(error.error).toBe('Invalid input');
    });

    it('returns 404 for non-existent sprint', async () => {
      vi.mocked(pool.query)
        // Sprint check - not found
        .mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .post('/api/weeks/nonexistent/iterations')
        .send({
          story_title: 'Test Story',
          status: 'pass',
        });

      const error = expectJsonBody(res, 404, LegacyApiErrorSchema);
      expect(error.error).toBe('Week not found');
    });
  });

  describe('GET /api/weeks/:id/iterations', () => {
    it('returns iterations for sprint', async () => {
      const sprintId = '11111111-1111-4111-8111-111111111111';

      vi.mocked(pool.query)
        // Sprint check
        .mockResolvedValueOnce(pgResult([{ id: sprintId }]))
        // Get iterations
        .mockResolvedValueOnce(pgResult([
            {
              id: '22222222-2222-4222-8222-222222222222',
              sprint_id: sprintId,
              story_id: 'story-1',
              story_title: 'Story One',
              status: 'pass',
              what_attempted: 'Implemented feature',
              blockers_encountered: null,
              author_id: '33333333-3333-4333-8333-333333333333',
              author_name: 'Test User',
              author_email: 'test@example.com',
              created_at: new Date(),
              updated_at: new Date(),
            },
          ]));

      const res = await request(app)
        .get(`/api/weeks/${sprintId}/iterations`);

      const iterations = expectJsonBody(res, 200, SprintIterationListSchema);
      expect(iterations).toHaveLength(1);
      expect(iterations[0].story_title).toBe('Story One');
      expect(iterations[0].status).toBe('pass');
    });

    it('returns 404 for non-existent sprint', async () => {
      vi.mocked(pool.query)
        // Sprint check - not found
        .mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .get('/api/weeks/nonexistent/iterations');

      const error = expectJsonBody(res, 404, LegacyApiErrorSchema);
      expect(error.error).toBe('Week not found');
    });

    it('filters by status', async () => {
      vi.mocked(pool.query)
        // Sprint check
        .mockResolvedValueOnce(pgResult([{ id: '11111111-1111-4111-8111-111111111111' }]))
        // Get iterations - should have status filter applied
        .mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .get('/api/weeks/sprint-123/iterations?status=fail');

      expectJsonBody(res, 200, SprintIterationListSchema);
      // Verify the query was called with the status filter
      const lastCall = vi.mocked(pool.query).mock.calls.pop();
      expect(lastCall?.[0]).toContain('status = $');
    });
  });
});
