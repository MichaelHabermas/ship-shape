import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  pool: {
    query: queryMock,
  },
}));

describe('Dev database status', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports connected when SELECT 1 succeeds', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const app = createApp();

    const response = await request(app).get('/api/dev/database-status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ connected: true });
  });

  it('reports unreachable with setup hint when connection is refused', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    queryMock.mockRejectedValueOnce(refused);
    const app = createApp();

    const response = await request(app).get('/api/dev/database-status');

    expect(response.status).toBe(200);
    expect(response.body.connected).toBe(false);
    expect(response.body.unreachable).toBe(true);
    expect(response.body.hint).toMatch(/PostgreSQL is not running/);
  });
});
