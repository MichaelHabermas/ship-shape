import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pgCommand, pgResult } from '../test/pg-result.js';

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
  authMiddleware: vi.fn((req, _res, next) => {
    req.userId = 'user-123';
    req.workspaceId = 'ws-123';
    req.sessionId = 'test-session';
    next();
  }),
}));

vi.mock('../services/mutation-capability-guard.js', () => ({
  guardDocumentMutation: vi.fn().mockResolvedValue({ ok: true }),
  guardDocumentCreate: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../security/principal.js', () => ({
  principalFromRequest: vi.fn(() => ({
    kind: 'session',
    sessionId: 'test-session',
    userId: 'user-123',
    workspaceId: 'ws-123',
    isSuperAdmin: false,
  })),
}));

vi.mock('../security/route-capability.js', () => {
  const allowedProjectDecision = {
    allowed: true,
    reason: 'allowed',
    principal: { kind: 'session', userId: 'user-123', workspaceId: 'ws-123', isSuperAdmin: false, sessionId: 'test' },
  };
  return {
    guardDocumentIdParam: vi.fn((_res: unknown, rawId: string | string[] | undefined) =>
      typeof rawId === 'string' ? rawId : null
    ),
    requireProjectRead: vi.fn().mockResolvedValue(allowedProjectDecision),
    requireProjectWrite: vi.fn().mockResolvedValue(allowedProjectDecision),
    requireDocumentCreate: vi.fn().mockResolvedValue(allowedProjectDecision),
  };
});

import { pool } from '../db/client.js';
import express from 'express';
import request from 'supertest';
import projectsRouter from './projects.js';

