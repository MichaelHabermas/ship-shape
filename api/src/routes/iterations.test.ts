import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pgResult } from '../test/pg-result.js';

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
      const sprintId = 'sprint-123';
      const mockIteration = {
        id: 'iter-1',
        sprint_id: sprintId,
        story_id: 'story-1',
        story_title: 'Test Story',
        status: 'pass',
        what_attempted: 'Did the thing',
        blockers_encountered: null,
        author_id: 'user-123',
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(pool.query)
        // Sprint check
        .mockResolvedValueOnce(pgResult([{ id: sprintId }]))
        // Insert iteration
        .mockResolvedValueOnce(pgResult([mockIteration]))
        // Get author
        .mockResolvedValueOnce(pgResult([{ id: 'user-123', name: 'Test User', email: 'test@example.com' }]));

      const res = await request(app)
        .post(`/api/weeks/${sprintId}/iterations`)
        .send({
          story_id: 'story-1',
          story_title: 'Test Story',
          status: 'pass',
          what_attempted: 'Did the thing',
        });

      expect(res.status).toBe(201);
      expect(res.body.story_title).toBe('Test Story');
      expect(res.body.status).toBe('pass');
      expect(res.body.author.name).toBe('Test User');
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app)
        .post('/api/weeks/sprint-123/iterations')
        .send({
          story_title: 'Test Story',
          status: 'invalid',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('returns 400 for missing story_title', async () => {
      const res = await request(app)
        .post('/api/weeks/sprint-123/iterations')
        .send({
          status: 'pass',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
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

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Week not found');
    });
  });

  describe('GET /api/weeks/:id/iterations', () => {
    it('returns iterations for sprint', async () => {
      const sprintId = 'sprint-123';

      vi.mocked(pool.query)
        // Sprint check
        .mockResolvedValueOnce(pgResult([{ id: sprintId }]))
        // Get iterations
        .mockResolvedValueOnce(pgResult([
            {
              id: 'iter-1',
              sprint_id: sprintId,
              story_id: 'story-1',
              story_title: 'Story One',
              status: 'pass',
              what_attempted: 'Implemented feature',
              blockers_encountered: null,
              author_id: 'user-123',
              author_name: 'Test User',
              author_email: 'test@example.com',
              created_at: new Date(),
              updated_at: new Date(),
            },
          ]));

      const res = await request(app)
        .get(`/api/weeks/${sprintId}/iterations`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].story_title).toBe('Story One');
      expect(res.body[0].status).toBe('pass');
    });

    it('returns 404 for non-existent sprint', async () => {
      vi.mocked(pool.query)
        // Sprint check - not found
        .mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .get('/api/weeks/nonexistent/iterations');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Week not found');
    });

    it('filters by status', async () => {
      vi.mocked(pool.query)
        // Sprint check
        .mockResolvedValueOnce(pgResult([{ id: 'sprint-123' }]))
        // Get iterations - should have status filter applied
        .mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .get('/api/weeks/sprint-123/iterations?status=fail');

      expect(res.status).toBe(200);
      // Verify the query was called with the status filter
      const lastCall = vi.mocked(pool.query).mock.calls.pop();
      expect(lastCall?.[0]).toContain('status = $');
    });
  });
});
