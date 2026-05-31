import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { DevDatabaseStatusResponseSchema } from '../openapi/schemas/dev.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';
import { pgResult } from '../test/pg-result.js';

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
    queryMock.mockResolvedValueOnce(pgResult([{ '?column?': 1 }]));
    const app = createApp();

    const response = await request(app).get('/api/dev/database-status');

    const status = expectOpenApiResponse({
      method: 'get',
      path: '/dev/database-status',
      status: 200,
      response,
      openApiSchemaName: 'DevDatabaseStatusResponse',
      schema: DevDatabaseStatusResponseSchema,
    });
    expect(status).toEqual({ connected: true });
  });

  it('reports unreachable with setup hint when connection is refused', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    queryMock.mockRejectedValueOnce(refused);
    const app = createApp();

    const response = await request(app).get('/api/dev/database-status');

    const status = expectOpenApiResponse({
      method: 'get',
      path: '/dev/database-status',
      status: 200,
      response,
      openApiSchemaName: 'DevDatabaseStatusResponse',
      schema: DevDatabaseStatusResponseSchema,
    });
    expect(status.connected).toBe(false);
    expect(status.unreachable).toBe(true);
    expect(status.hint).toMatch(/PostgreSQL is not running/);
  });
});