describe('Projects API', () => {
  let app: express.Express;

  beforeEach(() => {
    // Reset all mocks completely (including queued mockResolvedValueOnce)
    vi.mocked(pool.query).mockReset();
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
  });

  describe('GET /api/projects', () => {
    it('returns array with ice_score computed field', async () => {
      const mockProjects = [
        {
          id: 'project-1',
          title: 'High Priority Project',
          properties: { impact: 5, confidence: 4, ease: 3, owner_id: 'owner-1', color: '#ff0000' },
          archived_at: null,
          created_at: new Date(),
          updated_at: new Date(),
          owner_id: 'owner-1',
          owner_name: 'Owner One',
          owner_email: 'owner1@example.com',
          sprint_count: '2',
          issue_count: '5',
        },
        {
          id: 'project-2',
          title: 'Low Priority Project',
          properties: { impact: 2, confidence: 2, ease: 2, owner_id: 'owner-2', color: '#00ff00' },
          archived_at: null,
          created_at: new Date(),
          updated_at: new Date(),
          owner_id: 'owner-2',
          owner_name: 'Owner Two',
          owner_email: 'owner2@example.com',
          sprint_count: '1',
          issue_count: '3',
        },
      ];

      vi.mocked(pool.query).mockResolvedValueOnce(pgResult(mockProjects));

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);

      // Verify ice_score is computed (5*4*3 = 60)
      expect(res.body[0].ice_score).toBe(60);
      expect(res.body[0].impact).toBe(5);
      expect(res.body[0].confidence).toBe(4);
      expect(res.body[0].ease).toBe(3);

      // Verify ice_score for second project (2*2*2 = 8)
      expect(res.body[1].ice_score).toBe(8);
    });

    it('returns projects sorted by ice_score descending by default', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      await request(app).get('/api/projects');

      // Verify the query includes ORDER BY with ICE score calculation
      const lastCall = vi.mocked(pool.query).mock.calls.pop();
      expect(lastCall?.[0]).toContain('ORDER BY');
      expect(lastCall?.[0]).toContain('impact');
      expect(lastCall?.[0]).toContain('confidence');
      expect(lastCall?.[0]).toContain('ease');
      expect(lastCall?.[0]).toContain('DESC');
    });

    it('sorts by ice_score ascending when dir=asc', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      await request(app).get('/api/projects?sort=ice_score&dir=asc');

      const lastCall = vi.mocked(pool.query).mock.calls.pop();
      expect(lastCall?.[0]).toContain('ASC');
    });

    it('returns 400 for invalid sort field', async () => {
      const res = await request(app).get('/api/projects?sort=invalid_field');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid sort field');
    });
  });

  describe('POST /api/projects', () => {
    it('creates project without owner_id (optional)', async () => {
      const mockProject = {
        id: 'project-new',
        title: 'Test Project',
        properties: { impact: 4, confidence: 3, ease: 5, owner_id: null, color: '#6366f1' },
        archived_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(pool.query)
        .mockResolvedValueOnce(pgResult([mockProject]));

      const res = await request(app)
        .post('/api/projects')
        .send({
          title: 'Test Project',
          impact: 4,
          confidence: 3,
          ease: 5,
          // owner_id intentionally omitted - should work
        });

      expect(res.status).toBe(201);
      expect(res.body.owner).toBe(null);
    });

    it('creates project with valid data including optional owner_id', async () => {
      const ownerId = '11111111-1111-1111-1111-111111111111';
      const mockProject = {
        id: 'project-new',
        title: 'New Project',
        properties: { impact: 4, confidence: 3, ease: 5, owner_id: ownerId, color: '#6366f1' },
        archived_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(pool.query)
        // Insert query
        .mockResolvedValueOnce(pgResult([mockProject]))
        // Get user info
        .mockResolvedValueOnce(pgResult([{ id: ownerId, name: 'Test Owner', email: 'owner@example.com' }]));

      const res = await request(app)
        .post('/api/projects')
        .send({
          title: 'New Project',
          impact: 4,
          confidence: 3,
          ease: 5,
          owner_id: ownerId,
        });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Project');
      expect(res.body.impact).toBe(4);
      expect(res.body.confidence).toBe(3);
      expect(res.body.ease).toBe(5);
      expect(res.body.ice_score).toBe(60); // 4 * 3 * 5
      expect(res.body.owner.id).toBe(ownerId);
    });

    it('uses null ICE values when not provided', async () => {
      const mockProject = {
        id: 'project-new',
        title: 'Untitled',
        properties: { impact: null, confidence: null, ease: null, owner_id: null, color: '#6366f1' },
        archived_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(pool.query)
        .mockResolvedValueOnce(pgResult([mockProject]));

      const res = await request(app)
        .post('/api/projects')
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Untitled');
      expect(res.body.impact).toBe(null);
      expect(res.body.confidence).toBe(null);
      expect(res.body.ease).toBe(null);
      expect(res.body.ice_score).toBe(null);
    });

    it('validates ICE scores are within 1-5 range', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({
          owner_id: '33333333-3333-3333-3333-333333333333',
          impact: 10, // Invalid - out of range
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });
  });

  describe('GET /api/projects/:id', () => {
    it('returns project with ice_score computed', async () => {
            const mockProject = {
        id: 'project-123',
        title: 'My Project',
        properties: { impact: 5, confidence: 5, ease: 5, owner_id: 'owner-1', color: '#123456' },
        archived_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        owner_id: 'owner-1',
        owner_name: 'Project Owner',
        owner_email: 'owner@example.com',
        sprint_count: '3',
        issue_count: '10',
      };

      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([mockProject]));

      const res = await request(app).get('/api/projects/project-123');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('project-123');
      expect(res.body.ice_score).toBe(125); // 5 * 5 * 5 = max score
    });

    it('returns 404 for non-existent project', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      const res = await request(app).get('/api/projects/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('updates ICE properties', async () => {
            const existingProject = {
        id: 'project-123',
        properties: { impact: 3, confidence: 3, ease: 3, owner_id: 'owner-1', color: '#6366f1' },
      };

      const updatedProject = {
        id: 'project-123',
        title: 'Updated Project',
        properties: { impact: 5, confidence: 4, ease: 3, owner_id: 'owner-1', color: '#6366f1' },
        archived_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        owner_id: 'owner-1',
        owner_name: 'Owner',
        owner_email: 'owner@e.com',
        sprint_count: '0',
        issue_count: '0',
      };

      vi.mocked(pool.query)
        // Check existing
        .mockResolvedValueOnce(pgResult([existingProject]))
        // Update
        .mockResolvedValueOnce(pgCommand(1))
        // Re-query
        .mockResolvedValueOnce(pgResult([updatedProject]));

      const res = await request(app)
        .patch('/api/projects/project-123')
        .send({ impact: 5, confidence: 4 });

      expect(res.status).toBe(200);
      expect(res.body.impact).toBe(5);
      expect(res.body.confidence).toBe(4);
      expect(res.body.ice_score).toBe(60); // 5 * 4 * 3
    });

    it('returns 404 for non-existent project', async () => {
            vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      const res = await request(app)
        .patch('/api/projects/nonexistent')
        .send({ title: 'New Title' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('deletes project and removes references', async () => {
      vi.mocked(pool.query)
        // Existence check
        .mockResolvedValueOnce(pgResult([{ id: 'project-123' }]))
        // Remove project associations
        .mockResolvedValueOnce(pgCommand(0))
        // Delete project
        .mockResolvedValueOnce(pgCommand(1, 'DELETE'));

      const res = await request(app).delete('/api/projects/project-123');

      expect(res.status).toBe(204);
    });

    it('returns 404 for non-existent project', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      const res = await request(app).delete('/api/projects/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });
});
